import * as React from "react";
import type { Space } from "../lib/data";
import * as m from "../lib/materials";
import { History } from "./History";
import { useT } from "../lib/i18n";

/**
 * What a product took from its workspace's stock (ADR-0010 in maker-5-shared):
 * reserved (put aside), used (built in, used up), and the units it holds.
 * Reserve from the catalogue here; consume, release or return per line.
 * A unit's own steps are on its card, which its code opens.
 */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SpaceMaterials({ space }: { space: Space }) {
  const { t } = useT();
  const [d, setD] = React.useState<Awaited<ReturnType<typeof m.spaceMaterials>> | null>(null);
  const [stock, setStock] = React.useState<m.Article[]>([]);
  const [pick, setPick] = React.useState("");
  const [qty, setQty] = React.useState(1);
  const [unitId, setUnitId] = React.useState("");
  const [freeUnits, setFreeUnits] = React.useState<m.Unit[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    m.spaceMaterials(space.id).then(setD).catch((e) => setError(message(e)));
    m.articles(space.tenantId).then(setStock).catch(() => undefined);
  }, [space.id, space.tenantId]);
  React.useEffect(load, [load]);
  const chosen = stock.find((a) => a.id === pick);
  React.useEffect(() => {
    setUnitId(""); setFreeUnits([]);
    if (chosen?.tracking === "serial") void m.article(space.tenantId, chosen.id).then((x) => setFreeUnits(x.units.filter((u) => u.state === "in-stock")));
  }, [pick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (s: m.Step, articleId: string, r: { qty?: number; unitId?: string }) => {
    setError(null); setOk(null);
    try { await m.step(s, space.id, articleId, r); setOk(t(`wm.done.${s}`)); load(); } catch (e) { setError(message(e)); }
  };

  return (
    <>
      <div className="mk-panel">
        <h2 className="mk-panel__title">{t("wm.title")}</h2>
        <p className="mk-panel__hint">{t("wm.hint", { name: space.tenantName ?? "" })}</p>
        <form className="mk-toolbar" onSubmit={(e) => {
          e.preventDefault();
          if (chosen) void run("reserve", chosen.id, chosen.tracking === "serial" ? { unitId } : { qty }).then(() => { setPick(""); setQty(1); });
        }}>
          <select className="mk-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("mt.article")}>
            <option value="">{t("wm.pick")}</option>
            {stock.filter((a) => a.free > 0).map((a) => <option key={a.id} value={a.id}>{a.name} · {t("wm.freeN", { n: a.free })}</option>)}
          </select>
          {chosen?.tracking === "bulk" && <input className="mk-input mk-input--num" type="number" min={1} max={chosen.free} value={qty}
            onChange={(e) => setQty(Number(e.target.value))} aria-label={t("wm.qty")} />}
          {chosen?.tracking === "serial" && (
            <select className="mk-select" value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label={t("un.bind.unit")}>
              <option value="">{t("un.bind.unit")}</option>
              {freeUnits.map((u) => <option key={u.id} value={u.id}>{u.serial || u.id}{u.location ? ` · ${u.location}` : ""}</option>)}
            </select>
          )}
          <button type="submit" className="mk-button" disabled={!chosen || (chosen.tracking === "serial" && !unitId)}>{t("wm.reserve")}</button>
          <a className="mk-linkbutton" href={`/materials/?w=${space.tenantId}`}>{t("wm.catalogue")}</a>
        </form>
        {ok && <p className="mk-ok" role="status">{ok}</p>}
        {error && <p className="mk-error" role="alert">{error}</p>}
        <table className="mk-table">
          <thead><tr><th>{t("mt.article")}</th><th className="mk-num">{t("mt.reserved")}</th><th className="mk-num">{t("wm.used")}</th><th /></tr></thead>
          <tbody>
            {d?.lines.map((l) => (
              <tr key={l.articleId}>
                <td><strong>{l.article?.name ?? l.articleId}</strong>
                  {l.units.length > 0 && <div>{l.units.map((u) => (
                    <a key={u.id} className="mk-chip" href={m.unitHref(space.tenantId, u.id)}>{u.serial || u.id} · {t(`state.${u.state}`)}</a>
                  ))}</div>}
                </td>
                <td className="mk-num">{l.reserved}</td>
                <td className="mk-num">{l.consumed}</td>
                <td>
                  {l.article?.tracking === "bulk" && (
                    <LineSteps line={l} onStep={(s, q) => void run(s, l.articleId, { qty: q })} />
                  )}
                </td>
              </tr>
            ))}
            {d && d.lines.length === 0 && <tr><td colSpan={4} className="mk-muted">{t("wm.none")}</td></tr>}
            {!d && !error && <tr><td colSpan={4} className="mk-muted">…</td></tr>}
          </tbody>
        </table>
      </div>
      {d && <div className="mk-panel"><History movements={d.movements} /></div>}
    </>
  );
}

function LineSteps({ line, onStep }: { line: { reserved: number; consumed: number }; onStep: (s: m.Step, q: number) => void }) {
  const { t } = useT();
  const [q, setQ] = React.useState(1);
  return (
    <span className="mk-toolbar">
      <input className="mk-input mk-input--num" type="number" min={1} value={q} onChange={(e) => setQ(Number(e.target.value))} aria-label={t("wm.qty")} />
      {line.reserved > 0 && <button type="button" className="mk-linkbutton" onClick={() => onStep("consume", q)}>{t("wm.consume")}</button>}
      {line.reserved > 0 && <button type="button" className="mk-linkbutton" onClick={() => onStep("release", q)}>{t("wm.release")}</button>}
      {line.consumed > 0 && <button type="button" className="mk-linkbutton" onClick={() => onStep("return", q)}>{t("wm.return")}</button>}
    </span>
  );
}
