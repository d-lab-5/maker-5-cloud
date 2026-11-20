/**
 * Article categories in two levels (ADR-0019 in maker-5-shared), from the
 * ontology's m5:ArticleCategories (categories.generated.ts, written by
 * backend/scripts/sync-ontology.mjs). The backend's materials-shared/stock.ts
 * applies the same rules; its tests and these pin them.
 */
import { CATEGORY_LIST, type Category } from "./categories.generated.js";

export { CATEGORY_LIST };
export type { Category };

export const CATEGORY_CODES: readonly string[] = CATEGORY_LIST.map((c) => c.code);
/** The one-level values articles were saved with before ontology 0.5.0. */
export const LEGACY_CATEGORIES: Readonly<Record<string, string>> = {
  compute: "controllers/sbc", storage: "controllers/storage", electronic: "components", mechanical: "mechanical",
  cable: "cables", consumable: "consumables", tool: "tools", other: "other",
};

export const categoryOf = (v: unknown): string => {
  const s = String(v ?? "");
  return CATEGORY_CODES.includes(s) ? s : Object.hasOwn(LEGACY_CATEGORIES, s) ? LEGACY_CATEGORIES[s] : "other";
};
export const topCategories = (): Category[] => CATEGORY_LIST.filter((c) => !c.top);
export const subCategories = (top: string): Category[] => CATEGORY_LIST.filter((c) => c.top === top);
export const inCategory = (value: string, filter: string): boolean => {
  if (!filter) return true;
  const c = categoryOf(value);
  return c === filter || c.startsWith(filter + "/");
};
/** A category's name in a language: "Single-board computers", or with its top: "Controllers & computers › Single-board computers". */
export function categoryName(code: string, lang: string, withTop = false): string {
  const c = CATEGORY_LIST.find((x) => x.code === categoryOf(code));
  if (!c) return code;
  const name = c.label[lang] ?? c.label.en ?? c.code;
  const top = c.top && withTop ? CATEGORY_LIST.find((x) => x.code === c.top) : undefined;
  return top ? `${top.label[lang] ?? top.label.en} › ${name}` : name;
}
/** Per category, how many accepted articles and how many free. */
export function catalogue(articles: Array<{ category: string; free: number; proposed?: unknown }>) {
  const n: Record<string, { articles: number; free: number }> = {};
  for (const c of CATEGORY_LIST) n[c.code] = { articles: 0, free: 0 };
  for (const a of articles) {
    if (a.proposed) continue;
    const c = categoryOf(a.category);
    for (const k of new Set([c, c.split("/")[0]])) { n[k].articles += 1; n[k].free += Math.max(0, a.free || 0); }
  }
  return n;
}
