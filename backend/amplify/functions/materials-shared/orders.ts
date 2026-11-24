// Orders (ADR-0023 in maker-5-shared): what was bought, expected until the
// parcel is scanned at the shelf.
//
// An edge reads an order-confirmation e-mail (Amazon's first) and keeps only
// the order number, its date and the lines: title, ASIN, quantity, price.
// Each line is EXPECTED here until the intake checks an item in against it
// (intake.ts, Suggestion.orderLineId): that check-in, an admin's, books the
// stock and counts the line as arrived. Importing a line books nothing.
//
// The rules are here, without the tables, so they are tested on their own.

import { Refused, articleFields, qty } from "./stock";
import { WHAT, type What } from "./intake";

export const ORDER_LINE = /^o-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
export const LINE_STATUSES = ["open", "arrived", "dropped"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export const MAX_LINES = 50;          // in one call
export const MAX_OPEN = 500;          // waiting in one organisation
/** A shop by its domain: amazon.de, amazon.com, reichelt.de … */
export const SUPPLIER = /^[a-z0-9-]{2,40}(\.[a-z0-9-]{2,20}){1,3}$/;
/** An ASIN, or another shop's article number. */
export const SKU = /^[A-Z0-9][A-Z0-9-]{3,39}$/;
/** Where an article was bought: "<supplier>:<sku>". */
export { SUPPLIER_REF } from "./stock";
export const CURRENCIES = ["EUR", "GBP", "USD", "CHF"] as const;

export interface OrderLine {
  tenantId: string; id: string;
  supplier: string; orderRef: string; orderedAt?: string;
  title: string; sku?: string; qty: number; arrived: number;
  unitPrice?: number; currency?: (typeof CURRENCIES)[number];
  what: What;
  /** The article it is, when the stock has it already; else `article` describes a new one. */
  articleId?: string;
  article?: ReturnType<typeof articleFields>;
  status: LineStatus;
  key: string;
  at: string; by: string;
  arrivals?: Array<{ intakeId: string; qty: number; at: string; by: string }>;
}

const text = (v: unknown, max: number) => {
  const s = String(v ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, max);
  return s || undefined;
};

/** The order as a whole: the shop, its order number, when. */
export function orderFields(o: Record<string, unknown>) {
  const supplier = String(o.supplier ?? "").trim().toLowerCase();
  if (!SUPPLIER.test(supplier)) throw new Refused("An order names its shop by its domain, as amazon.de.");
  const orderRef = text(o.orderRef, 40);
  if (!orderRef || !/^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/.test(orderRef)) throw new Refused("An order needs its order number.");
  const orderedAt = o.orderedAt ? String(o.orderedAt) : undefined;
  if (orderedAt && !/^\d{4}-\d{2}-\d{2}/.test(orderedAt)) throw new Refused("An order's date is YYYY-MM-DD.");
  return { supplier, orderRef, orderedAt: orderedAt?.slice(0, 10) };
}

/** One line of an order, as the edge read it and the person kept it. */
export function lineFields(l: Record<string, unknown>) {
  const title = text(l.title, 200);
  if (!title) throw new Refused("An order line needs its title.");
  const sku = l.sku ? String(l.sku).trim().toUpperCase() : undefined;
  if (sku && !SKU.test(sku)) throw new Refused(`${sku} is no article number of a shop.`);
  const what = String(l.what ?? "bulk") as What;
  if (!(WHAT as readonly string[]).includes(what)) throw new Refused("A line is a device, a box of parts, or loose parts.");
  const n = qty(l.qty ?? 1, "A quantity");
  const unitPrice = l.unitPrice === undefined || l.unitPrice === null || l.unitPrice === "" ? undefined : Number(l.unitPrice);
  if (unitPrice !== undefined && !(unitPrice >= 0 && unitPrice < 1e6)) throw new Refused("A price is a positive amount.");
  const currency = l.currency ? String(l.currency).toUpperCase() as OrderLine["currency"] : undefined;
  if (currency && !(CURRENCIES as readonly string[]).includes(currency)) throw new Refused(`No currency ${currency}.`);
  const articleId = text(l.articleId, 20);
  const article = articleId ? undefined : articleFields({
    name: title.slice(0, 120), tracking: what === "device" ? "serial" : "bulk", ...((l.article ?? {}) as Record<string, unknown>),
  });
  return { title, sku, qty: n, unitPrice: unitPrice === undefined ? undefined : Math.round(unitPrice * 100) / 100, currency, what, articleId, article };
}

/** The same line imported twice is one line: shop, order and article number (or title). */
export const lineKey = (supplier: string, orderRef: string, l: { sku?: string; title: string }) =>
  `${supplier}|${orderRef}|${l.sku ?? l.title.toLowerCase()}`;

/** Where it was bought, for the article: "amazon.de:B0…". */
export const supplierRef = (l: Pick<OrderLine, "supplier" | "sku">) => (l.sku ? `${l.supplier}:${l.sku}` : undefined);

/** n more of a line arrived: its new count and status. Never more than ordered goes unremarked. */
export function arrive(l: Pick<OrderLine, "status" | "qty" | "arrived">, n: number) {
  if (l.status === "dropped") throw new Refused("That order line was dropped.");
  if (l.status === "arrived") throw new Refused("Everything of that order line has arrived already.");
  const arrived = (l.arrived ?? 0) + n;
  return { arrived, status: (arrived >= l.qty ? "arrived" : "open") as LineStatus };
}

/**
 * A suggestion that names an order line takes from it what it leaves out:
 * the article (the line's match, or the new one it describes), what it is,
 * and the quantity. What the describer says wins.
 */
export function fromLine(raw: Record<string, unknown>, l: Pick<OrderLine, "articleId" | "article" | "what" | "qty">) {
  const art = (raw.article ?? {}) as Record<string, unknown>;
  const has = Boolean(raw.articleId) || Boolean(art.name);
  return {
    ...raw,
    what: raw.what ?? l.what,
    qty: raw.qty ?? l.qty,
    ...(has ? {} : l.articleId ? { articleId: l.articleId } : { article: { ...l.article, ...art } }),
  };
}
