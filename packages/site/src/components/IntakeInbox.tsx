import * as React from "react";
import { CATEGORY_CODES, categoryName } from "@dlab5/maker-5-core";
import * as m from "../lib/materials";
import type { Article } from "../lib/materials";
import { useT } from "../lib/i18n";

/**
 * The intake waiting to be checked in (ADR-0022 in maker-5-shared), on the
 * Materials page: what was scanned at the shelf, as the edge's agent described
 * it. Anyone looks, changes the description and drops an item; an admin with
 * two-step sign-in checks it in, here on the phone as on the edge.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WHAT = ["device", "box", "bulk"] as const;
type What = (typeof WHAT)[number];
const mark = (x: m.IntakeItem) => (x.code.kind === "m5" ? `${m.markOf(x.family)} ${x.code.value}` : x.code.value);

export function IntakeInbox({ tenantId, admin }: { tenantId: string; admin: boolean }) {
  const { t } = useT();
  const [items, setItems] = React.useState<m.IntakeItem[] | null>(null);
  const [open, setOpen] = React.useState("");
  const [error, setError] = React.useState("");
  const load = React.useCallback(() => {
    m.intake(tenantId).then(setItems).catch((e) => setError(message(e)));
  }, [tenantId]);
  React.useEffect(load, [load]);

  if (!items) return <p className="mk-muted">{error || t("ib.loading")}</p>;
  return (
    <div className="mk-intakebox">
      <p className="mk-panel__hint">{t("ib.lead", { n: items.length })}{" "}
        <a href="/scan/?mode=intake">{t("ib.scan")}</a></p>
      {!admin && items.length > 0 && <p className="mk-muted">{t("ib.adminonly")}</p>}
      {error && <p className="mk-error" role="alert">{error}</p>}
      <ul className="mk-list mk-intakebox__list">
        {items.map((x) => (
          <li key={x.id} className={x.id === open ? "is-open" : ""}>
            <button type="button" className="mk-intakebox__row" onClick={() => setOpen(x.id === open ? "" : x.id)} aria-expanded={x.id === open}>
              <code className="mk-id">{mark(x)}</code>{" "}
              <b>{x.known ? t("ib.known", { name: x.known.name ?? x.known.id })
                : x.suggestion ? `${t(`ib.what.${x.suggestion.what}`)}: ${x.suggestion.article?.name ?? ""}` : t("ib.notYet")}</b>
              <span className="mk-muted"> · {x.placeName}{x.note ? ` · ${x.note}` : ""}{x.qty ? ` · ${x.qty}` : ""}
                {x.photos.length ? ` · ${t("in.photos", { n: x.photos.length })}` : ""}</span>
            </button>
            {x.id === open && <Item tenantId={tenantId} id={x.id} admin={admin} onDone={() => { setOpen(""); load(); }} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Item({ tenantId, id, admin, onDone }: { tenantId: string; id: string; admin: boolean; onDone: () => void }) {
  const { t, lang } = useT();
  const [got, setGot] = React.useState<Awaited<ReturnType<typeof m.intakeGet>> | null>(null);
  const [what, setWhat] = React.useState<What | "">("");
  const [find, setFind] = React.useState("");
  const [found, setFound] = React.useState<Article[]>([]);
  const [articleId, setArticleId] = React.useState("");
  const [f, setF] = React.useState({ name: "", category: "", manufacturer: "", mpn: "", serial: "", qty: "", boxName: "", note: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState("");

  React.useEffect(() => {
    m.intakeGet(tenantId, id).then((g) => {
      setGot(g);
      const s = g.item.suggestion, a = s?.article ?? {};
      setWhat(s?.what ?? (g.item.family === "dhc" ? "device" : ""));
      setArticleId(s?.articleId ?? "");
      setFind(g.article?.name ?? "");
      setF({
        name: a.name ?? "", category: a.category ?? "", manufacturer: a.manufacturer ?? "", mpn: a.mpn ?? "",
        serial: s?.serial ?? "", qty: String(s?.qty ?? g.item.qty ?? ""), boxName: s?.boxName ?? "", note: (s as m.IntakeSuggestion | undefined)?.note ?? "",
      });
    }).catch((e) => setError(message(e)));
  }, [tenantId, id]);

  React.useEffect(() => {
    if (articleId || find.trim().length < 2) { setFound([]); return; }
    const timer = window.setTimeout(() => { m.articles(tenantId, find.trim()).then((l) => setFound(l.slice(0, 6))).catch(() => setFound([])); }, 250);
    return () => window.clearTimeout(timer);
  }, [tenantId, find, articleId]);

  if (!got) return <p className="mk-muted">{error || t("ib.loading")}</p>;
  const x = got.item;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const suggestion = (): m.IntakeSuggestion | undefined => {
    if (x.known || !what) return undefined;
    const out: m.IntakeSuggestion = { what };
    if (articleId) out.articleId = articleId;
    else out.article = { name: f.name.trim() || find.trim(), category: f.category.trim() || "other", manufacturer: f.manufacturer.trim() || undefined, mpn: f.mpn.trim() || undefined };
    if (what === "device" && f.serial.trim()) out.serial = f.serial.trim();
    if (what !== "device" && f.qty) out.qty = Number(f.qty);
    if (what === "box" && f.boxName.trim()) out.boxName = f.boxName.trim();
    if (f.note.trim()) out.note = f.note.trim();
    return out;
  };
  const run = async (fn: () => Promise<unknown>, after?: string) => {
    setError(""); setBusy(true);
    try { await fn(); if (after) setDone(after); else onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const checkIn = () => {
    const s = suggestion();
    if (!x.known && !s) { setError(t("ib.sayWhat")); return; }
    void run(async () => {
      const r = await m.intakeCheckIn(tenantId, id, s);
      setDone(x.known ? t("ib.done.moved", { place: x.placeName ?? "" }) : t(`ib.done.${r.kind}`, { place: x.placeName ?? "" }));
    }, undefined);
  };

  if (done) return (
    <div className="mk-intakebox__item"><p role="status">{done}</p>
      <button type="button" className="mk-button" onClick={onDone}>{t("ib.next")}</button></div>
  );
  return (
    <form className="mk-form mk-intakebox__item" onSubmit={(e) => { e.preventDefault(); checkIn(); }}>
      {got.photos.length > 0 && (
        <div className="mk-intakebox__photos">
          {got.photos.map((p) => <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={t("ib.photo")} /></a>)}
        </div>
      )}
      {x.known ? <p>{t("ib.knownMove", { name: x.known.name ?? x.known.id, place: x.placeName ?? "" })}</p> : (
        <>
          <div className="mk-seg" role="radiogroup" aria-label={t("ib.what")}>
            {WHAT.map((w) => (
              <button key={w} type="button" role="radio" aria-checked={what === w}
                className={what === w ? "mk-seg__option mk-seg__option--on" : "mk-seg__option"} onClick={() => setWhat(w)}>{t(`ib.what.${w}`)}</button>
            ))}
          </div>
          <label className="mk-field">{t("ib.article")}
            <input className="mk-input" value={find} placeholder={t("ib.find")} autoComplete="off"
              onChange={(e) => { setFind(e.target.value); setArticleId(""); }} /></label>
          {found.length > 0 && (
            <ul className="mk-list mk-intakebox__found">
              {found.map((a) => (
                <li key={a.id}><button type="button" className="mk-linkbutton" onClick={() => { setArticleId(a.id); setFind(a.name); setFound([]); }}>
                  {a.name} <span className="mk-muted">· {categoryName(a.category, lang)} · {a.free}</span></button></li>
              ))}
            </ul>
          )}
          {!articleId && (
            <>
              <label className="mk-field">{t("ib.name")}<input className="mk-input" maxLength={120} value={f.name} onChange={set("name")} /></label>
              <label className="mk-field">{t("ib.category")}
                <input className="mk-input" list="mk-intake-cats" value={f.category} onChange={set("category")} />
                <datalist id="mk-intake-cats">{CATEGORY_CODES.map((c) => <option key={c} value={c}>{categoryName(c, lang, true)}</option>)}</datalist></label>
              <label className="mk-field">{t("ib.maker")}<input className="mk-input" maxLength={80} value={f.manufacturer} onChange={set("manufacturer")} /></label>
              <label className="mk-field">{t("ib.mpn")}<input className="mk-input" maxLength={80} value={f.mpn} onChange={set("mpn")} /></label>
            </>
          )}
          {what === "device" && <label className="mk-field">{t("ib.serial")}<input className="mk-input" maxLength={80} value={f.serial} onChange={set("serial")} /></label>}
          {what && what !== "device" && <label className="mk-field">{t("in.qty")}<input className="mk-input mk-input--num" type="number" min={1} value={f.qty} onChange={set("qty")} /></label>}
          {what === "box" && <label className="mk-field">{t("ib.boxName")}<input className="mk-input" maxLength={120} value={f.boxName} onChange={set("boxName")} /></label>}
          <label className="mk-field">{t("ib.note")}<input className="mk-input" maxLength={500} value={f.note} onChange={set("note")} /></label>
        </>
      )}
      {error && <p className="mk-error" role="alert">{error}</p>}
      <div className="mk-actions">
        {admin && <button type="submit" className="mk-button" disabled={busy}>{t("ib.checkIn")}</button>}
        {!x.known && <button type="button" className="mk-button mk-button--ghost" disabled={busy || !what}
          onClick={() => { const s = suggestion(); if (s) void run(() => m.intakeDescribe(tenantId, id, s), t("ib.kept")); }}>{t("ib.keep")}</button>}
        <button type="button" className="mk-button mk-button--ghost" disabled={busy} onClick={() => void run(() => m.intakeDrop(tenantId, id))}>{t("in.drop")}</button>
      </div>
    </form>
  );
}
