import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { hasNfc, writeTag } from "../components/Scanner";
import { History } from "../components/History";
import { BoxCard } from "../components/BoxCard";
import { BindCard } from "../components/BindCard";
import { UnitPicker } from "../components/UnitPicker";
import * as m from "../lib/materials";
import { listSpaces, type Space } from "../lib/data";
import { useT } from "../lib/i18n";

/**
 * The card a code opens (ADR-0009 in maker-5-shared): a label's QR, an NFC
 * tag, or a code typed on /scan/. Phone first. It shows what the code points
 * at, and the steps one does on the bench: move it, put it into another unit,
 * note the firmware written to it, take it for a product or give it back.
 *
 *   /t/K7Q2M9  /T/K7Q2M9  /t/?c=<any code>     resolve a code
 *   /t/?w=<workspace>&u=<unit>                 a unit, from the stock page
 *   /t/?w=<organisation>&x=<box>               a box (ADR-0011)
 *
 * A blank code of ours, or a code nobody knows yet (an EAN on a box, a
 * manufacturer's QR), is offered to be bound to an article or a unit.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function codeFromLocation(pathname: string, search: string): { code?: string; w?: string; u?: string; x?: string } {
  const p = new URLSearchParams(search);
  const path = /^\/t\/([^/]+)\/?$/i.exec(pathname);
  return { code: p.get("c") ?? (path ? decodeURIComponent(path[1]) : undefined), w: p.get("w") ?? undefined, u: p.get("u") ?? undefined, x: p.get("x") ?? undefined };
}

const CardPage: React.FC<PageProps> = ({ location }) => {
  const { t } = useT();
  const [where, setWhere] = React.useState<{ code?: string; w?: string; u?: string; x?: string }>({});
  const [resolved, setResolved] = React.useState<m.Resolved | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const got = codeFromLocation(location.pathname, location.search);
    setWhere(got);
    if (got.code) m.resolveCode(got.code).then(setResolved).catch((e) => setError(message(e)));
  }, [location.pathname, location.search]);

  const unitRef = where.w && where.u ? { tenantId: where.w, id: where.u }
    : resolved?.status === "unit" ? { tenantId: resolved.tenantId, id: resolved.id } : null;

  const boxRef = where.w && where.x ? { tenantId: where.w, id: where.x }
    : resolved?.status === "box" ? { tenantId: resolved.tenantId, id: resolved.id } : null;

  return (
    <Shell active="scan" title={t("un.title")}>
      {error && <div className="mk-empty"><p className="mk-error" role="alert">{error}</p><p><a href="/scan/">{t("un.scanagain")}</a></p></div>}
      {!error && !unitRef && !boxRef && !resolved && <p className="mk-muted">…</p>}
      {boxRef && <BoxCard tenantId={boxRef.tenantId} id={boxRef.id} />}
      {unitRef && <UnitCard tenantId={unitRef.tenantId} id={unitRef.id} />}
      {resolved?.status === "article" && <ArticleCard tenantId={resolved.tenantId} id={resolved.id} serial={resolved.code.serial} />}
      {(resolved?.status === "blank" || resolved?.status === "unknown") && (
        <BindCard raw={where.code ?? ""} resolved={resolved} />
      )}
    </Shell>
  );
};

function ArticleCard({ tenantId, id, serial }: { tenantId: string; id: string; serial?: string }) {
  const { t } = useT();
  const [d, setD] = React.useState<Awaited<ReturnType<typeof m.article>> | null>(null);
  const [admin, setAdmin] = React.useState(false);
  React.useEffect(() => { void m.article(tenantId, id).then(setD); }, [tenantId, id]);
  React.useEffect(() => { void m.stockWorkspaces().then((ws) => setAdmin(Boolean(ws.find((w) => w.id === tenantId)?.admin))); }, [tenantId]);
  if (!d) return <p className="mk-muted">…</p>;
  const a = d.article;
  return (
    <div className="mk-card">
      <p className="mk-muted">{t(`cat.${a.category}`)}{a.manufacturer ? ` · ${a.manufacturer}` : ""}{a.mpn ? ` ${a.mpn}` : ""}</p>
      <h1>{a.name}</h1>
      <dl className="mk-stats">
        <div className="mk-stat"><dt>{a.free}</dt><dd>{t("mt.free")}</dd></div>
        <div className="mk-stat"><dt>{a.reserved}</dt><dd>{t("mt.reserved")}</dd></div>
        <div className="mk-stat"><dt>{a.onHand}</dt><dd>{t("mt.onhand")}</dd></div>
      </dl>
      {a.location && <p>{t("mt.f.location")}: <strong>{a.location}</strong></p>}
      {d.boxes.length > 0 && <p>{t("bx.inboxes")}: {d.boxes.map((x) => (
        <a key={x.boxId} href={m.boxHref(tenantId, x.boxId)} className="mk-chip">{x.name ?? x.boxId} · {x.qty}</a>
      ))}</p>}
      {a.tracking === "serial" ? (
        // a product's barcode names the article; which unit is in the hand?
        <UnitPicker tenantId={tenantId} articleId={a.id} serial={serial} admin={admin} action={t("un.open")}
          onPick={(u) => window.location.assign(m.unitHref(tenantId, u.id))} />
      ) : <TakeForProduct tenantId={tenantId} article={a} />}
      <p><a href={`/materials/?w=${tenantId}&a=${a.id}`}>{t("un.instock")}</a></p>
    </div>
  );
}

function UnitCard({ tenantId, id }: { tenantId: string; id: string }) {
  const { t, date } = useT();
  const [d, setD] = React.useState<Awaited<ReturnType<typeof m.unit>> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<"" | "move" | "install" | "flash" | "alias">("");
  const [v1, setV1] = React.useState("");
  const [v2, setV2] = React.useState("");
  const load = React.useCallback(() => { m.unit(tenantId, id).then(setD).catch((e) => setError(message(e))); }, [tenantId, id]);
  React.useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null); setOk(null);
    try { await fn(); setOk(done); setForm(""); setV1(""); setV2(""); load(); } catch (e) { setError(message(e)); }
  };
  if (!d) return <p className="mk-muted">{error ?? "…"}</p>;
  const u = d.unit;
  const own = d.codes.find((c) => c.kind === "m5")?.value;

  const parentFromCode = async (raw: string) => {
    const r = await m.resolveCode(raw);
    if (r.status !== "unit" || r.tenantId !== tenantId) throw new Error(t("un.notaunit"));
    return r.id;
  };

  return (
    <div className="mk-card">
      <p className="mk-muted">{d.article ? `${t(`cat.${d.article.category}`)} · ` : ""}{own ? <code className="mk-id">{own}</code> : null}</p>
      <h1>{u.name || d.article?.name || u.articleId}</h1>
      {u.name && d.article && <p className="mk-muted">{d.article.name}</p>}
      {u.serial && <p>{t("un.serial")}: <strong>{u.serial}</strong></p>}
      <dl className="mk-facts">
        <dt>{t("un.state")}</dt><dd>{t(`state.${u.state}`)}{d.space ? <> · <a href={`/w/${d.space.id}/materials/`}>{d.space.name}</a></> : null}</dd>
        <dt>{t("mt.f.location")}</dt><dd>{d.box ? <>{t("bx.inbox")} <a href={m.boxHref(tenantId, d.box.id)}>{d.box.name}</a></>
          : u.holder ? t("bx.with", { name: u.holder.by }) : u.location ?? "—"}</dd>
        <dt>{t("un.inside")}</dt><dd>{d.parent ? <a href={m.unitHref(tenantId, d.parent.id)}>{d.parent.articleName ?? d.parent.id}{d.parent.serial ? ` · ${d.parent.serial}` : ""}</a> : "—"}</dd>
        <dt>{t("un.holds")}</dt><dd>{d.children.length ? d.children.map((c) => (
          <a key={c.id} href={m.unitHref(tenantId, c.id)} className="mk-chip">{c.articleName ?? c.id}{c.firmware ? ` · ${c.firmware.name} ${c.firmware.version}` : ""}</a>
        )) : "—"}</dd>
        <dt>{t("un.firmware")}</dt><dd>{u.firmware ? <>{u.firmware.name} <strong>{u.firmware.version}</strong> <span className="mk-muted">· {date(u.firmware.at, true)} · {u.firmware.by}</span></> : "—"}</dd>
      </dl>

      {u.state !== "retired" && (
        <div className="mk-actions">
          <button type="button" className="mk-button mk-button--ghost" onClick={() => setForm(form === "move" ? "" : "move")}>{t("un.move")}</button>
          <button type="button" className="mk-button mk-button--ghost" onClick={() => setForm(form === "install" ? "" : "install")}>{u.parentId ? t("un.takeout") : t("un.install")}</button>
          <button type="button" className="mk-button mk-button--ghost" onClick={() => setForm(form === "flash" ? "" : "flash")}>{t("un.flash")}</button>
          <button type="button" className="mk-button mk-button--ghost" onClick={() => setForm(form === "alias" ? "" : "alias")}>{t("un.alias")}</button>
          {own && hasNfc() && (
            <button type="button" className="mk-button mk-button--ghost" onClick={() => {
              const lock = window.confirm(t("un.nfc.lock"));
              void run(() => writeTag(m.labelUrl(own).toLowerCase(), lock), t("un.nfc.done"));
            }}>{t("un.nfc")}</button>
          )}
        </div>
      )}
      {form === "move" && (
        <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void run(() => m.changeUnit(tenantId, id, { location: v1 }), t("un.moved")); }}>
          <input className="mk-input" autoFocus placeholder={t("un.move.where")} value={v1} onChange={(e) => setV1(e.target.value)} />
          <button type="submit" className="mk-button">{t("mt.save")}</button>
        </form>
      )}
      {form === "install" && (u.parentId ? (
        <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void run(() => m.changeUnit(tenantId, id, { parentId: null }), t("un.takenout")); }}>
          <p>{t("un.takeout.hint", { name: d.parent?.articleName ?? "" })}</p>
          <button type="submit" className="mk-button">{t("un.takeout")}</button>
        </form>
      ) : (
        <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void run(async () => m.changeUnit(tenantId, id, { parentId: await parentFromCode(v1) }), t("un.installed")); }}>
          <input className="mk-input" autoFocus placeholder={t("un.install.code")} value={v1} onChange={(e) => setV1(e.target.value)} />
          <button type="submit" className="mk-button" disabled={!v1.trim()}>{t("un.install")}</button>
        </form>
      ))}
      {form === "flash" && (
        <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void run(() => m.changeUnit(tenantId, id, { firmware: { name: v1, version: v2 } }), t("un.flashed")); }}>
          <input className="mk-input" autoFocus placeholder={t("un.flash.name")} value={v1} onChange={(e) => setV1(e.target.value)} />
          <input className="mk-input" placeholder={t("un.flash.version")} value={v2} onChange={(e) => setV2(e.target.value)} />
          <button type="submit" className="mk-button" disabled={!v1.trim() || !v2.trim()}>{t("mt.save")}</button>
        </form>
      )}
      {form === "alias" && (
        <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void run(() => m.bindCode(tenantId, v1, "unit", id), t("un.aliased")); }}>
          <input className="mk-input" autoFocus placeholder={t("un.alias.code")} value={v1} onChange={(e) => setV1(e.target.value)} />
          <button type="submit" className="mk-button" disabled={!v1.trim()}>{t("mt.save")}</button>
          <span className="mk-muted">{t("un.alias.hint")}</span>
        </form>
      )}
      {d.article && u.state !== "retired" && <TakeForProduct tenantId={tenantId} article={d.article} unit={u} onDone={load} />}
      {ok && <p className="mk-ok" role="status">{ok}</p>}
      {error && <p className="mk-error" role="alert">{error}</p>}
      {d.codes.length > 0 && <p className="mk-muted">{t("mt.codes")}: {d.codes.map((c) => <code key={c.pk} className="mk-id">{c.kind === "m5" ? c.value : `${c.kind}:${c.value}`}</code>)}</p>}
      <History movements={d.movements} />
    </div>
  );
}

/** Take this article (or this unit) for a product, or give it back. */
function TakeForProduct({ tenantId, article, unit, onDone }: { tenantId: string; article: m.Article; unit?: m.Unit; onDone?: () => void }) {
  const { t } = useT();
  const [spaces, setSpaces] = React.useState<Space[]>([]);
  const [space, setSpace] = React.useState(unit?.spaceId ?? "");
  const [qty, setQty] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  React.useEffect(() => { void listSpaces().then((vs) => setSpaces(vs.filter((v) => v.tenantId === tenantId))); }, [tenantId]);
  const go = async (s: m.Step) => {
    setError(null); setOk(null);
    try {
      await m.step(s, space, article.id, unit ? { unitId: unit.id } : { qty });
      setOk(t(`wm.done.${s}`)); onDone?.();
    } catch (e) { setError(message(e)); }
  };
  const steps: m.Step[] = !unit ? ["reserve"] : unit.state === "in-stock" ? ["reserve"] : unit.state === "reserved" ? ["consume", "release"] : unit.state === "in-use" ? ["return"] : [];
  if (!steps.length || !spaces.length) return null;
  return (
    <div className="mk-take">
      <h3 className="mk-panel__sub">{t("un.forproduct")}</h3>
      <div className="mk-toolbar">
        <select className="mk-select" value={space} onChange={(e) => setSpace(e.target.value)} disabled={Boolean(unit?.spaceId)} aria-label={t("shell.space")}>
          <option value="">{t("un.whichproduct")}</option>
          {spaces.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {!unit && <input className="mk-input mk-input--num" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label={t("wm.qty")} />}
        {steps.map((s) => (
          <button key={s} type="button" className={s === "reserve" || s === "consume" ? "mk-button" : "mk-button mk-button--ghost"}
            disabled={!space} onClick={() => void go(s)}>{t(`wm.${s}`)}</button>
        ))}
      </div>
      {ok && <p className="mk-ok" role="status">{ok}</p>}
      {error && <p className="mk-error" role="alert">{error}</p>}
    </div>
  );
}

export default CardPage;
export const Head: HeadFC = () => <title>Card · maker5.cloud</title>;
