// Stock rules (ADR-0008 and ADR-0010 in maker-5-shared), kept free of AWS so
// they can be tested. store.ts turns them into DynamoDB writes.
//
// An article counts what the workspace has: onHand (in the store, reserved
// or not), reserved (taken by products, not yet used) and free (= onHand −
// reserved, kept as its own attribute so a reservation can be a CONDITIONAL
// write: free >= qty). A serialised article's counts follow its units.

import { randomInt } from "node:crypto";
import { CATEGORY_LIST } from "./categories.generated";

export class Refused extends Error {}

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const mintId = (prefix: "a" | "u" | "x") =>
  `${prefix}-${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
export const ARTICLE = /^a-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
export const UNIT = /^u-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
export const BOX = /^x-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

/** ADR-0019: two levels, "top" or "top/sub", from the ontology's m5:ArticleCategories. */
export const CATEGORIES: readonly string[] = CATEGORY_LIST.map((c) => c.code);
/** The one-level values articles were saved with before 0.5.0. */
export const LEGACY: Record<string, string> = {
  compute: "controllers/sbc", storage: "controllers/storage", electronic: "components", mechanical: "mechanical",
  cable: "cables", consumable: "consumables", tool: "tools", other: "other",
};
/** A category as it is now: an old value mapped, an unknown one "other". */
export const category = (v: unknown): string => {
  const s = String(v ?? "");
  return CATEGORIES.includes(s) ? s : Object.hasOwn(LEGACY, s) ? LEGACY[s] : "other";
};
/** Whether an article's category is the filter, or under it ("controllers" holds "controllers/sbc"). */
export const inCategory = (value: string, filter: string): boolean => {
  if (!filter) return true;
  const c = category(value), f = CATEGORIES.includes(filter) || !Object.hasOwn(LEGACY, filter) ? filter : LEGACY[filter];
  return c === f || c.startsWith(f + "/");
};

/** The catalogue's tiles: per category (top and sub), how many articles and how many free. */
export function catalogue(articles: Array<Pick<Article, "category" | "free"> & { proposed?: unknown }>) {
  const n: Record<string, { articles: number; free: number }> = {};
  for (const c of CATEGORY_LIST) n[c.code] = { articles: 0, free: 0 };
  for (const a of articles) {
    if (a.proposed) continue;
    const c = category(a.category);
    for (const k of new Set([c, c.split("/")[0]])) { n[k].articles += 1; n[k].free += Math.max(0, a.free || 0); }
  }
  return CATEGORY_LIST.map((c) => ({ code: c.code, top: c.top, label: c.label, ...n[c.code] }));
}
export const TRACKING = ["bulk", "serial"] as const;
export const UNITS_OF = ["pcs", "m", "g", "ml", "set"] as const;
export const UNIT_STATES = ["in-stock", "reserved", "in-use", "retired"] as const;

export type Tracking = (typeof TRACKING)[number];
export interface Article {
  tenantId: string; id: string; name: string; category: string; tracking: Tracking; unit: string;
  manufacturer?: string; mpn?: string; minStock?: number; location?: string; note?: string; datasheet?: string;
  onHand: number; reserved: number; free: number;
  /** How many of onHand sit in boxes (ADR-0011); never more than onHand. */
  boxed?: number;
  /** Proposed by an edge (a BOM import, ADR-0014) and not yet accepted by an
   *  admin: it has no stock, and nothing may be received or taken for it. */
  proposed?: { by: string; at: string };
}
export interface Unit {
  tenantId: string; id: string; articleId: string; serial?: string; state: (typeof UNIT_STATES)[number];
  spaceId?: string; parentId?: string; location?: string;
  /** The box it is in (ADR-0011), or who has it out of one. */
  boxId?: string; holder?: { by: string; at: string }; name?: string;
  firmware?: { name: string; version: string; at: string; by: string };
}

const text = (v: unknown, max: number) => {
  const s = String(v ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, max);
  return s || undefined;
};

export function qty(v: unknown, what = "A quantity"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new Refused(`${what} is a whole number from 1.`);
  return n;
}

/** The fields a person may set on an article; counts are never set this way. */
export function articleFields(a: Record<string, unknown>, existing?: Article) {
  const name = text(a.name ?? existing?.name, 120);
  if (!name) throw new Refused("An article needs a name.");
  const category = String(a.category ?? existing?.category ?? "other");
  if (!CATEGORIES.includes(category) && !Object.hasOwn(LEGACY, category)) throw new Refused(`No category ${category}.`);
  const tracking = String(a.tracking ?? existing?.tracking ?? "bulk") as Tracking;
  if (!(TRACKING as readonly string[]).includes(tracking)) throw new Refused("An article is tracked in bulk or unit by unit.");
  if (existing && existing.tracking !== tracking && existing.onHand > 0) {
    throw new Refused("How an article is tracked cannot change while it is in stock.");
  }
  const unit = tracking === "serial" ? "pcs" : String(a.unit ?? existing?.unit ?? "pcs");
  if (!(UNITS_OF as readonly string[]).includes(unit)) throw new Refused(`No unit ${unit}.`);
  const minStock = a.minStock === undefined || a.minStock === null || a.minStock === ""
    ? existing?.minStock : Math.max(0, Math.floor(Number(a.minStock)) || 0);
  const datasheet = text(a.datasheet ?? existing?.datasheet, 500);
  if (datasheet && !/^https:\/\//.test(datasheet)) throw new Refused("A datasheet is an https:// link.");
  return {
    name, category: CATEGORIES.includes(category) ? category : LEGACY[category], tracking, unit, minStock, datasheet,
    manufacturer: text(a.manufacturer ?? existing?.manufacturer, 80),
    mpn: text(a.mpn ?? existing?.mpn, 80),
    location: text(a.location ?? existing?.location, 80),
    note: text(a.note ?? existing?.note, 500),
  };
}

/* -- articles an edge proposes (ADR-0014) ---------------------------------- */

export const MAX_PROPOSE = 50;      // in one call
export const MAX_PROPOSED = 200;    // waiting in one organisation

/** The articles of one proposal, each checked as an admin's would be. */
export function proposalFields(list: unknown) {
  if (!Array.isArray(list) || list.length === 0) throw new Refused("Propose at least one article.");
  if (list.length > MAX_PROPOSE) throw new Refused(`At most ${MAX_PROPOSE} articles at once.`);
  return list.map((a) => articleFields((a ?? {}) as Record<string, unknown>));
}

/** Stock moves only for an accepted article. */
export function accepted(a: Pick<Article, "name" | "proposed">) {
  if (a.proposed) throw new Refused(`${a.name} is proposed, not accepted yet; an admin accepts it on Materials.`);
}

/** A unit may not end up inside itself: walk the new parent's chain. */
export function wouldLoop(unitId: string, parentId: string, parentOf: (id: string) => string | undefined): boolean {
  let at: string | undefined = parentId;
  for (let i = 0; at && i < 32; i++) {
    if (at === unitId) return true;
    at = parentOf(at);
  }
  return Boolean(at);   // deeper than 32: treat as a loop
}

/** What a step does to the article's counts and the product's allocation. */
export type Step = "reserve" | "release" | "consume" | "return";
export function counts(step: Step, q: number) {
  switch (step) {
    case "reserve": return { article: { reserved: +q, free: -q, onHand: 0 }, allocation: { reserved: +q, consumed: 0 }, need: { free: q } };
    case "release": return { article: { reserved: -q, free: +q, onHand: 0 }, allocation: { reserved: -q, consumed: 0 }, need: { reserved: q } };
    case "consume": return { article: { reserved: -q, free: 0, onHand: -q }, allocation: { reserved: -q, consumed: +q }, need: { reserved: q } };
    case "return": return { article: { reserved: 0, free: +q, onHand: +q }, allocation: { reserved: 0, consumed: -q }, need: { consumed: q } };
  }
}

/** The unit's state after a step, and the state it must be in before. */
export const UNIT_STEP: Record<Step, { from: Unit["state"]; to: Unit["state"] }> = {
  reserve: { from: "in-stock", to: "reserved" },
  release: { from: "reserved", to: "in-stock" },
  consume: { from: "reserved", to: "in-use" },
  return: { from: "in-use", to: "in-stock" },
};

/* --------------------------------------------------------------- boxes ---- *
 * A box (ADR-0011 in maker-5-shared) is a cardboard box, a bag, a folder, a
 * drawer or a shelf: something with a large label that holds units, counted
 * parts and other boxes, and keeps the links and files of what is in it.
 */

export const BOX_KINDS = ["box", "bag", "folder", "drawer", "shelf"] as const;
export const LINK_KINDS = ["firmware", "cad", "schematic", "datasheet", "docs", "repo", "other"] as const;
export const MAX_BOX_DEPTH = 8;
export const MAX_LINKS = 30;
export const MAX_FILES = 50;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface BoxLink { id: string; kind: (typeof LINK_KINDS)[number]; title: string; url: string; at: string; by: string }
export interface BoxFile { id: string; kind: (typeof LINK_KINDS)[number]; name: string; size: number; type: string; at: string; by: string }
export interface Box {
  tenantId: string; id: string; name: string; kind: (typeof BOX_KINDS)[number];
  parentId?: string; location?: string; spaceId?: string; note?: string;
  links?: BoxLink[]; files?: BoxFile[];
}

/** The fields a person sets on a box; where it sits is moveBox's. */
export function boxFields(b: Record<string, unknown>, existing?: Box) {
  const name = text(b.name ?? existing?.name, 120);
  if (!name) throw new Refused("A box needs a name.");
  const kind = String(b.kind ?? existing?.kind ?? "box");
  if (!(BOX_KINDS as readonly string[]).includes(kind)) throw new Refused(`No box kind ${kind}.`);
  const spaceId = b.spaceId === undefined ? existing?.spaceId : text(b.spaceId, 40);
  return {
    name, kind: kind as Box["kind"], spaceId,
    location: text(b.location ?? existing?.location, 80),
    note: text(b.note ?? existing?.note, 1000),
  };
}

/** A link a person adds to a box: an https URL of one of the known kinds. */
export function linkFields(l: Record<string, unknown>) {
  const url = String(l.url ?? "").trim();
  if (!/^https:\/\/[^\s]{3,}$/.test(url) || url.length > 1000) throw new Refused("A link is an https:// address.");
  const kind = String(l.kind ?? "other");
  if (!(LINK_KINDS as readonly string[]).includes(kind)) throw new Refused(`No link kind ${kind}.`);
  const title = text(l.title, 120) ?? url.replace(/^https:\/\//, "").slice(0, 120);
  return { url, kind: kind as BoxLink["kind"], title };
}

/** A file's name as it is kept: no path, no control characters. */
export function fileName(name: unknown) {
  const n = String(name ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f"]/g, "").trim().slice(0, 160);
  if (!n) throw new Refused("A file needs a name.");
  return n;
}

/**
 * Can `boxId` go into `parentId`? Not into itself or anything inside it, and
 * not deeper than MAX_BOX_DEPTH. `parentOf` walks up from the new parent.
 */
export function boxFits(boxId: string, parentId: string, parentOf: (id: string) => string | undefined): string | null {
  let at: string | undefined = parentId;
  let depth = 1;
  for (; at; depth++) {
    if (at === boxId) return "A box cannot go inside itself.";
    if (depth >= MAX_BOX_DEPTH) return `Boxes nest at most ${MAX_BOX_DEPTH} deep.`;
    at = parentOf(at);
  }
  return null;
}

/** May `q` more of an article go into boxes? Boxes never hold more than is on hand. */
export const boxable = (a: Pick<Article, "onHand" | "boxed">, q: number) => (a.boxed ?? 0) + q <= a.onHand;
