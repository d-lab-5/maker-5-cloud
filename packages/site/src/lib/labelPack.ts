/**
 * Labels of mixed sizes on as few A4 sheets as can hold them, for plain
 * sticker paper cut by hand (no die-cut grid). Pure: the print queue
 * (labelQueue.ts) and the sheet (components/Labels.tsx) use it.
 *
 * First fit, tallest first, in shelves: a shelf is as tall as its first
 * label; a label shorter than half the shelf stacks under one of its width
 * (tiny labels fill the room beside box labels), else it goes to the right,
 * else on a new shelf, else on a new sheet. A sheet whose top was used
 * already starts lower (usedTop), so a part-used sheet is used up.
 */

export type Size = "tiny" | "tag" | "article" | "box";

/** A label's cell in mm, as Labels.tsx draws it. */
export const CELL: Record<Size, { w: number; h: number }> = {
  tiny: { w: 14, h: 17 },
  tag: { w: 31, h: 31 },
  article: { w: 70, h: 37 },
  box: { w: 63.5, h: 38.1 },
};

/** A4, a margin most printers reach, and room to cut between labels. */
export const A4 = { w: 210, h: 297, margin: 7, gap: 2 };
export type Paper = typeof A4;

export interface Placed<T> { item: T; size: Size; x: number; y: number; w: number; h: number }

interface Column { x: number; w: number; bottom: number }
interface Shelf { sheet: number; y: number; h: number; right: number; cols: Column[] }

const EPS = 1e-6;

export function pack<T>(items: Array<{ item: T; size: Size }>, opts: { paper?: Paper; usedTop?: number } = {}) {
  const P = opts.paper ?? A4;
  const maxX = P.w - P.margin, maxY = P.h - P.margin;
  const top = (sheet: number) => P.margin + (sheet === 0 ? Math.max(0, opts.usedTop ?? 0) : 0);
  const order = items.map((x, i) => ({ ...x, i, ...CELL[x.size] }))
    .sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
  const sheets: Placed<T>[][] = [];
  const shelves: Shelf[] = [];
  const bottom: number[] = [];            // per sheet: where its lowest shelf ends
  const put = (sheet: number, it: (typeof order)[number], x: number, y: number) => {
    while (sheets.length <= sheet) sheets.push([]);
    sheets[sheet].push({ item: it.item, size: it.size, x, y, w: it.w, h: it.h });
  };
  for (const it of order) {
    if (it.w > P.w - 2 * P.margin + EPS || it.h > P.h - 2 * P.margin + EPS) throw new Error(`A ${it.size} label does not fit the paper.`);
    let done = false;
    for (const s of shelves) {
      // under a label of a column, when this one is no wider and the shelf has the height
      const col = s.cols.find((c) => it.w <= c.w + EPS && c.bottom + P.gap + it.h <= s.y + s.h + EPS);
      if (col) { put(s.sheet, it, col.x, col.bottom + P.gap); col.bottom += P.gap + it.h; done = true; break; }
      // to the right on the shelf
      const x = s.right + (s.cols.length ? P.gap : 0);
      if (it.h <= s.h + EPS && x + it.w <= maxX + EPS) {
        put(s.sheet, it, x, s.y); s.cols.push({ x, w: it.w, bottom: s.y + it.h }); s.right = x + it.w; done = true; break;
      }
    }
    if (done) continue;
    // a new shelf on the first sheet with the height left, else a new sheet
    let sheet = 0;
    for (;; sheet++) {
      const y = bottom[sheet] === undefined ? top(sheet) : bottom[sheet] + P.gap;
      if (y + it.h <= maxY + EPS) {
        shelves.push({ sheet, y, h: it.h, right: P.margin + it.w, cols: [{ x: P.margin, w: it.w, bottom: y + it.h }] });
        bottom[sheet] = y + it.h;
        put(sheet, it, P.margin, y);
        break;
      }
    }
  }
  const area = items.reduce((n, x) => n + CELL[x.size].w * CELL[x.size].h, 0);
  const last = sheets.length - 1;
  return {
    sheets,
    /** How much of the paper's printable area the labels cover. */
    fill: sheets.length ? area / (sheets.length * (P.w - 2 * P.margin) * (P.h - 2 * P.margin)) : 0,
    /** Where the last sheet's labels end, from its top edge: cut below, keep the rest. */
    lastBottom: last >= 0 ? Math.max(...sheets[last].map((p) => p.y + p.h)) : 0,
  };
}
