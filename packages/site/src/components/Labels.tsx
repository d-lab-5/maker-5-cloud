import * as React from "react";
import { Qr } from "./Qr";
import { labelUrl, markOf, type Family } from "../lib/materials";
import { useT } from "../lib/i18n";
import { A4, pack } from "../lib/labelPack";
import { clearQueue, dequeue, enqueue, setUsedTop, usedTop, useQueue, type Queued } from "../lib/labelQueue";

/**
 * Label sheets for A4 sticker paper, printed by the browser (ADR-0009 in
 * maker-5-shared; the layouts are digitalhome-pro-edge's labels.py, in mm).
 *
 *   tiny      10 mm QR and its code: an SD card, a SIM, a cable end
 *   tag       20 mm QR, code and name: a part bag, a board
 *   article   70 × 37 mm: QR, name, part number, code (24 a sheet)
 *   box       63.5 × 38.1 mm (the common address label, 21 a sheet): a
 *             30 mm QR, read from a shelf 30 to 40 cm away, the box's name
 *             in bold, its code and workspace; for a carton, a bag, a drawer
 *
 * Every label prints its code as "M5 K7Q2M9", or "DHC K7Q2M9" for a code
 * minted for smart-home devices (ADR-0022): the mark tells which inventory a
 * label belongs to at a glance (the QR itself holds our URL, and a code typed
 * with its mark is found too).
 *
 * Two ways to print: a die-cut sheet of one layout (LabelSheet, with "skip"
 * for labels already used), or the print queue on plain sticker paper
 * (QueueSheet): labels of every size collected over time and packed onto as
 * few sheets as hold them (lib/labelPack.ts), with cut guides.
 *
 * The QR holds HTTPS://<this site's host>/T/<code>: version 2 at L for tiny,
 * which is 25 modules in 10 mm (0.4 mm each, fine for a 600 dpi laser).
 * Print at 100 % ("actual size"), never "fit to page".
 */

export interface LabelItem { code: string; title?: string; sub?: string; family?: Family }
export type Layout = "tiny" | "tag" | "article" | "box";

const SIZE: Record<Layout, { qr: number; ecc: "L" | "M" }> = {
  tiny: { qr: 10, ecc: "L" },
  tag: { qr: 20, ecc: "M" },
  article: { qr: 25, ecc: "M" },
  box: { qr: 30, ecc: "M" },
};

/** One label's content; its size and layout come from the class around it. */
function Label({ x, kind, className = "", style }: { x: LabelItem; kind: Layout; className?: string; style?: React.CSSProperties }) {
  const s = SIZE[kind];
  return (
    <div className={`mk-label ${className}`} style={style}>
      <div className="mk-label__qr" style={{ width: `${s.qr}mm`, height: `${s.qr}mm` }}>
        <Qr text={labelUrl(x.code)} size="100%" ecc={s.ecc} quiet={kind === "tiny" ? 1 : 2} label={x.code} />
      </div>
      <div className="mk-label__text">
        <span className="mk-label__code"><b className="mk-label__mark">{markOf(x.family)}</b> {x.code}</span>
        {kind !== "tiny" && x.title && <span className="mk-label__title">{x.title}</span>}
        {(kind === "article" || kind === "box") && x.sub && <span className="mk-label__sub">{x.sub}</span>}
      </div>
    </div>
  );
}

function useLabelsOpen() {
  React.useEffect(() => {
    document.body.classList.add("mk-labels-open");
    return () => document.body.classList.remove("mk-labels-open");
  }, []);
}

export function LabelSheet({ items, layout, onClose, tenantId }: {
  items: LabelItem[]; layout: Layout; onClose: () => void; tenantId?: string;
}) {
  const { t } = useT();
  const [kind, setKind] = React.useState<Layout>(layout);
  const [skip, setSkip] = React.useState(0);
  useLabelsOpen();
  const later = () => {
    if (!tenantId) return;
    enqueue(tenantId, items.map((x) => ({ ...x, size: kind })));
    onClose();
  };
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
        {tenantId && <button type="button" className="mk-button mk-button--ghost" onClick={later}>{t("lq.add", { n: items.length })}</button>}
        <button type="button" className="mk-button mk-button--ghost" onClick={onClose}>{t("lb.close")}</button>
        <span className="mk-muted">{t("lb.hint", { n: items.length })}</span>
      </div>
      <div className={`mk-sheet mk-sheet--${kind}`}>
        {Array.from({ length: skip }, (_, i) => <div key={`skip-${i}`} className="mk-label mk-label--empty" />)}
        {items.map((x) => <Label key={x.code} x={x} kind={kind} />)}
      </div>
    </div>
  );
}

/** The print queue on plain A4 sticker paper: every size, packed, with cut guides. */
export function QueueSheet({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const { t } = useT();
  const queue = useQueue(tenantId);
  const [top, setTop] = React.useState(() => usedTop(tenantId));
  const [guides, setGuides] = React.useState(true);
  useLabelsOpen();
  const packed = React.useMemo(() => {
    try { return pack(queue.map((x) => ({ item: x, size: x.size })), { usedTop: top }); } catch { return null; }
  }, [queue, top]);
  const printed = () => {
    if (!packed || !window.confirm(t("lq.printed.ask"))) return;
    // the last sheet's labels are cut off; what is left below starts the next print
    const left = A4.h - packed.lastBottom;
    setUsedTop(tenantId, left >= 25 ? packed.lastBottom + A4.gap - A4.margin : 0);
    clearQueue(tenantId);
    onClose();
  };
  const counts = (["box", "article", "tag", "tiny"] as const)
    .map((s) => [s, queue.filter((x) => x.size === s).length] as const).filter(([, n]) => n);
  return (
    <div className="mk-labels" role="dialog" aria-label={t("lq.title")}>
      <div className="mk-labels__bar mk-noprint">
        <strong>{t("lq.title")}</strong>
        <span className="mk-muted">{counts.map(([s, n]) => `${n} × ${t(`lq.size.${s}`)}`).join(" · ") || t("lq.empty")}</span>
        <label className="mk-muted">{t("lq.top")}{" "}
          <input className="mk-input mk-input--num" type="number" min={0} max={280} step={5} value={top}
            onChange={(e) => { const v = Math.max(0, Math.min(280, Number(e.target.value) || 0)); setTop(v); setUsedTop(tenantId, v); }} /> mm
        </label>
        <label className="mk-muted"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> {t("lq.guides")}</label>
        <button type="button" className="mk-button" disabled={!queue.length} onClick={() => window.print()}>{t("lb.print")}</button>
        <button type="button" className="mk-button mk-button--ghost" disabled={!queue.length} onClick={printed}>{t("lq.printed")}</button>
        <button type="button" className="mk-button mk-button--ghost" onClick={onClose}>{t("lb.close")}</button>
        {packed && queue.length > 0 && (
          <span className="mk-muted">{t("lq.summary", {
            sheets: packed.sheets.length, fill: Math.round(packed.fill * 100),
            left: Math.max(0, Math.round(A4.h - packed.lastBottom)),
          })}</span>
        )}
      </div>
      {queue.length > 0 && (
        <details className="mk-noprint mk-lq-list">
          <summary>{t("lq.list", { n: queue.length })}</summary>
          <ul>
            {queue.map((x) => (
              <li key={`${x.size}:${x.code}`}>
                <code className="mk-id">{x.code}</code> {x.title} <span className="mk-muted">· {t(`lq.size.${x.size}`)}</span>{" "}
                <button type="button" className="mk-linkbutton" onClick={() => dequeue(tenantId, x.code, x.size)}>{t("lq.remove")}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {packed?.sheets.map((sheet, i) => (
        <div key={i} className={`mk-qsheet${guides ? " mk-qsheet--guides" : ""}`}>
          {i === 0 && top > 0 && <div className="mk-qsheet__used mk-noprint" style={{ height: `${A4.margin + top}mm` }}>{t("lq.usedArea")}</div>}
          {sheet.map((p) => (
            <Label key={`${p.size}:${p.item.code}`} x={p.item} kind={p.size} className={`mk-k-${p.size} mk-qcell`}
              style={{ left: `${p.x}mm`, top: `${p.y}mm`, width: `${p.w}mm`, height: `${p.h}mm` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export type { Queued };
