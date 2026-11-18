import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { LabelSheet, type LabelItem, type Layout } from "../components/Labels";
import { History } from "../components/History";
import * as m from "../lib/materials";
import type { Article, StockWorkspace } from "../lib/materials";
import { useT } from "../lib/i18n";

/**
 * A workspace's stock (ADR-0008 in maker-5-shared): the catalogue of every
 * article in scope, its internal "marketplace", with what is on hand,
 * reserved by products and free. Admins add articles, receive stock, count
 * it and print labels; everyone in the workspace reads it. Products take
 * parts in their own Materials view (/w/<id>/materials/).
 *
 *   /materials/?w=<tenant>&a=<article>
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const params = () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
const setParams = (p: Record<string, string | undefined>) => {
  const u = params();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v); else u.delete(k);
  window.history.replaceState(null, "", `?${u.toString()}`);
};

const MaterialsPage: React.FC<PageProps> = () => {
  const { t } = useT();
  const [workspaces, setWorkspaces] = React.useState<StockWorkspace[] | null>(null);
  const [w, setW] = React.useState("");
  const [list, setList] = React.useState<Article[] | null>(null);
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [open, setOpen] = React.useState(params().get("a") ?? "");
  const [adding, setAdding] = React.useState(false);
  const [labels, setLabels] = React.useState<{ items: LabelItem[]; layout: Layout } | null>(null);
  const [blank, setBlank] = React.useState(24);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    m.stockWorkspaces().then((ws) => {
      setWorkspaces(ws);
      const want = params().get("w");
      setW(ws.find((x) => x.id === want)?.id ?? ws[0]?.id ?? "");
    }).catch((e) => setError(message(e)));
  }, []);
  const load = React.useCallback(() => {
    if (!w) return;
    m.articles(w, q, cat).then(setList).catch((e) => setError(message(e)));
  }, [w, q, cat]);
  React.useEffect(() => { const id = window.setTimeout(load, q ? 250 : 0); return () => window.clearTimeout(id); }, [load, q]);
  React.useEffect(() => { if (w) setParams({ w, a: open || undefined }); }, [w, open]);

  const ws = workspaces?.find((x) => x.id === w);
  const admin = Boolean(ws?.admin);
  const mintBlank = async () => {
    setError(null);
    try {
      const got = await m.mintCodes(w, blank);
      setLabels({ items: got.map((c) => ({ code: c.code })), layout: "tiny" });
    } catch (e) { setError(message(e)); }
  };

  return (
    <Shell active="materials" title={t("mt.title")}>
      <div className="mk-pagehead mk-noprint">
        <h1>{t("mt.title")}</h1>
        {workspaces && workspaces.length > 1 && (
          <select className="mk-select" value={w} onChange={(e) => { setW(e.target.value); setOpen(""); }} aria-label={t("mt.workspace")}>
            {workspaces.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        {workspaces?.length === 1 && <span className="mk-muted">{ws?.name}</span>}
        <a className="mk-button mk-button--ghost" href="/scan/">{t("nav.scan")}</a>
      </div>
      {workspaces?.length === 0 && <div className="mk-empty"><p>{t("mt.noworkspace")}</p></div>}
      {w && (
        <div className="mk-noprint">
          <div className="mk-panel">
            <p className="mk-panel__hint">{t("mt.hint")}</p>
            <div className="mk-toolbar">
              <input className="mk-input" type="search" placeholder={t("mt.search")} value={q}
                onChange={(e) => setQ(e.target.value)} aria-label={t("mt.search")} />
              <select className="mk-select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("mt.category")}>
                <option value="">{t("mt.allcategories")}</option>
                {m.CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
              </select>
              {admin && <button type="button" className="mk-button" onClick={() => setAdding(true)}>{t("mt.add")}</button>}
            </div>
            {adding && <ArticleForm tenantId={w} onDone={(a) => { setAdding(false); if (a) { load(); setOpen(a.id); } }} />}
            <table className="mk-table mk-stock">
              <thead><tr>
                <th>{t("mt.article")}</th><th>{t("mt.category")}</th>
                <th className="mk-num">{t("mt.onhand")}</th><th className="mk-num">{t("mt.reserved")}</th><th className="mk-num">{t("mt.free")}</th>
              </tr></thead>
              <tbody>
                {list?.map((a) => (
                  <tr key={a.id} className={`${a.id === open ? "mk-row--on" : ""}${a.low ? " mk-row--low" : ""}`}
                    onClick={() => setOpen(a.id === open ? "" : a.id)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") setOpen(a.id === open ? "" : a.id); }}>
                    <td><strong>{a.name}</strong>{a.manufacturer || a.mpn ? <span className="mk-muted"> · {[a.manufacturer, a.mpn].filter(Boolean).join(" ")}</span> : null}
                      {a.tracking === "serial" && <span className="mk-pill">{t("mt.serial")}</span>}</td>
                    <td>{t(`cat.${a.category}`)}</td>
                    <td className="mk-num">{a.onHand} {a.unit !== "pcs" ? a.unit : ""}</td>
                    <td className="mk-num">{a.reserved}</td>
                    <td className="mk-num">{a.free}{a.low && <span className="mk-pill mk-pill--warn">{t("mt.low")}</span>}</td>
                  </tr>
                ))}
                {list?.length === 0 && <tr><td colSpan={5} className="mk-muted">{q || cat ? t("mt.nomatch") : t("mt.none")}</td></tr>}
                {!list && !error && <tr><td colSpan={5} className="mk-muted">…</td></tr>}
              </tbody>
            </table>
          </div>
          {open && <ArticlePanel key={open} tenantId={w} id={open} admin={admin} onChanged={load}
            onLabels={(items, layout) => setLabels({ items, layout })} />}
          {admin && (
            <div className="mk-panel">
              <h2 className="mk-panel__title">{t("mt.blank")}</h2>
              <p className="mk-panel__hint">{t("mt.blank.hint")}</p>
              <form className="mk-toolbar" onSubmit={(e) => { e.preventDefault(); void mintBlank(); }}>
                <input className="mk-input mk-input--num" type="number" min={1} max={240} value={blank}
                  onChange={(e) => setBlank(Number(e.target.value))} aria-label={t("mt.blank.n")} />
                <button type="submit" className="mk-button mk-button--ghost">{t("mt.blank.make")}</button>
              </form>
            </div>
          )}
        </div>
      )}
      {error && <p className="mk-error" role="alert">{error}</p>}
      {labels && <LabelSheet items={labels.items} layout={labels.layout} onClose={() => setLabels(null)} />}
    </Shell>
  );
};

function ArticleForm({ tenantId, article, onDone }: { tenantId: string; article?: Article; onDone: (a: Article | null) => void }) {
  const { t } = useT();
  const [f, setF] = React.useState<Partial<Article>>(article ?? { category: "electronic", tracking: "bulk", unit: "pcs" });
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof Article) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setError(null);
    try { onDone(await m.saveArticle(tenantId, { ...f, minStock: f.minStock === undefined || (f.minStock as unknown) === "" ? undefined : Number(f.minStock) })); }
    catch (e) { setError(message(e)); }
  };
  return (
    <form className="mk-form mk-articleform" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input className="mk-input" required placeholder={t("mt.f.name")} value={f.name ?? ""} onChange={set("name")} aria-label={t("mt.f.name")} />
      <select className="mk-select" value={f.category} onChange={set("category")} aria-label={t("mt.category")}>
        {m.CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
      </select>
      <select className="mk-select" value={f.tracking} onChange={set("tracking")} aria-label={t("mt.f.tracking")}
        disabled={Boolean(article && article.onHand > 0)}>
        <option value="bulk">{t("mt.f.bulk")}</option>
        <option value="serial">{t("mt.f.serial")}</option>
      </select>
      {f.tracking === "bulk" && (
        <select className="mk-select" value={f.unit} onChange={set("unit")} aria-label={t("mt.f.unit")}>
          {m.UNITS_OF.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
        </select>
      )}
      <input className="mk-input" placeholder={t("mt.f.manufacturer")} value={f.manufacturer ?? ""} onChange={set("manufacturer")} />
      <input className="mk-input" placeholder={t("mt.f.mpn")} value={f.mpn ?? ""} onChange={set("mpn")} />
      <input className="mk-input" placeholder={t("mt.f.location")} value={f.location ?? ""} onChange={set("location")} />
      <input className="mk-input mk-input--num" type="number" min={0} placeholder={t("mt.f.min")} value={f.minStock ?? ""} onChange={set("minStock")} aria-label={t("mt.f.min")} />
      <input className="mk-input" type="url" placeholder={t("mt.f.datasheet")} value={f.datasheet ?? ""} onChange={set("datasheet")} />
      <textarea className="mk-input" placeholder={t("mt.f.note")} value={f.note ?? ""} onChange={set("note")} rows={2} />
      <span>
        <button type="submit" className="mk-button">{t("mt.save")}</button>{" "}
        <button type="button" className="mk-button mk-button--ghost" onClick={() => onDone(null)}>{t("mt.cancel")}</button>
      </span>
      {error && <p className="mk-error" role="alert">{error}</p>}
    </form>
  );
}

function ArticlePanel({ tenantId, id, admin, onChanged, onLabels }: {
  tenantId: string; id: string; admin: boolean; onChanged: () => void; onLabels: (items: LabelItem[], layout: Layout) => void;
}) {
  const { t } = useT();
  const [d, setD] = React.useState<Awaited<ReturnType<typeof m.article>> | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [qty, setQty] = React.useState(1);
  const [serials, setSerials] = React.useState("");
  const [count, setCount] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const load = React.useCallback(() => { m.article(tenantId, id).then(setD).catch((e) => setError(message(e))); }, [tenantId, id]);
  React.useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null); setOk(null);
    try { await fn(); setOk(done); load(); onChanged(); } catch (e) { setError(message(e)); }
  };
  if (!d) return <div className="mk-panel"><p className="mk-muted">{error ?? "…"}</p></div>;
  const a = d.article;
  const ownCode = (codes: m.CodeRow[]) => codes.find((c) => c.kind === "m5")?.value;

  /** Labels for the units (or the article), minting and binding a code where one is missing. */
  const labelsFor = async (layout: Layout) => {
    setError(null);
    try {
      const targets = a.tracking === "serial"
        ? d.units.filter((u) => u.state !== "retired").map((u) => ({ kind: "unit" as const, id: u.id, sub: u.serial }))
        : [{ kind: "article" as const, id: a.id, sub: [a.manufacturer, a.mpn].filter(Boolean).join(" ") }];
      const items: LabelItem[] = [];
      const need = [];
      for (const x of targets) {
        const have = x.kind === "article" ? ownCode(d.codes) : (await m.unit(tenantId, x.id)).codes.find((c) => c.kind === "m5")?.value;
        if (have) items.push({ code: have, title: a.name, sub: x.sub }); else need.push(x);
      }
      if (need.length) {
        const fresh = await m.mintCodes(tenantId, need.length);
        for (let i = 0; i < need.length && i < fresh.length; i++) {
          await m.bindCode(tenantId, fresh[i].code, need[i].kind, need[i].id);
          items.push({ code: fresh[i].code, title: a.name, sub: need[i].sub });
        }
      }
      onLabels(items, layout);
      load();
    } catch (e) { setError(message(e)); }
  };

  return (
    <div className="mk-panel">
      <h2 className="mk-panel__title">{a.name}{" "}
        {admin && <button type="button" className="mk-linkbutton" onClick={() => setEditing(!editing)}>{t("mt.edit")}</button>}</h2>
      {editing && <ArticleForm tenantId={tenantId} article={a} onDone={(x) => { setEditing(false); if (x) { load(); onChanged(); } }} />}
      <dl className="mk-stats">
        <div className="mk-stat"><dt>{a.onHand}</dt><dd>{t("mt.onhand")}</dd></div>
        <div className="mk-stat"><dt>{a.reserved}</dt><dd>{t("mt.reserved")}</dd></div>
        <div className="mk-stat"><dt>{a.free}</dt><dd>{t("mt.free")}</dd></div>
        {a.minStock !== undefined && <div className="mk-stat"><dt>{a.minStock}</dt><dd>{t("mt.f.min")}</dd></div>}
      </dl>
      <p className="mk-panel__hint">
        {[t(`cat.${a.category}`), a.manufacturer, a.mpn, a.location && `${t("mt.f.location")}: ${a.location}`].filter(Boolean).join(" · ")}
        {a.datasheet && <> · <a href={a.datasheet} target="_blank" rel="noreferrer">{t("mt.f.datasheet")}</a></>}
      </p>
      {a.note && <p className="mk-panel__hint">{a.note}</p>}
      {d.codes.length > 0 && (
        <p className="mk-panel__hint">{t("mt.codes")}: {d.codes.map((c) => <code key={c.pk} className="mk-id">{c.kind === "m5" ? c.value : `${c.kind}:${c.value}`}</code>)}</p>
      )}

      {admin && (
        <div className="mk-toolbar">
          {a.tracking === "bulk" ? (
            <>
              <form className="mk-toolbar" onSubmit={(e) => { e.preventDefault(); void run(() => m.receive(tenantId, a.id, { qty }), t("mt.received", { n: qty })); }}>
                <input className="mk-input mk-input--num" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label={t("mt.receive.n")} />
                <button type="submit" className="mk-button">{t("mt.receive")}</button>
              </form>
              <form className="mk-toolbar" onSubmit={(e) => { e.preventDefault(); void run(() => m.adjust(tenantId, a.id, Number(count)), t("mt.counted")); }}>
                <input className="mk-input mk-input--num" type="number" min={0} placeholder={String(a.onHand)} value={count} onChange={(e) => setCount(e.target.value)} aria-label={t("mt.count.n")} />
                <button type="submit" className="mk-button mk-button--ghost" disabled={count === ""}>{t("mt.count")}</button>
              </form>
            </>
          ) : (
            <form className="mk-toolbar" onSubmit={(e) => {
              e.preventDefault();
              const lines = serials.split("\n").map((s) => s.trim()).filter(Boolean);
              const units = lines.length ? lines.map((serial) => ({ serial })) : undefined;
              void run(() => m.receive(tenantId, a.id, units ? { units } : { qty }), t("mt.received", { n: units?.length ?? qty })).then(() => setSerials(""));
            }}>
              <textarea className="mk-input" rows={2} placeholder={t("mt.serials")} value={serials} onChange={(e) => setSerials(e.target.value)} aria-label={t("mt.serials")} />
              {!serials.trim() && <input className="mk-input mk-input--num" type="number" min={1} max={40} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label={t("mt.receive.n")} />}
              <button type="submit" className="mk-button">{t("mt.receive")}</button>
            </form>
          )}
          <button type="button" className="mk-button mk-button--ghost" onClick={() => void labelsFor(a.tracking === "serial" ? "tiny" : "article")}>{t("mt.labels")}</button>
        </div>
      )}
      {ok && <p className="mk-ok" role="status">{ok}</p>}
      {error && <p className="mk-error" role="alert">{error}</p>}

      {a.tracking === "serial" && (
        <>
          <h3 className="mk-panel__sub">{t("mt.units", { n: d.units.length })}</h3>
          <table className="mk-table">
            <thead><tr><th>{t("un.serial")}</th><th>{t("un.state")}</th><th>{t("mt.f.location")}</th><th>{t("un.firmware")}</th></tr></thead>
            <tbody>
              {d.units.map((u) => (
                <tr key={u.id}>
                  <td><a href={m.unitHref(tenantId, u.id)}>{u.serial || u.id}</a>{u.parentId && <span className="mk-muted"> · {t("un.inside")}</span>}</td>
                  <td>{t(`state.${u.state}`)}</td>
                  <td>{u.location ?? "—"}</td>
                  <td>{u.firmware ? `${u.firmware.name} ${u.firmware.version}` : "—"}</td>
                </tr>
              ))}
              {d.units.length === 0 && <tr><td colSpan={4} className="mk-muted">{t("mt.nounits")}</td></tr>}
            </tbody>
          </table>
        </>
      )}
      {d.allocations.some((x) => x.reserved || x.consumed) && (
        <>
          <h3 className="mk-panel__sub">{t("mt.byproduct")}</h3>
          <ul className="mk-list">
            {d.allocations.filter((x) => x.reserved || x.consumed).map((x) => (
              <li key={x.spaceId}><a href={`/w/${x.spaceId}/materials/`}>{x.spaceId}</a>: {t("mt.alloc", { r: x.reserved, c: x.consumed })}</li>
            ))}
          </ul>
        </>
      )}
      <History movements={d.movements} />
    </div>
  );
}


export default MaterialsPage;
export const Head: HeadFC = () => <title>Materials · maker5.cloud</title>;
