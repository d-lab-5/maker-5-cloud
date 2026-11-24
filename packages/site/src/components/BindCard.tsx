import * as React from "react";
import * as m from "../lib/materials";
import { useT } from "../lib/i18n";

/**
 * A blank code of ours, or a code nobody here knows yet: bind it (ADR-0009 in
 * maker-5-shared).
 *
 *   our blank code      to an article, a unit (or a new one) or a box
 *   an EAN/GTIN         to an ARTICLE: every box of the same product has the
 *                       same one. A GS1 code's serial number is kept on the
 *                       unit it was bound for, so the code finds it again
 *   a maker's QR, NFC   to an article or a unit
 *
 * On /t/ it opens what it bound; inside a box's check-in, `onBound` carries on.
 */
export function BindCard({ raw, resolved, onBound, inline }: {
  raw: string; resolved: m.Resolved; onBound?: (r: { tenantId: string; kind: "article" | "unit"; id: string }) => void; inline?: boolean;
}) {
  const { t } = useT();
  const [ws, setWs] = React.useState<m.StockWorkspace[]>([]);
  const [w, setW] = React.useState(resolved.status === "blank" ? resolved.tenantId : "");
  const [list, setList] = React.useState<m.Article[]>([]);
  const [articleId, setArticleId] = React.useState("");
  const [units, setUnits] = React.useState<m.Unit[]>([]);
  const [target, setTarget] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const c = resolved.code;
  const product = c.kind === "ean";          // names the product, not one item
  React.useEffect(() => { void m.stockWorkspaces().then((x) => { setWs(x); if (!w && x[0]) setW(x[0].id); }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (w) void m.articles(w).then(setList); }, [w]);
  const chosen = list.find((a) => a.id === articleId);
  const perUnit = chosen?.tracking === "serial" && (!product || Boolean(c.serial));
  React.useEffect(() => {
    setTarget(""); setUnits([]);
    if (perUnit && chosen) void m.article(w, chosen.id).then((d) => setUnits(d.units.filter((u) => u.state !== "retired")));
  }, [articleId, perUnit]);   // eslint-disable-line react-hooks/exhaustive-deps
  const admin = ws.find((x) => x.id === w)?.admin;
  const bind = async () => {
    setError(null);
    try {
      let kind: "article" | "unit" = "article";
      let id = articleId;
      if (perUnit) {
        kind = "unit";
        id = target === "new"
          ? (await m.receive(w, articleId, { units: [{ serial: c.serial }], note: t("un.bind.newnote") })).units[0].id
          : target;
      }
      await m.bindCode(w, raw, kind, id);
      if (onBound) onBound({ tenantId: w, kind, id });
      else window.location.assign(kind === "unit" ? m.unitHref(w, id) : `/t/?c=${encodeURIComponent(raw)}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const Title = inline ? "strong" : "h1";
  return (
    <div className={inline ? "mk-take" : "mk-card"}>
      <p className="mk-muted">{c.kind === "m5" ? t("un.code.ours") : t(`un.code.${c.kind}`)}</p>
      <Title><code className="mk-id">{c.kind === "m5" ? c.value : c.value.startsWith("sha256:") ? raw.slice(0, 60) : c.value}</code></Title>
      {(c.serial || c.batch) && <p className="mk-muted">{c.serial && <>{t("un.serial")}: <strong>{c.serial}</strong> </>}{c.batch && <>{t("un.batch")}: {c.batch}</>}</p>}
      <p>{resolved.status === "blank" ? t("un.blank") : product ? t("un.unknown.product") : t("un.unknown")}</p>
      {product && !inline && (
        // a product nobody has yet: a new article, made from photos and a note in the intake (ADR-0022)
        <p><a className="mk-button" href={`/scan/?mode=intake&code=${encodeURIComponent(raw)}`}>{t("un.newViaIntake")}</a></p>
      )}
      {ws.length > 1 && resolved.status !== "blank" && (
        <select className="mk-select" value={w} onChange={(e) => setW(e.target.value)} aria-label={t("mt.workspace")}>
          {ws.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void bind(); }}>
        <select className="mk-select" value={articleId} onChange={(e) => setArticleId(e.target.value)} aria-label={t("mt.article")}>
          <option value="">{t("un.bind.article")}</option>
          {list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.mpn ? ` · ${a.mpn}` : ""}</option>)}
        </select>
        {perUnit && (
          <select className="mk-select" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("un.bind.unit")}>
            <option value="">{t("un.bind.unit")}</option>
            {admin && <option value="new">{c.serial ? t("un.bind.newserial", { serial: c.serial }) : t("un.bind.new")}</option>}
            {units.map((u) => <option key={u.id} value={u.id}>{u.name || u.serial || u.id} · {t(`state.${u.state}`)}</option>)}
          </select>
        )}
        <button type="submit" className="mk-button" disabled={!articleId || (perUnit && !target)}>{t("un.bind")}</button>
      </form>
      {admin && <p className="mk-muted">{t("un.bind.missing")} <a href={`/materials/?w=${w}`}>{t("mt.title")}</a></p>}
      {error && <p className="mk-error" role="alert">{error}</p>}
    </div>
  );
}
