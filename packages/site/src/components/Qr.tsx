import * as React from "react";
import qrcode from "qrcode-generator";

/**
 * A QR code as SVG: for two-step sign-in and for labels (ADR-0009 in
 * maker-5-shared). Text made only of QR's alphanumeric characters (capitals,
 * digits, space and $%*+-./:) is encoded in that mode, so a label URL fits a
 * smaller code. `ecc` L is for the tiniest labels; M elsewhere.
 */
export function Qr({ text, size = 176, ecc = "M", quiet = 4, label = "QR code" }: {
  text: string; size?: number | string; ecc?: "L" | "M" | "Q" | "H"; quiet?: number; label?: string;
}) {
  const q = qrcode(0, ecc);
  q.addData(text, /^[0-9A-Z $%*+\-./:]*$/.test(text) ? "Alphanumeric" : "Byte");
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const w = n + 2 * quiet;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${w} ${w}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={w} height={w} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** The module count a text needs: what decides how small a label can be printed. */
export function qrModules(text: string, ecc: "L" | "M" = "M"): number {
  const q = qrcode(0, ecc);
  q.addData(text, /^[0-9A-Z $%*+\-./:]*$/.test(text) ? "Alphanumeric" : "Byte");
  q.make();
  return q.getModuleCount();
}
