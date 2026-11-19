import * as React from "react";
import { Qr } from "./Qr";
import { labelUrl } from "../lib/materials";
import { useT } from "../lib/i18n";

/**
 * Label sheets for A4 sticker paper, printed by the browser (ADR-0009 in
 * maker-5-shared; the layouts are digitalhome-pro-edge's labels.py, in mm).
 *
 *   tiny      10 mm QR and its code: an SD card, a SIM, a cable end
 *   tag       20 mm QR, code and name: a part bag, a board
 *   article   70 × 37 mm: QR, name, part number, code (24 a sheet)
 *   box       95 × 65 mm: a 40 mm QR, the box's name large, its workspace
 *             and code (8 a sheet), for a carton, a bag, a drawer
 *
 * The QR holds HTTPS://<this site's host>/T/<code>: version 2 at L for tiny,
 * which is 25 modules in 10 mm (0.4 mm each, fine for a 600 dpi laser).
 * Print at 100 % ("actual size"), never "fit to page".
 */

export interface LabelItem { code: string; title?: string; sub?: string }
export type Layout = "tiny" | "tag" | "article" | "box";

const SIZE: Record<Layout, { qr: number; ecc: "L" | "M" }> = {
  tiny: { qr: 10, ecc: "L" },
  tag: { qr: 20, ecc: "M" },
  article: { qr: 25, ecc: "M" },
  box: { qr: 40, ecc: "M" },
};

export function LabelSheet({ items, layout, onClose }: { items: LabelItem[]; layout: Layout; onClose: () => void }) {
  const { t } = useT();
  const [kind, setKind] = React.useState<Layout>(layout);
  const [skip, setSkip] = React.useState(0);
  React.useEffect(() => {
    document.body.classList.add("mk-labels-open");
    return () => document.body.classList.remove("mk-labels-open");
  }, []);
  const s = SIZE[kind];
  return (
    <div className="mk-labels" role="dialog" aria-label={t("lb.title")}>
      <div className="mk-labels__bar mk-noprint">
        <strong>{t("lb.title")}</strong>
        <select className="mk-select" value={kind} onChange={(e) => setKind(e.target.value as Layout)} aria-label={t("lb.layout")}>
          <option value="tiny">{t("lb.tiny")}</option>
          <option value="tag">{t("lb.tag")}</option>
          <option value="article">{t("lb.article")}</option>
          <option value="box">{t("lb.box")}</option>
        </select>
        <label className="mk-muted">{t("lb.skip")}{" "}
          <input className="mk-input mk-input--num" type="number" min={0} max={200} value={skip}
            onChange={(e) => setSkip(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <button type="button" className="mk-button" onClick={() => window.print()}>{t("lb.print")}</button>
        <button type="button" className="mk-button mk-button--ghost" onClick={onClose}>{t("lb.close")}</button>
        <span className="mk-muted">{t("lb.hint", { n: items.length })}</span>
      </div>
      <div className={`mk-sheet mk-sheet--${kind}`}>
        {Array.from({ length: skip }, (_, i) => <div key={`skip-${i}`} className="mk-label mk-label--empty" />)}
        {items.map((x) => (
          <div key={x.code} className="mk-label">
            <div className="mk-label__qr" style={{ width: `${s.qr}mm`, height: `${s.qr}mm` }}>
              <Qr text={labelUrl(x.code)} size="100%" ecc={s.ecc} quiet={kind === "tiny" ? 1 : 2} label={x.code} />
            </div>
            <div className="mk-label__text">
              <span className="mk-label__code">{x.code}</span>
              {kind !== "tiny" && x.title && <span className="mk-label__title">{x.title}</span>}
              {(kind === "article" || kind === "box") && x.sub && <span className="mk-label__sub">{x.sub}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
