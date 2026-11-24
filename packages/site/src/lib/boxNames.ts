/** Box names in a batch (Materials → Boxes → New boxes with labels); pure, so it is tested alone. */

/** The number after the highest "<prefix> NN" taken, as the backend counts. */
export function nextNumber(prefix: string, names: string[]) {
  const esc = prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc} (\\d+)$`, "i");
  return names.reduce((n, x) => Math.max(n, Number(re.exec(x)?.[1] ?? 0)), 0) + 1;
}
