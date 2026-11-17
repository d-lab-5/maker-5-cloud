// Stock rules (ADR-0008 and ADR-0010 in maker-5-shared), kept free of AWS so
// they can be tested. store.ts turns them into DynamoDB writes.
//
// An article counts what the workspace has: onHand (in the store, reserved
// or not), reserved (taken by products, not yet used) and free (= onHand −
// reserved, kept as its own attribute so a reservation can be a CONDITIONAL
// write: free >= qty). A serialised article's counts follow its units.

import { randomInt } from "node:crypto";

export class Refused extends Error {}

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const mintId = (prefix: "a" | "u") =>
  `${prefix}-${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
export const ARTICLE = /^a-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
export const UNIT = /^u-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

export const CATEGORIES = ["compute", "storage", "electronic", "mechanical", "cable", "consumable", "tool", "other"] as const;
export const TRACKING = ["bulk", "serial"] as const;
export const UNITS_OF = ["pcs", "m", "g", "ml", "set"] as const;
export const UNIT_STATES = ["in-stock", "reserved", "in-use", "retired"] as const;

export type Tracking = (typeof TRACKING)[number];
export interface Article {
  tenantId: string; id: string; name: string; category: string; tracking: Tracking; unit: string;
  manufacturer?: string; mpn?: string; minStock?: number; location?: string; note?: string; datasheet?: string;
  onHand: number; reserved: number; free: number;
}
export interface Unit {
  tenantId: string; id: string; articleId: string; serial?: string; state: (typeof UNIT_STATES)[number];
  spaceId?: string; parentId?: string; location?: string;
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
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new Refused(`No category ${category}.`);
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
    name, category, tracking, unit, minStock, datasheet,
    manufacturer: text(a.manufacturer ?? existing?.manufacturer, 80),
    mpn: text(a.mpn ?? existing?.mpn, 80),
    location: text(a.location ?? existing?.location, 80),
    note: text(a.note ?? existing?.note, 500),
  };
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
