import * as React from "react";
import * as m from "../lib/materials";
import { useT } from "../lib/i18n";

/**
 * "Which one?" A product's barcode (EAN/GTIN) names an article tracked unit
 * by unit, not one unit: list its units with where each is, and let the
 * person pick, or (an admin) receive a new one with the serial a GS1 code
 * gave. Used on the article's card and when checking parts into a box.
 */
export function UnitPicker({ tenantId, articleId, serial, skipBox, admin, action, onPick }: {
  tenantId: string; articleId: string; serial?: string; skipBox?: string; admin?: boolean;
  action: string; onPick: (u: m.Unit) => void | Promise<void>;
}) {
  const { t } = useT();
  const [units, setUnits] = React.useState<m.Unit[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    m.article(tenantId, articleId)
      .then((d) => setUnits(d.units.filter((u) => u.state !== "retired" && (!skipBox || u.boxId !== skipBox))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [tenantId, articleId, skipBox]);
  const pick = async (u: m.Unit) => {
    setError(null);
    try { await onPick(u); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const fresh = async () => {
    setError(null);
    try {
      const got = await m.receive(tenantId, articleId, { units: [{ serial }], note: t("un.bind.newnote") });
      await onPick(got.units[0]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const where = (u: m.Unit) => u.boxName ? `${t("bx.inbox")} ${u.boxName}` : u.holder ? t("bx.with", { name: u.holder.by }) : u.location ?? "";
  return (
    <div className="mk-take">
      <strong>{t("un.which")}</strong>
      {!units && !error && <p className="mk-muted">…</p>}
      {units?.length === 0 && <p className="mk-muted">{t("un.which.none")}</p>}
      <ul className="mk-boxlist">
        {units?.map((u) => (
          <li key={u.id} className="mk-boxlist__row">
            <span><strong>{u.name || u.serial || u.id}</strong>
              {u.name && u.serial && <span className="mk-muted"> · {u.serial}</span>}
              <span className="mk-muted"> · {t(`state.${u.state}`)}{where(u) ? ` · ${where(u)}` : ""}</span></span>
            <button type="button" className="mk-button mk-button--ghost" onClick={() => void pick(u)}>{action}</button>
          </li>
        ))}
      </ul>
      {admin && <button type="button" className="mk-button mk-button--ghost" onClick={() => void fresh()}>
        {serial ? t("un.bind.newserial", { serial }) : t("un.bind.new")}</button>}
      {error && <p className="mk-error" role="alert">{error}</p>}
    </div>
  );
}
