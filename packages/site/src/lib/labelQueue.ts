import * as React from "react";
import type { Size } from "./labelPack";

/**
 * Labels waiting to be printed, collected from articles, units, boxes and
 * blank codes until a sheet is worth printing. Kept in this browser, per
 * organisation (a print queue is a desk's, not a team's); a private window
 * or blocked storage just forgets it. Also the part-used sheet: how far down
 * its labels were cut off, so the next print starts below.
 */

export interface Queued { code: string; title?: string; sub?: string; size: Size }

const KEY = (tenantId: string) => `mk-labelq:${tenantId}`;
const TOP = (tenantId: string) => `mk-labelq-top:${tenantId}`;
const EVENT = "mk-labelq";

function read<X>(key: string, empty: X): X {
  try { const v = window.localStorage.getItem(key); return v ? (JSON.parse(v) as X) : empty; } catch { return empty; }
}
function write(key: string, v: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* forgotten */ }
  window.dispatchEvent(new Event(EVENT));
}

export const queued = (tenantId: string): Queued[] => read<Queued[]>(KEY(tenantId), []);

/** Add labels; the same code in the same size is there once. */
export function enqueue(tenantId: string, items: Queued[]) {
  const have = queued(tenantId);
  const seen = new Set(have.map((x) => `${x.size}:${x.code}`));
  write(KEY(tenantId), [...have, ...items.filter((x) => !seen.has(`${x.size}:${x.code}`))]);
}
export const dequeue = (tenantId: string, code: string, size: Size) =>
  write(KEY(tenantId), queued(tenantId).filter((x) => !(x.code === code && x.size === size)));
export const clearQueue = (tenantId: string) => write(KEY(tenantId), []);

/** mm already cut off the top of the part-used sheet in the printer. */
export const usedTop = (tenantId: string) => read<number>(TOP(tenantId), 0);
export const setUsedTop = (tenantId: string, mm: number) => write(TOP(tenantId), Math.max(0, Math.min(280, Math.round(mm))));

/** Re-render when the queue changes, here or in another tab. */
export function useQueue(tenantId: string): Queued[] {
  const [q, setQ] = React.useState<Queued[]>([]);
  React.useEffect(() => {
    const load = () => setQ(queued(tenantId));
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => { window.removeEventListener(EVENT, load); window.removeEventListener("storage", load); };
  }, [tenantId]);
  return q;
}
