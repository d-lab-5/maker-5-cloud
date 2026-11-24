// The intake (ADR-0022 in maker-5-shared): what a person scanned at the
// shelf, waiting to be described and checked in.
//
// On the phone a person scans a shelf or a box (the place), then the labels
// of what goes there, each maybe with a photo, a note and a count. Nothing
// is in the stock yet: every scan is an item here. An edge's agent describes
// an item (a suggestion: which article, a device, a box of parts or loose
// parts, its serial, how many); a person checks it, changes it, and checks it
// in. Checking in is one transaction: the article (found or made), the
// received stock, the unit or the new box, the code bound, the item closed.
//
// The rules are here, without the tables, so they are tested on their own.

import { Refused, articleFields, qty, type Article } from "./stock";
import { family, type Family } from "./codes";

export const INTAKE = /^i-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
export const STATUSES = ["new", "described", "checked-in", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
/** What a scanned label is on: a device (one unit), a box or bag of parts, or loose parts. */
export const WHAT = ["device", "box", "bulk"] as const;
export type What = (typeof WHAT)[number];
export const BOXES_OF_PARTS = ["box", "bag", "folder", "drawer"] as const;
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SURE = ["high", "medium", "low"] as const;

export interface Photo { id: string; type: string; size: number }
export interface Suggestion {
  what: What;
  /** An article that exists already, to reuse; else `article` describes a new one. */
  articleId?: string;
  article?: ReturnType<typeof articleFields>;
  serial?: string;
  qty?: number;
  boxName?: string;
  boxKind?: (typeof BOXES_OF_PARTS)[number];
  /** How sure the describer is, field by field. */
  sure?: Record<string, (typeof SURE)[number]>;
  note?: string;
  /** The order line it arrived for (ADR-0023): check-in counts it there. */
  orderLineId?: string;
}
export interface IntakeItem {
  tenantId: string; id: string;
  code: { kind: string; value: string };
  family: Family;
  placeId?: string; placeName?: string;
  note?: string; qty?: number;
  photos: Photo[];
  status: Status;
  at: string; by: string;
  /** What the code pointed at already when it was scanned. */
  known?: { kind: string; id: string; name?: string };
  suggestion?: Suggestion; describedBy?: string; describedAt?: string;
  done?: { kind: "unit" | "box" | "article"; id: string; articleId: string; at: string; by: string };
}

const text = (v: unknown, max: number) => {
  const s = String(v ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, max);
  return s || undefined;
};

/** What the phone sends with a scan. */
export function captureFields(r: Record<string, unknown>) {
  const n = r.qty === undefined || r.qty === null || r.qty === "" ? undefined : qty(r.qty, "A count");
  return { note: text(r.note, 500), qty: n };
}

export function photoFields(f: Record<string, unknown>): { type: string; size: number } {
  const size = Number(f.size);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) throw new Refused("A photo is up to 8 MB.");
  const type = String(f.type ?? "");
  if (!(PHOTO_TYPES as readonly string[]).includes(type)) throw new Refused("A photo is a JPEG, PNG or WebP.");
  return { type, size };
}

/** A suggestion, checked as an admin's article would be. */
export function suggestionFields(s: Record<string, unknown>, item: Pick<IntakeItem, "family">): Suggestion {
  const what = String(s.what ?? "") as What;
  if (!(WHAT as readonly string[]).includes(what)) throw new Refused("An item is a device, a box of parts, or loose parts.");
  const articleId = text(s.articleId, 20);
  const raw = (s.article ?? {}) as Record<string, unknown>;
  const article = articleId ? undefined
    : articleFields({ tracking: what === "device" ? "serial" : "bulk", family: item.family, ...raw });
  const boxKind = String(s.boxKind ?? "box") as Suggestion["boxKind"];
  if (!(BOXES_OF_PARTS as readonly string[]).includes(String(boxKind))) throw new Refused(`No box kind ${boxKind} for parts.`);
  const sure: Suggestion["sure"] = {};
  for (const [k, v] of Object.entries((s.sure ?? {}) as Record<string, unknown>).slice(0, 20)) {
    if ((SURE as readonly string[]).includes(String(v)) && /^[a-zA-Z.]{1,30}$/.test(k)) sure[k] = v as (typeof SURE)[number];
  }
  const orderLineId = s.orderLineId ? String(s.orderLineId) : undefined;
  if (orderLineId && !/^o-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/.test(orderLineId)) throw new Refused("No such order line.");
  return {
    what, articleId, article, orderLineId,
    serial: text(s.serial, 80),
    qty: s.qty === undefined || s.qty === null || s.qty === "" ? undefined : qty(s.qty, "A count"),
    boxName: text(s.boxName, 120), boxKind, sure,
    note: text(s.note, 500),
  };
}

/** What checking an item in does, decided before anything is written. */
export interface Plan {
  what: What | "move";
  qty: number; serial?: string;
  /** What the scanned code gets bound to: our code goes on the unit or box, a
   *  product's barcode on the article; none when it points at something already. */
  bind: "unit" | "box" | "article" | "none";
  /** A label that is known already: its unit or box moves into the place. */
  move?: { kind: "unit" | "box"; id: string };
  /** A label known on an article: that is the article. */
  articleId?: string;
  boxName?: string; boxKind?: Suggestion["boxKind"];
}

/** The article an item checks in as: the known one, the suggested one, or none (a new one). */
export const articleOf = (item: Pick<IntakeItem, "known">, s?: Pick<Suggestion, "articleId">) =>
  item.known?.kind === "article" ? item.known.id : s?.articleId;

export function plan(item: IntakeItem, s: Suggestion | undefined, article?: Pick<Article, "tracking" | "name" | "proposed">): Plan {
  if (item.status === "checked-in") throw new Refused("This item is checked in already.");
  if (item.status === "dropped") throw new Refused("This item was dropped.");
  if (!item.placeId) throw new Refused("Scan the shelf or box it goes into first.");
  const k = item.known;
  if (k && (k.kind === "unit" || k.kind === "box")) {
    if (k.id === item.placeId) throw new Refused("A box does not go into itself.");
    return { what: "move", qty: k.kind === "unit" ? 1 : 0, bind: "none", move: { kind: k.kind, id: k.id } };
  }
  if (!s) throw new Refused("Describe the item first: which article, and a device, a box of parts or loose parts.");
  const tracking = article ? article.tracking : s.article?.tracking;
  if (!tracking) throw new Refused("Say which article it is, or describe a new one.");
  if (article?.proposed) throw new Refused("That article is only proposed; an admin accepts it first.");
  const ours = item.code.kind === "m5";
  const known = k?.kind === "article" ? { articleId: k.id } : {};
  if (s.what === "device") {
    if (tracking !== "serial") throw new Refused("A device is an article tracked unit by unit.");
    return { what: "device", qty: 1, serial: s.serial, bind: k ? "none" : ours ? "unit" : "article", ...known };
  }
  if (tracking !== "bulk") throw new Refused("Parts in a box, or loose, are an article counted in bulk.");
  const q = s.qty ?? item.qty ?? 1;
  if (s.what === "box") {
    return { what: "box", qty: q, bind: k ? "none" : ours ? "box" : "article", ...known,
      boxName: s.boxName ?? article?.name ?? s.article?.name, boxKind: s.boxKind ?? "box" };
  }
  return { what: "bulk", qty: q, bind: k ? "none" : "article", ...known };
}

export { family };
