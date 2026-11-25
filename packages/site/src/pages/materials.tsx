import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { LabelSheet, QueueSheet, type LabelItem, type Layout } from "../components/Labels";
import { nextNumber } from "../lib/boxNames";
import { useQueue } from "../lib/labelQueue";
import { History } from "../components/History";
import * as m from "../lib/materials";
import type { Article, StockWorkspace } from "../lib/materials";
import { useT } from "../lib/i18n";
import { EditBox } from "../components/BoxCard";
import { IntakeInbox } from "../components/IntakeInbox";
import { listSpaces, type Space } from "../lib/data";
import { catalogue, categoryName, categoryOf, inCategory, subCategories, topCategories } from "@dlab5/maker-5-core";

/**
 * A workspace's stock (ADR-0008 in maker-5-shared): the catalogue of every
 * article in scope, its internal "marketplace", with what is on hand,
 * reserved by products and free. Tiles of categories lead into it, two
 * levels deep (ADR-0019), and a search counts across all of them. Also
 * Admins add articles, receive stock, count
 * it and print labels; everyone in the workspace reads it. Products take
 * parts in their own Materials view (/w/<id>/materials/).
 *
 *   /materials/?w=<tenant>&a=<article>
 *   /materials/?w=<tenant>&c=controllers/sbc  one category of the catalogue
 *   /materials/?w=<tenant>&tab=boxes          the organisation's boxes (ADR-0011)
 *   /materials/?w=<tenant>&tab=intake         what was scanned at the shelf, to check in (ADR-0022)
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const params = () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
const setParams = (p: Record<string, string | undefined>) => {
  const u = params();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v); else u.delete(k);
  window.history.replaceState(null, "", `?${u.toString()}`);
};

const MaterialsPage: React.FC<PageProps> = () => {
  const { t, lang } = useT();
  const [workspaces, setWorkspaces] = React.useState<StockWorkspace[] | null>(null);
  const [w, setW] = React.useState("");
  const [list, setList] = React.useState<Article[] | null>(null);
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState(params().get("c") ?? "");
  const [onlyProposed, setOnlyProposed] = React.useState(false);
  const [open, setOpen] = React.useState(params().get("a") ?? "");
  const [adding, setAdding] = React.useState(false);
  const [labels, setLabels] = React.useState<{ items: LabelItem[]; layout: Layout } | null>(null);
  const [blank, setBlank] = React.useState(24);
  const [blankFamily, setBlankFamily] = React.useState<m.Family>("m5");
  const [error, setError] = React.useState<string | null>(null);
  const [queueOpen, setQueueOpen] = React.useState(false);
  type Tab = "stock" | "boxes" | "intake";
  const [tab, setTab] = React.useState<Tab>(() => { const v = params().get("tab"); return v === "boxes" || v === "intake" ? v : "stock"; });

  React.useEffect(() => {
    m.stockWorkspaces().then((ws) => {
      setWorkspaces(ws);
      const want = params().get("w");
      setW(ws.find((x) => x.id === want)?.id ?? ws[0]?.id ?? "");
    }).catch((e) => setError(message(e)));
  }, []);
  const load = React.useCallback(() => {
    if (!w) return;
    m.articles(w, q).then(setList).catch((e) => setError(message(e)));
  }, [w, q]);
  React.useEffect(() => { const id = window.setTimeout(load, q ? 250 : 0); return () => window.clearTimeout(id); }, [load, q]);
  React.useEffect(() => { if (w) setParams({ w, a: open || undefined, c: cat || undefined, tab: tab === "stock" ? undefined : tab }); }, [w, open, cat, tab]);

  const ws = workspaces?.find((x) => x.id === w);
  const counts = React.useMemo(() => catalogue(list ?? []), [list]);
  const shown = list?.filter((a) => inCategory(a.category, cat) && (!onlyProposed || a.proposed));
  const top = cat.split("/")[0];
  const tiles = cat.includes("/") ? [] : cat ? subCategories(cat) : topCategories();
  const admin = Boolean(ws?.admin);
  const mintBlank = async () => {
    setError(null);
    try {
      const got = await m.mintCodes(w, blank, blankFamily);
      setLabels({ items: got.map((c) => ({ code: c.code, family: c.family })), layout: blankFamily === "dhc" ? "tag" : "tiny" });
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
        {w && <QueueButton tenantId={w} onOpen={() => setQueueOpen(true)} />}
      </div>
      {workspaces?.length === 0 && <div className="mk-empty"><p>{t("mt.noworkspace")}</p></div>}
      {w && (
        <nav className="mk-tabs mk-noprint" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "stock"} className={tab === "stock" ? "mk-tab mk-tab--on" : "mk-tab"} onClick={() => setTab("stock")}>{t("bx.tab.stock")}</button>
          <button type="button" role="tab" aria-selected={tab === "boxes"} className={tab === "boxes" ? "mk-tab mk-tab--on" : "mk-tab"} onClick={() => setTab("boxes")}>{t("bx.tab")}</button>
          <button type="button" role="tab" aria-selected={tab === "intake"} className={tab === "intake" ? "mk-tab mk-tab--on" : "mk-tab"} onClick={() => setTab("intake")}>{t("ib.tab")}</button>
        </nav>
      )}
      {w && tab === "intake" && <IntakeInbox key={w} tenantId={w} admin={admin} />}
      {w && tab === "boxes" && <BoxesPanel tenantId={w} admin={admin} onLabels={(items, layout = "box") => setLabels({ items, layout })} />}
      {w && tab === "stock" && (
        <div className="mk-noprint">
          <div className="mk-panel">
            <p className="mk-panel__hint">{t("mt.hint")}</p>
            <div className="mk-toolbar">
              <input className="mk-input" type="search" placeholder={t("mt.search")} value={q}
                onChange={(e) => setQ(e.target.value)} aria-label={t("mt.search")} />
              {admin && <button type="button" className="mk-button" onClick={() => setAdding(true)}>{t("mt.add")}</button>}
            </div>
            <nav className="mk-crumbs" aria-label={t("mt.category")}>
              <button type="button" className="mk-linkbutton" onClick={() => setCat("")} aria-current={!cat}>{t("mt.allcategories")}</button>
              {top && <> › <button type="button" className="mk-linkbutton" onClick={() => setCat(top)} aria-current={cat === top}>{categoryName(top, lang)}</button></>}
              {cat.includes("/") && <> › <strong>{categoryName(cat, lang)}</strong></>}
            </nav>
            {tiles.length > 0 && (
              <ul className="mk-tiles">
                {tiles.map((c) => (
                  <li key={c.code}>
                    <button type="button" className={`mk-tile${counts[c.code]?.articles ? "" : " mk-tile--empty"}`} onClick={() => setCat(c.code)}>
                      <span className="mk-tile__name">{c.label[lang] ?? c.label.en}</span>
                      <span className="mk-tile__n">{t("mt.tile", { n: counts[c.code]?.articles ?? 0, free: counts[c.code]?.free ?? 0 })}</span>
                      {!cat && <span className="mk-tile__subs">{subCategories(c.code).filter((s) => counts[s.code]?.articles).map((s) => s.label[lang] ?? s.label.en).slice(0, 4).join(" · ")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(list?.some((a) => a.proposed) || onlyProposed) && (
              <p className="mk-panel__hint mk-proposed-note">
                {t("mt.proposed.note", { n: list?.filter((a) => a.proposed).length ?? 0 })}{" "}
                <button type="button" className="mk-linkbutton" onClick={() => setOnlyProposed(!onlyProposed)}>
                  {onlyProposed ? t("mt.proposed.all") : t("mt.proposed.show")}</button>
              </p>
            )}
            {adding && <ArticleForm tenantId={w} onDone={(a) => { setAdding(false); if (a) { load(); setOpen(a.id); } }} />}
            <table className="mk-table mk-stock">
              <thead><tr>
                <th>{t("mt.article")}</th><th>{t("mt.category")}</th>
                <th className="mk-num">{t("mt.onhand")}</th><th className="mk-num">{t("mt.reserved")}</th><th className="mk-num">{t("mt.free")}</th>
              </tr></thead>
              <tbody>
                {shown?.map((a) => (
                  <tr key={a.id} className={`${a.id === open ? "mk-row--on" : ""}${a.low ? " mk-row--low" : ""}`}
                    onClick={() => setOpen(a.id === open ? "" : a.id)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") setOpen(a.id === open ? "" : a.id); }}>
                    <td><strong>{a.name}</strong>{a.manufacturer || a.mpn ? <span className="mk-muted"> · {[a.manufacturer, a.mpn].filter(Boolean).join(" ")}</span> : null}
                      {a.tracking === "serial" && <span className="mk-pill">{t("mt.serial")}</span>}
                      {a.proposed && <span className="mk-pill mk-pill--warn">{t("mt.proposed")}</span>}</td>
                    <td>{categoryName(a.category, lang, !cat.includes("/"))}</td>
                    <td className="mk-num">{a.onHand} {a.unit !== "pcs" ? a.unit : ""}</td>
                    <td className="mk-num">{a.reserved}</td>
                    <td className="mk-num">{a.free}{a.low && <span className="mk-pill mk-pill--warn">{t("mt.low")}</span>}</td>
                  </tr>
                ))}
                {shown?.length === 0 && <tr><td colSpan={5} className="mk-muted">{q || cat ? t("mt.nomatch") : t("mt.none")}</td></tr>}
                {!list && !error && <tr><td colSpan={5} className="mk-muted">…</td></tr>}
              </tbody>
            </table>
          </div>
          {open && <ArticlePanel key={open} tenantId={w} id={open} admin={admin} onChanged={load}
            onDeleted={() => { setOpen(""); load(); }}
            onLabels={(items, layout) => setLabels({ items, layout })} />}
          {admin && (
            <div className="mk-panel">
              <h2 className="mk-panel__title">{t("mt.blank")}</h2>
              <p className="mk-panel__hint">{t("mt.blank.hint")}</p>
              <form className="mk-toolbar" onSubmit={(e) => { e.preventDefault(); void mintBlank(); }}>
                <input className="mk-input mk-input--num" type="number" min={1} max={240} value={blank}
                  onChange={(e) => setBlank(Number(e.target.value))} aria-label={t("mt.blank.n")} />
                <select className="mk-select" value={blankFamily} onChange={(e) => setBlankFamily(e.target.value as m.Family)} aria-label={t("mt.blank.family")}>
                  <option value="m5">{t("mt.blank.m5")}</option>
                  <option value="dhc">{t("mt.blank.dhc")}</option>
                </select>
                <button type="submit" className="mk-button mk-button--ghost">{t("mt.blank.make")}</button>
              </form>
            </div>
          )}
        </div>
      )}
      {error && <p className="mk-error" role="alert">{error}</p>}
      {labels && <LabelSheet tenantId={w} items={labels.items} layout={labels.layout} onClose={() => setLabels(null)} />}
      {queueOpen && w && <QueueSheet tenantId={w} onClose={() => setQueueOpen(false)} />}
    </Shell>
  );
};

/** The organisation's boxes: find one, make one, print their labels. */
/** The print queue's button: how many labels wait for a sheet. */
function QueueButton({ tenantId, onOpen }: { tenantId: string; onOpen: () => void }) {
  const { t } = useT();
  const n = useQueue(tenantId).length;
  return <button type="button" className="mk-button mk-button--ghost" onClick={onOpen}>{t("lq.open", { n })}</button>;
}

function BoxesPanel({ tenantId, admin, onLabels }: { tenantId: string; admin: boolean; onLabels: (items: LabelItem[], layout?: Layout) => void }) {
  const { t } = useT();
  const [list, setList] = React.useState<m.Box[] | null>(null);
  const [spaces, setSpaces] = React.useState<Space[]>([]);
  const [q, setQ] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [batch, setBatch] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => { m.boxes(tenantId, q).then(setList).catch((e) => setError(message(e))); }, [tenantId, q]);
  React.useEffect(() => { const id = window.setTimeout(load, q ? 250 : 0); return () => window.clearTimeout(id); }, [load, q]);
  React.useEffect(() => { void listSpaces().then((vs) => setSpaces(vs.filter((v) => v.tenantId === tenantId))); }, [tenantId]);
  const spaceName = (id?: string) => spaces.find((v) => v.id === id)?.name;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); return true; } catch (e) { setError(message(e)); return false; }
  };
  /** Each chosen box's own code, minting and binding one where a box has none. */
  const print = () => run(async () => {
    const chosen = (list ?? []).filter((b) => picked.has(b.id));
    const items: LabelItem[] = [];
    for (const b of chosen) {
      const d = await m.box(tenantId, b.id);
      let code = d.codes.find((c) => c.kind === "m5")?.value;
      if (!code) {
        code = (await m.mintCodes(tenantId, 1))[0].code;
        await m.bindCode(tenantId, code, "box", b.id);
      }
      items.push({ code, title: b.name, sub: spaceName(b.spaceId) ?? b.location ?? "" });
    }
    onLabels(items);
  });
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
  return (
    <div className="mk-noprint">
      <div className="mk-panel">
        <p className="mk-panel__hint">{t("bx.hint")}</p>
        <div className="mk-toolbar">
          <input className="mk-input" type="search" placeholder={t("bx.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("bx.search")} />
          <button type="button" className="mk-button" onClick={() => setAdding(!adding)}>{t("bx.new")}</button>
          {admin && <button type="button" className="mk-button mk-button--ghost" onClick={() => setBatch(!batch)}>{t("bx.batch")}</button>}
          {admin && <button type="button" className="mk-button mk-button--ghost" disabled={!picked.size} onClick={() => void print()}>{t("bx.labels", { n: picked.size })}</button>}
        </div>
        {adding && <EditBox tenantId={tenantId} spaces={spaces} run={run} onCancel={() => setAdding(false)}
          onSaved={(b) => { setAdding(false); window.location.assign(m.boxHref(tenantId, b.id)); }} />}
        {batch && <BatchBoxes tenantId={tenantId} boxes={list ?? []} run={run}
          onCancel={() => setBatch(false)}
          onMade={(made, parent, layout) => { setBatch(false); load(); onLabels(made.map((b) => ({ code: b.code, title: b.name, sub: parent ?? "" })), layout); }} />}
        {error && <p className="mk-error" role="alert">{error}</p>}
        <table className="mk-table">
          <thead><tr>
            {admin && <th aria-label={t("bx.pick")} />}
            <th>{t("bx.f.name")}</th><th>{t("bx.where")}</th><th>{t("shell.space")}</th><th className="mk-num">{t("bx.artifacts")}</th>
          </tr></thead>
          <tbody>
            {list?.map((b) => (
              <tr key={b.id}>
                {admin && <td><input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} aria-label={b.name} /></td>}
                <td><a href={m.boxHref(tenantId, b.id)}><strong>{b.name}</strong></a> <span className="mk-muted">· {t(`bx.kind.${b.kind}`)}</span></td>
                <td>{b.parentName ? `${t("bx.inbox")} ${b.parentName}` : b.location ?? "—"}</td>
                <td>{spaceName(b.spaceId) ?? "—"}</td>
                <td className="mk-num">{Number(b.links ?? 0) + Number(b.files ?? 0) || ""}</td>
              </tr>
            ))}
            {list?.length === 0 && <tr><td colSpan={5} className="mk-muted">{q ? t("mt.nomatch") : t("bx.none")}</td></tr>}
            {!list && !error && <tr><td colSpan={5} className="mk-muted">…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * New boxes with their labels at once: numbered ("Box 01" …, a sheet of 21
 * by default) or named one a line (a wall cabinet, a workbench). Each gets
 * its code now; what is in it and where it sits come later, by scanning.
 */
function BatchBoxes({ tenantId, boxes, run, onMade, onCancel }: {
  tenantId: string; boxes: m.Box[]; run: (fn: () => Promise<unknown>) => Promise<boolean>;
  onMade: (made: Array<{ code: string; name: string }>, parent: string | undefined, layout: Layout) => void; onCancel: () => void;
}) {
  const { t } = useT();
  const [named, setNamed] = React.useState(false);
  const [n, setN] = React.useState(21);
  const [prefix, setPrefix] = React.useState(() => t("bx.batch.prefix"));
  const [names, setNames] = React.useState("");
  const [kind, setKind] = React.useState<m.Box["kind"]>("box");
  const [parentId, setParentId] = React.useState("");
  const [start, setStart] = React.useState("");          // empty: after the highest number taken
  const [layout, setLayout] = React.useState<Layout>("box");
  const [busy, setBusy] = React.useState(false);
  const next = nextNumber(prefix || t("bx.batch.prefix"), boxes.map((b) => b.name));
  const make = async () => {
    setBusy(true);
    let made: Array<{ code: string; name: string }> = [];
    const ok = await run(async () => {
      made = await m.makeBoxes(tenantId, {
        ...(named ? { names: names.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) }
          : { n, prefix: prefix.trim() || undefined, start: Number(start) || next }),
        kind, parentId: parentId || undefined,
      });
    });
    setBusy(false);
    if (ok) onMade(made, boxes.find((b) => b.id === parentId)?.name, layout);
  };
  return (
    <form className="mk-form mk-batchboxes" onSubmit={(e) => { e.preventDefault(); void make(); }}>
      <p className="mk-panel__hint">{t("bx.batch.hint")}</p>
      <div className="mk-seg" role="radiogroup" aria-label={t("bx.batch")}>
        <button type="button" role="radio" aria-checked={!named} className={!named ? "mk-seg__option mk-seg__option--on" : "mk-seg__option"} onClick={() => setNamed(false)}>{t("bx.batch.numbered")}</button>
        <button type="button" role="radio" aria-checked={named} className={named ? "mk-seg__option mk-seg__option--on" : "mk-seg__option"} onClick={() => { setNamed(true); if (kind === "box") setKind("cabinet"); }}>{t("bx.batch.named")}</button>
      </div>
      {named ? (
        <label className="mk-field">{t("bx.batch.names")}
          <textarea className="mk-input" rows={4} value={names} onChange={(e) => setNames(e.target.value)} placeholder={t("bx.batch.namesEg")} /></label>
      ) : (
        <>
        <div className="mk-toolbar">
          <label className="mk-field">{t("bx.batch.n")}
            <input className="mk-input mk-input--num" type="number" min={1} max={48} value={n} onChange={(e) => setN(Number(e.target.value))} /></label>
          <label className="mk-field">{t("bx.batch.prefixLabel")}
            <input className="mk-input" maxLength={60} value={prefix} onChange={(e) => setPrefix(e.target.value)} /></label>
          <label className="mk-field">{t("bx.batch.start")}
            <input className="mk-input mk-input--num" type="number" min={1} max={9999} value={start} placeholder={String(next).padStart(2, "0")}
              onChange={(e) => setStart(e.target.value)} /></label>
        </div>
        <p className="mk-muted">{t("bx.batch.names.preview", {
          first: `${(prefix || t("bx.batch.prefix")).trim()} ${String(Number(start) || next).padStart(2, "0")}`,
          last: `${(prefix || t("bx.batch.prefix")).trim()} ${String((Number(start) || next) + Math.max(0, n - 1)).padStart(2, "0")}` })}</p>
        </>
      )}
      <div className="mk-toolbar">
        <label className="mk-field">{t("bx.f.kind")}
          <select className="mk-select" value={kind} onChange={(e) => setKind(e.target.value as m.Box["kind"])}>
            {m.BOX_KINDS.map((k) => <option key={k} value={k}>{t(`bx.kind.${k}`)}</option>)}
          </select></label>
        <label className="mk-field">{t("bx.batch.label")}
          <select className="mk-select" value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
            <option value="box">{t("lb.box")}</option>
            <option value="smallbox">{t("lb.smallbox")}</option>
          </select></label>
        <label className="mk-field">{t("bx.batch.inside")}
          <select className="mk-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("bx.batch.top")}</option>
            {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
      </div>
      <button type="submit" className="mk-button" disabled={busy || (named ? !names.trim() : !(n >= 1 && n <= 48))}>
        {t("bx.batch.make", { n: named ? names.split(/\n/).filter((x) => x.trim()).length : n })}</button>{" "}
      <button type="button" className="mk-button mk-button--ghost" onClick={onCancel}>{t("mt.cancel")}</button>
    </form>
  );
}

function ArticleForm({ tenantId, article, onDone }: { tenantId: string; article?: Article; onDone: (a: Article | null) => void }) {
  const { t, lang } = useT();
  const [f, setF] = React.useState<Partial<Article>>(article ? { ...article, category: categoryOf(article.category) }
    : { category: "components", tracking: "bulk", unit: "pcs" });
  const fTop = (f.category ?? "other").split("/")[0];
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
      <select className="mk-select" value={fTop} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label={t("mt.category")}>
        {topCategories().map((c) => <option key={c.code} value={c.code}>{c.label[lang] ?? c.label.en}</option>)}
      </select>
      {subCategories(fTop).length > 0 && (
        <select className="mk-select" value={f.category} onChange={set("category")} aria-label={t("mt.subcategory")}>
          <option value={fTop}>{t("mt.subcategory.any")}</option>
          {subCategories(fTop).map((c) => <option key={c.code} value={c.code}>{c.label[lang] ?? c.label.en}</option>)}
        </select>
      )}
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

function ArticlePanel({ tenantId, id, admin, onChanged, onDeleted, onLabels }: {
  tenantId: string; id: string; admin: boolean; onChanged: () => void; onDeleted: () => void;
  onLabels: (items: LabelItem[], layout: Layout) => void;
}) {
  const { t, lang } = useT();
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
      {editing && !a.proposed && (
        <p className="mk-panel__hint">
          <button type="button" className="mk-linkbutton mk-danger" onClick={() => {
            const units = d.units.length;
            if (!window.confirm(t("mt.delete.ask", { name: a.name, n: a.tracking === "serial" ? units : a.onHand }))) return;
            setError(null);
            m.deleteArticle(tenantId, a.id).then(() => onDeleted(), (e) => setError(message(e)));
          }}>{t("mt.delete")}</button>
        </p>
      )}
      <dl className="mk-stats">
        <div className="mk-stat"><dt>{a.onHand}</dt><dd>{t("mt.onhand")}</dd></div>
        <div className="mk-stat"><dt>{a.reserved}</dt><dd>{t("mt.reserved")}</dd></div>
        <div className="mk-stat"><dt>{a.free}</dt><dd>{t("mt.free")}</dd></div>
        {a.minStock !== undefined && <div className="mk-stat"><dt>{a.minStock}</dt><dd>{t("mt.f.min")}</dd></div>}
      </dl>
      <p className="mk-panel__hint">
        {[categoryName(a.category, lang, true), a.manufacturer, a.mpn, a.location && `${t("mt.f.location")}: ${a.location}`].filter(Boolean).join(" · ")}
        {a.datasheet && <> · <a href={a.datasheet} target="_blank" rel="noreferrer">{t("mt.f.datasheet")}</a></>}
        {(a.supplierRefs ?? []).map((r) => { const l = m.shopLink(r); return <React.Fragment key={r}> · {l.href
          ? <a href={l.href} target="_blank" rel="noreferrer">{l.label}</a> : l.label}</React.Fragment>; })}
      </p>
      {a.note && <p className="mk-panel__hint">{a.note}</p>}
      {(a.files ?? []).length > 0 && (
        <div className="mk-docs">
          <h3 className="mk-docs__title">{t("mt.docs")}</h3>
          <ul className="mk-docs__list">
            {(a.files ?? []).map((f) => (
              <li key={f.id}>
                <button type="button" className="mk-linkbutton" onClick={() => void m.articleFileUrl(tenantId, a.id, f.id)
                  .then((x) => window.location.assign(x.url), (e) => setError(message(e)))}>{f.name}</button>
                <span className="mk-muted"> · {t(`bx.link.${f.kind}`)}{f.source ? ` · ${f.source}` : ""} · {f.at.slice(0, 10)}</span>{" "}
                <button type="button" className="mk-linkbutton" aria-label={t("mt.docs.remove", { name: f.name })}
                  onClick={() => { if (window.confirm(t("mt.docs.removeAsk", { name: f.name }))) void run(() => m.articleFileRemove(tenantId, a.id, f.id), t("mt.docs.removed")); }}>
                  {t("mt.docs.removeShort")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.proposed && (
        <div className="mk-take">
          <p><strong>{t("mt.proposed")}</strong> · {t("mt.proposed.by", { by: a.proposed.by, at: a.proposed.at.slice(0, 10) })}</p>
          {admin ? (
            <div className="mk-toolbar">
              <button type="button" className="mk-button" onClick={() => void run(() => m.acceptArticle(tenantId, a.id), t("mt.proposed.accepted"))}>{t("mt.proposed.accept")}</button>
              <button type="button" className="mk-button mk-button--ghost" onClick={() => void run(() => m.dropProposed(tenantId, a.id), t("mt.proposed.dropped"))}>{t("mt.proposed.drop")}</button>
            </div>
          ) : <p className="mk-muted">{t("mt.proposed.adminonly")}</p>}
          {error && <p className="mk-error" role="alert">{error}</p>}
        </div>
      )}
      {d.codes.length > 0 && (
        <p className="mk-panel__hint">{t("mt.codes")}: {d.codes.map((c) => <code key={c.pk} className="mk-id">{c.kind === "m5" ? c.value : `${c.kind}:${c.value}`}</code>)}</p>
      )}

      {admin && !a.proposed && (
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
          {a.tracking === "serial" ? (
            // the same code twice if wanted: on the device, and on its package
            <>
              <button type="button" className="mk-button mk-button--ghost" onClick={() => void labelsFor("smallbox")}>{t("mt.lb.small")}</button>
              <button type="button" className="mk-button mk-button--ghost" onClick={() => void labelsFor("article")}>{t("mt.lb.large")}</button>
              <button type="button" className="mk-button mk-button--ghost" onClick={() => void labelsFor("box")}>{t("mt.lb.package")}</button>
            </>
          ) : (
            <button type="button" className="mk-button mk-button--ghost" onClick={() => void labelsFor("article")}>{t("mt.labels")}</button>
          )}
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
