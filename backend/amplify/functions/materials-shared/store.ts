// The material tables (ADR-0008 in maker-5-shared), read and written for an
// Actor: a person through AppSync (functions/materials) or an edge through
// the edge API (functions/edgeMaterials). Every change is one DynamoDB
// transaction: the article's counts or the unit, the product's allocation,
// and an entry in the append-only movement log.
//
//   MkArticles     tenantId, id                    the workspace's catalogue and counts
//   MkUnits        tenantId, id                    tracked units; byArticle, bySpace, byParent
//   MkAllocations  spaceId, articleId              what a product took; byArticle
//   MkMovements    tenantId, sk (at#rand)          the log; byArticle, byUnit, bySpace
//   MkCodes        pk                              m5:XXXXXX, or tenantId#ean:…; byTarget
//   MkBoxes        tenantId, id                    boxes (ADR-0011); byParent, bySpace
//   MkBoxStock     boxId, articleId                counted parts in a box; byArticle

import { randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { doc, getSpace, type Space } from "../shared/spaces";
import { BadCode, codeKey, labelUrl, mintOwn, normalise, type Code } from "./codes";
import {
  ARTICLE, BOX, MAX_FILE_BYTES, MAX_FILES, MAX_LINKS, LINK_KINDS, UNIT, Refused, UNIT_STEP, articleFields, boxFields, boxFits, boxable,
  counts, fileName, linkFields, mintId, qty, wouldLoop, accepted, proposalFields, MAX_PROPOSED,
  type Article, type Box, type BoxFile, type BoxLink, type Step, type Unit
} from "./stock";

export { Refused, BadCode };

const T = {
  articles: () => process.env.ARTICLES_TABLE_NAME!,
  units: () => process.env.UNITS_TABLE_NAME!,
  allocations: () => process.env.ALLOCATIONS_TABLE_NAME!,
  movements: () => process.env.MOVEMENTS_TABLE_NAME!,
  codes: () => process.env.CODES_TABLE_NAME!,
  boxes: () => process.env.BOXES_TABLE_NAME!,
  boxStock: () => process.env.BOXSTOCK_TABLE_NAME!,
};

/** Who is asking, and what they may do. */
export interface Actor {
  /** For the log: an e-mail, or edge:<id>. */
  by: string;
  /** Workspaces whose stock this caller reads. */
  tenants: Set<string>;
  /** Edits the catalogue, receives and adjusts stock, mints codes. */
  admin(tenantId: string): boolean;
  /** May take parts for this product (it is a member, or an admin of its workspace). */
  usesSpace(space: Space): boolean;
}

const now = () => new Date().toISOString();
const sk = () => `${now()}#${randomBytes(3).toString("hex")}`;

function reads(actor: Actor, tenantId: string) {
  if (!actor.tenants.has(tenantId)) throw new Refused("You are not in that organisation.");
}
function administers(actor: Actor, tenantId: string) {
  reads(actor, tenantId);
  if (!actor.admin(tenantId)) throw new Refused("Only the organisation's admins do that.");
}

async function query<X>(params: Record<string, unknown>, limit = 1000): Promise<X[]> {
  const out: X[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await doc.send(new QueryCommand({ ...params, ExclusiveStartKey: start } as never));
    out.push(...((r.Items ?? []) as X[]));
    start = r.LastEvaluatedKey;
  } while (start && out.length < limit);
  return out.slice(0, limit);
}

export async function getArticleRow(tenantId: string, id: string): Promise<Article | null> {
  if (!ARTICLE.test(id)) return null;
  const r = await doc.send(new GetCommand({ TableName: T.articles(), Key: { tenantId, id } }));
  return (r.Item as Article) ?? null;
}
export async function getUnitRow(tenantId: string, id: string): Promise<Unit | null> {
  if (!UNIT.test(id)) return null;
  const r = await doc.send(new GetCommand({ TableName: T.units(), Key: { tenantId, id } }));
  return (r.Item as Unit) ?? null;
}
async function mustArticle(tenantId: string, id: string) {
  const a = await getArticleRow(tenantId, id);
  if (!a) throw new Refused("No such article in this organisation.");
  return a;
}
async function mustUnit(tenantId: string, id: string) {
  const u = await getUnitRow(tenantId, id);
  if (!u) throw new Refused("No such unit in this organisation.");
  return u;
}

const movement = (m: Record<string, unknown>) => ({
  Put: { TableName: T.movements(), Item: { sk: sk(), at: now(), ...m } },
});

const codesOf = (target: string) => query<{ pk: string; kind: string; value: string }>({
  TableName: T.codes(), IndexName: "byTarget", KeyConditionExpression: "#tg = :t",
  ExpressionAttributeNames: { "#tg": "target" }, ExpressionAttributeValues: { ":t": target },
}, 50);

const movementsBy = (index: "byArticle" | "byUnit" | "bySpace" | "byBox", key: string, value: string, limit = 50) =>
  query<Record<string, unknown>>({
    TableName: T.movements(), IndexName: index, KeyConditionExpression: `${key} = :v`,
    ExpressionAttributeValues: { ":v": value }, ScanIndexForward: false, Limit: limit,
  }, limit);

/* --------------------------------------------------------------- reads ---- */

export async function listArticles(actor: Actor, tenantId: string, q = "", category = "") {
  reads(actor, tenantId);
  const all = await query<Article>({
    TableName: T.articles(), KeyConditionExpression: "tenantId = :t", ExpressionAttributeValues: { ":t": tenantId },
  }, 5000);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter((a) => !category || a.category === category)
    .filter((a) => words.every((w) => `${a.name} ${a.manufacturer ?? ""} ${a.mpn ?? ""} ${a.location ?? ""}`.toLowerCase().includes(w)))
    .map((a) => ({ ...a, low: a.minStock !== undefined && a.free < a.minStock }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

export async function article(actor: Actor, tenantId: string, id: string) {
  reads(actor, tenantId);
  const a = await mustArticle(tenantId, id);
  const [units, allocations, movements, codes] = await Promise.all([
    a.tracking === "serial" ? query<Unit>({
      TableName: T.units(), IndexName: "byArticle", KeyConditionExpression: "articleId = :a", ExpressionAttributeValues: { ":a": id },
    }) : Promise.resolve([] as Unit[]),
    query<Record<string, unknown>>({
      TableName: T.allocations(), IndexName: "byArticle", KeyConditionExpression: "articleId = :a", ExpressionAttributeValues: { ":a": id },
    }),
    movementsBy("byArticle", "articleId", id),
    codesOf(id),
  ]);
  const held = await query<{ boxId: string; qty: number }>({
    TableName: T.boxStock(), IndexName: "byArticle", KeyConditionExpression: "articleId = :a", ExpressionAttributeValues: { ":a": id },
  });
  const boxIds = [...new Set([...held.filter((h) => h.qty > 0).map((h) => h.boxId), ...units.map((u) => u.boxId).filter(Boolean) as string[]])];
  const boxRows = await Promise.all(boxIds.map((b) => getBoxRow(tenantId, b)));
  const boxNames = Object.fromEntries(boxRows.filter(Boolean).map((b) => [b!.id, b!.name]));
  return {
    article: a, units: units.map((u) => ({ ...u, boxName: u.boxId ? boxNames[u.boxId] : undefined })), allocations, movements, codes,
    boxes: held.filter((h) => h.qty > 0).map((h) => ({ boxId: h.boxId, qty: h.qty, name: boxNames[h.boxId] })),
  };
}

export async function unit(actor: Actor, tenantId: string, id: string) {
  reads(actor, tenantId);
  const u = await mustUnit(tenantId, id);
  const [a, children, movements, codes, parent, space] = await Promise.all([
    getArticleRow(tenantId, u.articleId),
    query<Unit>({ TableName: T.units(), IndexName: "byParent", KeyConditionExpression: "parentId = :p", ExpressionAttributeValues: { ":p": id } }),
    movementsBy("byUnit", "unitId", id),
    codesOf(id),
    u.parentId ? getUnitRow(tenantId, u.parentId) : Promise.resolve(null),
    u.spaceId ? getSpace(u.spaceId) : Promise.resolve(null),
  ]);
  const names = await articleNames(tenantId, [...children.map((c) => c.articleId), parent?.articleId].filter(Boolean) as string[]);
  const boxRow = u.boxId ? await getBoxRow(tenantId, u.boxId) : null;
  return {
    unit: u, article: a, codes, movements,
    parent: parent ? { ...parent, articleName: names[parent.articleId] } : null,
    children: children.map((c) => ({ ...c, articleName: names[c.articleId] })),
    space: space ? { id: space.id, name: space.name } : null,
    box: boxRow ? { id: boxRow.id, name: boxRow.name } : null,
  };
}

async function articleNames(tenantId: string, ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return {};
  const r = await doc.send(new BatchGetCommand({
    RequestItems: { [T.articles()]: { Keys: unique.map((id) => ({ tenantId, id })), ProjectionExpression: "id, #n", ExpressionAttributeNames: { "#n": "name" } } },
  }));
  return Object.fromEntries(((r.Responses?.[T.articles()] ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
}

/**
 * The one live unit with this serial number in an organisation (of one
 * article, if given), as printed on a board or packed into a GS1 code. Two
 * units with the same serial are no answer.
 */
async function unitBySerial(tenantId: string, serial: string, articleId?: string): Promise<Unit | null> {
  const s = serial.trim();
  if (!s || s.length > 60) return null;
  const forms = [...new Set([s, s.toUpperCase(), s.toLowerCase()])];
  const names = Object.fromEntries(forms.map((_, i) => [`:s${i}`, forms[i]]));
  const found = await query<Unit>(articleId ? {
    TableName: T.units(), IndexName: "byArticle", KeyConditionExpression: "articleId = :a",
    FilterExpression: `serial IN (${Object.keys(names).join(", ")}) AND #st <> :r`,
    ExpressionAttributeNames: { "#st": "state" }, ExpressionAttributeValues: { ":a": articleId, ":r": "retired", ...names },
  } : {
    TableName: T.units(), KeyConditionExpression: "tenantId = :t",
    FilterExpression: `serial IN (${Object.keys(names).join(", ")}) AND #st <> :r`,
    ExpressionAttributeNames: { "#st": "state" }, ExpressionAttributeValues: { ":t": tenantId, ":r": "retired", ...names },
  }, 5);
  const live = found.filter((u) => u.tenantId === tenantId);
  return live.length === 1 ? live[0] : null;
}

/**
 * What a scanned or typed code points at, in the caller's organisations.
 *
 *   our code, or an alias          what it is bound to
 *   a GTIN with a serial (GS1)     the unit of that article with that serial,
 *                                  else the article, with the serial to pick by
 *   a code nobody bound            a unit whose serial it is (a Code 128 or a
 *                                  MAC sticker on a board), else unknown
 */
export async function resolve(actor: Actor, raw: string) {
  const code = normalise(raw);
  const tenants = code.kind === "m5" ? [""] : [...actor.tenants];
  for (const t of tenants) {
    const r = await doc.send(new GetCommand({ TableName: T.codes(), Key: { pk: codeKey(code, t) } }));
    const row = r.Item as { tenantId: string; target?: string; targetKind?: string } | undefined;
    if (!row) continue;
    if (!actor.tenants.has(row.tenantId)) break;   // somebody else's: as if unknown
    if (!row.target) return { status: "blank", code, tenantId: row.tenantId };
    if (row.targetKind === "article" && code.serial) {
      const u = await unitBySerial(row.tenantId, code.serial, row.target);
      if (u) return { status: "unit", code, tenantId: row.tenantId, id: u.id, articleId: row.target };
    }
    return { status: row.targetKind, code, tenantId: row.tenantId, id: row.target };
  }
  if (code.kind !== "m5") {
    const serial = code.serial ?? (code.kind === "qr" && !code.value.startsWith("sha256:") ? code.value : undefined);
    if (serial) {
      for (const t of actor.tenants) {
        const u = await unitBySerial(t, serial);
        if (u) return { status: "unit", code, tenantId: t, id: u.id, articleId: u.articleId, bySerial: true };
      }
    }
  }
  return { status: "unknown", code };
}

export async function spaceMaterials(actor: Actor, spaceId: string) {
  const space = await usable(actor, spaceId);
  const [allocations, units, movements] = await Promise.all([
    query<{ articleId: string; reserved: number; consumed: number }>({
      TableName: T.allocations(), KeyConditionExpression: "spaceId = :s", ExpressionAttributeValues: { ":s": spaceId },
    }),
    query<Unit>({ TableName: T.units(), IndexName: "bySpace", KeyConditionExpression: "spaceId = :s", ExpressionAttributeValues: { ":s": spaceId } }),
    movementsBy("bySpace", "spaceId", spaceId, 30),
  ]);
  const ids = [...allocations.map((x) => x.articleId), ...units.map((u) => u.articleId)];
  const rows = await Promise.all([...new Set(ids)].map((id) => getArticleRow(space.tenantId, id)));
  const byId = Object.fromEntries(rows.filter(Boolean).map((a) => [a!.id, a!]));
  return {
    space: { id: space.id, name: space.name, tenantId: space.tenantId, tenantName: space.tenantName },
    lines: allocations.filter((x) => x.reserved || x.consumed).map((x) => ({
      ...x, article: byId[x.articleId] ?? null, units: units.filter((u) => u.articleId === x.articleId),
    })),
    movements,
  };
}

async function usable(actor: Actor, spaceId: string): Promise<Space> {
  const space = await getSpace(spaceId);
  if (!space || !actor.tenants.has(space.tenantId) || !actor.usesSpace(space)) throw new Refused("You do not work in that workspace.");
  return space;
}

/* ----------------------------------------------------------- catalogue ---- */

export async function saveArticle(actor: Actor, tenantId: string, a: Record<string, unknown>) {
  administers(actor, tenantId);
  const id = a.id ? String(a.id) : "";
  const existing = id ? await mustArticle(tenantId, id) : undefined;
  const f = articleFields(a, existing);
  if (existing) {
    const item = { ...existing, ...f, updatedAt: now() };
    await doc.send(new PutCommand({ TableName: T.articles(), Item: item }));
    return item;
  }
  const item: Article & Record<string, unknown> = {
    ...f, tenantId, id: mintId("a"), onHand: 0, reserved: 0, free: 0, createdAt: now(), updatedAt: now(), createdBy: actor.by,
  } as Article & Record<string, unknown>;
  await doc.send(new PutCommand({ TableName: T.articles(), Item: item, ConditionExpression: "attribute_not_exists(id)" }));
  return item;
}

/**
 * An edge proposes articles a BOM needs (ADR-0014). Each is made with no
 * stock and marked proposed until an admin accepts it; one whose name an
 * article already has is not made again, and the existing one is returned.
 */
export async function proposeArticles(actor: Actor, tenantId: string, list: unknown) {
  reads(actor, tenantId);
  const fields = proposalFields(list);
  const all = await query<Article>({
    TableName: T.articles(), KeyConditionExpression: "tenantId = :t", ExpressionAttributeValues: { ":t": tenantId },
  }, 5000);
  const byName = new Map(all.map((a) => [a.name.toLowerCase(), a]));
  const waiting = all.filter((a) => a.proposed).length;
  const fresh = fields.filter((f, i) => !byName.has(f.name.toLowerCase())
    && fields.findIndex((g) => g.name.toLowerCase() === f.name.toLowerCase()) === i);
  if (waiting + fresh.length > MAX_PROPOSED) {
    throw new Refused(`${waiting} proposed articles wait already; accept or delete some on Materials first.`);
  }
  const out: Array<{ id: string; name: string; status: "proposed" | "exists" }> = [];
  for (const f of fields) {
    const known = byName.get(f.name.toLowerCase());
    if (known) { out.push({ id: known.id, name: known.name, status: "exists" }); continue; }
    const item = {
      ...f, tenantId, id: mintId("a"), onHand: 0, reserved: 0, free: 0,
      proposed: { by: actor.by, at: now() }, createdAt: now(), updatedAt: now(), createdBy: actor.by,
    };
    await doc.send(new PutCommand({ TableName: T.articles(), Item: item, ConditionExpression: "attribute_not_exists(id)" }));
    byName.set(f.name.toLowerCase(), item as unknown as Article);
    out.push({ id: item.id, name: item.name, status: "proposed" });
  }
  return { articles: out };
}

/** An admin accepts a proposed article: from now on it is like any other. */
export async function acceptArticle(actor: Actor, tenantId: string, id: string) {
  administers(actor, tenantId);
  const a = await mustArticle(tenantId, id);
  if (!a.proposed) return a;
  await doc.send(new UpdateCommand({
    TableName: T.articles(), Key: { tenantId, id }, UpdateExpression: "SET updatedAt = :at REMOVE proposed",
    ConditionExpression: "attribute_exists(id)", ExpressionAttributeValues: { ":at": now() },
  }));
  const { proposed: _p, ...rest } = a;
  return rest;
}

/** An admin turns a proposal down: only a proposed article, which has no stock. */
export async function dropProposed(actor: Actor, tenantId: string, id: string) {
  administers(actor, tenantId);
  const a = await mustArticle(tenantId, id);
  if (!a.proposed) throw new Refused("Only a proposed article is deleted; an accepted one is retired by its stock.");
  await doc.send(new DeleteCommand({
    TableName: T.articles(), Key: { tenantId, id },
    ConditionExpression: "attribute_exists(proposed) AND onHand = :z", ExpressionAttributeValues: { ":z": 0 },
  }));
  return { deleted: id };
}

/** Stock comes in: a quantity of a bulk article, or units of a serialised one. */
export async function receive(actor: Actor, tenantId: string, articleId: string,
  r: { qty?: number; units?: Array<{ serial?: string; location?: string }>; note?: string }) {
  administers(actor, tenantId);
  const a = await mustArticle(tenantId, articleId);
  accepted(a);
  const note = String(r.note ?? "").slice(0, 300) || undefined;
  if (a.tracking === "bulk") {
    const q = qty(r.qty);
    await transact([
      addCounts(tenantId, articleId, { onHand: q, free: q, reserved: 0 }),
      movement({ tenantId, kind: "receive", articleId, qty: q, by: actor.by, note }),
    ]);
    return { received: q, units: [] };
  }
  const list: Array<{ serial?: string; location?: string }> = r.units?.length ? r.units : Array.from({ length: qty(r.qty ?? 1) }, () => ({}));
  if (list.length > 40) throw new Refused("At most 40 units at a time.");
  const made: Unit[] = list.map((x) => ({
    tenantId, id: mintId("u"), articleId, state: "in-stock",
    serial: String(x.serial ?? "").trim().slice(0, 80) || undefined,
    location: String(x.location ?? a.location ?? "").trim().slice(0, 80) || undefined,
  }));
  await transact([
    addCounts(tenantId, articleId, { onHand: made.length, free: made.length, reserved: 0 }),
    ...made.flatMap((u) => [
      { Put: { TableName: T.units(), Item: { ...u, createdAt: now() }, ConditionExpression: "attribute_not_exists(id)" } },
      movement({ tenantId, kind: "receive", articleId, unitId: u.id, qty: 1, by: actor.by, note }),
    ]),
  ]);
  return { received: made.length, units: made };
}

/** A stock count: set what is on hand of a bulk article. */
export async function adjust(actor: Actor, tenantId: string, articleId: string, onHand: number, note?: string) {
  administers(actor, tenantId);
  const a = await mustArticle(tenantId, articleId);
  if (a.tracking !== "bulk") throw new Refused("A serialised article's count follows its units: receive or retire units instead.");
  const n = Number(onHand);
  if (!Number.isInteger(n) || n < 0) throw new Refused("On hand is a whole number, 0 or more.");
  if (n < a.reserved) throw new Refused(`${a.reserved} are reserved by workspaces: release them first, or count at least that many.`);
  if (n < (a.boxed ?? 0)) throw new Refused(`${a.boxed} are in boxes: take them out first, or count at least that many.`);
  await transact([
    { Update: {
      TableName: T.articles(), Key: { tenantId, id: articleId },
      UpdateExpression: "SET #o = :n, #f = :n - #r, updatedAt = :at",
      ConditionExpression: "#o = :was AND #r <= :n AND (attribute_not_exists(boxed) OR boxed <= :n)",
      ExpressionAttributeNames: { "#o": "onHand", "#f": "free", "#r": "reserved" },
      ExpressionAttributeValues: { ":n": n, ":was": a.onHand, ":at": now() },
    } },
    movement({ tenantId, kind: "adjust", articleId, qty: n - a.onHand, by: actor.by, note: String(note ?? "").slice(0, 300) || undefined }),
  ]);
  return { onHand: n };
}

/* ------------------------------------------- a product takes from stock ---- */

export async function step(actor: Actor, s: Step, spaceId: string, articleId: string,
  r: { qty?: number; unitId?: string; note?: string }) {
  const space = await usable(actor, spaceId);
  const tenantId = space.tenantId;
  const a = await mustArticle(tenantId, articleId);
  accepted(a);
  const note = String(r.note ?? "").slice(0, 300) || undefined;
  let q = 1;
  const items: unknown[] = [];
  if (a.tracking === "serial") {
    if (!r.unitId) throw new Refused("Name the unit: this article is tracked unit by unit.");
    const u = await mustUnit(tenantId, r.unitId);
    if (u.articleId !== articleId) throw new Refused("That unit is not of this article.");
    const { from, to } = UNIT_STEP[s];
    if (u.state !== from) throw new Refused(`That unit is ${u.state}, not ${from}.`);
    if (s !== "reserve" && u.spaceId !== spaceId) throw new Refused("That unit is not with this workspace.");
    const keep = to === "reserved" || to === "in-use";
    items.push({ Update: {
      TableName: T.units(), Key: { tenantId, id: u.id },
      UpdateExpression: keep ? "SET #s = :to, spaceId = :sp, updatedAt = :at" : "SET #s = :to, updatedAt = :at REMOVE spaceId",
      ConditionExpression: "#s = :from",
      ExpressionAttributeNames: { "#s": "state" },
      ExpressionAttributeValues: { ":to": to, ":from": from, ":at": now(), ...(keep ? { ":sp": spaceId } : {}) },
    } });
  } else {
    if (r.unitId) throw new Refused("This article is counted in bulk: give a quantity, not a unit.");
    q = qty(r.qty);
    if (s === "consume" && !boxable({ onHand: a.onHand - q, boxed: a.boxed }, 0)) {
      throw new Refused(`${a.boxed} of ${a.name} are in boxes: take what you used out of its box first.`);
    }
  }
  const c = counts(s, q);
  items.push(addCounts(tenantId, articleId, c.article, c.need.free ? { free: q } : c.need.reserved && s !== "return" ? { reserved: q } : undefined));
  if (s === "consume" && a.tracking !== "serial") {
    // what boxes hold stays on hand: used parts come from outside the boxes
    const u = (items[items.length - 1] as { Update: { ConditionExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).Update;
    u.ConditionExpression = `(${u.ConditionExpression}) AND (attribute_not_exists(boxed) OR boxed <= :room) AND #o = :seen`;
    Object.assign(u.ExpressionAttributeValues, { ":room": a.onHand - q, ":seen": a.onHand });
  }
  items.push({ Update: {
    TableName: T.allocations(), Key: { spaceId, articleId },
    UpdateExpression: "SET tenantId = :t, updatedAt = :at ADD #r :dr, #c :dc",
    ...(c.need.reserved ? { ConditionExpression: "#r >= :q" } : c.need.consumed ? { ConditionExpression: "#c >= :q" } : {}),
    ExpressionAttributeNames: { "#r": "reserved", "#c": "consumed" },
    ExpressionAttributeValues: {
      ":t": tenantId, ":at": now(), ":dr": c.allocation.reserved, ":dc": c.allocation.consumed,
      ...(c.need.reserved || c.need.consumed ? { ":q": q } : {}),
    },
  } });
  items.push(movement({ tenantId, kind: s, articleId, unitId: r.unitId, spaceId, qty: q, by: actor.by, note }));
  await transact(items, {
    reserve: a.tracking === "bulk" ? `Only ${a.free} ${a.unit} of ${a.name} are free.` : "That unit was taken meanwhile.",
    release: "The workspace has not reserved that many.",
    consume: "The workspace has not reserved that many.",
    return: "The workspace has not used that many.",
  }[s]);
  return { done: s, qty: q };
}

/* -------------------------------------------------------------- units ---- */

export async function changeUnit(actor: Actor, tenantId: string, unitId: string,
  ch: { location?: string; parentId?: string | null; firmware?: { name: string; version: string }; retire?: boolean; note?: string }) {
  reads(actor, tenantId);
  const u = await mustUnit(tenantId, unitId);
  const note = String(ch.note ?? "").slice(0, 300) || undefined;
  if (u.state === "retired") throw new Refused("That unit is retired.");
  if (ch.retire) {
    administers(actor, tenantId);
    if (u.state !== "in-stock") throw new Refused("Only a unit in the store is retired: release or return it first.");
    await transact([
      { Update: { TableName: T.units(), Key: { tenantId, id: unitId }, UpdateExpression: "SET #s = :r, updatedAt = :at REMOVE boxId, holder",
        ConditionExpression: "#s = :in", ExpressionAttributeNames: { "#s": "state" },
        ExpressionAttributeValues: { ":r": "retired", ":in": "in-stock", ":at": now() } } },
      addCounts(tenantId, u.articleId, { onHand: -1, free: -1, reserved: 0 }, { free: 1 }),
      movement({ tenantId, kind: "retire", articleId: u.articleId, unitId, qty: 1, by: actor.by, note }),
    ]);
    return { retired: unitId };
  }
  if (u.spaceId) {
    const space = await getSpace(u.spaceId);
    if (space && !actor.usesSpace(space) && !actor.admin(tenantId)) throw new Refused("That unit is with a workspace you do not work in.");
  }
  const sets: string[] = ["updatedAt = :at"];
  const removes: string[] = [];
  const values: Record<string, unknown> = { ":at": now() };
  const log: Array<Record<string, unknown>> = [];
  if (ch.location !== undefined) {
    const loc = String(ch.location).trim().slice(0, 80);
    if (loc) { sets.push("#l = :l"); values[":l"] = loc; } else removes.push("#l");
    log.push({ kind: "move", note: loc || note });
  }
  if (ch.parentId !== undefined) {
    if (ch.parentId) {
      const parent = await mustUnit(tenantId, ch.parentId);
      const cache = new Map<string, string | undefined>([[parent.id, parent.parentId]]);
      const parentOf = (id: string) => cache.get(id);
      // walk up from the parent; fetch each step's own parent
      for (let at = parent.parentId, i = 0; at && i < 32; i++) {
        const p = await getUnitRow(tenantId, at);
        cache.set(at, p?.parentId);
        at = p?.parentId;
      }
      if (wouldLoop(unitId, parent.id, parentOf)) throw new Refused("A unit cannot go inside itself.");
      sets.push("parentId = :p"); values[":p"] = parent.id;
      log.push({ kind: "install", note: `in ${parent.id}${note ? `: ${note}` : ""}` });
    } else {
      removes.push("parentId");
      log.push({ kind: "remove", note: u.parentId ? `from ${u.parentId}` : note });
    }
  }
  if (ch.firmware) {
    const name = String(ch.firmware.name ?? "").trim().slice(0, 120);
    const version = String(ch.firmware.version ?? "").trim().slice(0, 60);
    if (!name || !version) throw new Refused("Firmware needs a name and a version.");
    sets.push("firmware = :fw"); values[":fw"] = { name, version, at: now(), by: actor.by };
    log.push({ kind: "flash", note: `${name} ${version}${note ? `: ${note}` : ""}` });
  }
  if (!log.length) throw new Refused("Nothing to change.");
  await transact([
    { Update: {
      TableName: T.units(), Key: { tenantId, id: unitId },
      UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
      ConditionExpression: "attribute_exists(id)",
      ...(sets.some((x) => x.startsWith("#l")) || removes.includes("#l") ? { ExpressionAttributeNames: { "#l": "location" } } : {}),
      ExpressionAttributeValues: values,
    } },
    ...log.map((m) => movement({ tenantId, articleId: u.articleId, unitId, qty: 0, by: actor.by, spaceId: u.spaceId, ...m })),
  ]);
  return { changed: unitId };
}

/* -------------------------------------------------------------- codes ---- */

/** A batch of blank codes of ours, to print; each is bound later, on the bench. */
export async function mintCodes(actor: Actor, tenantId: string, n: number) {
  administers(actor, tenantId);
  const want = Math.min(Math.max(Math.floor(Number(n)) || 0, 1), 240);
  const out: string[] = [];
  for (let tries = 0; out.length < want && tries < want * 3; tries++) {
    const value = mintOwn();
    try {
      await doc.send(new PutCommand({
        TableName: T.codes(), ConditionExpression: "attribute_not_exists(pk)",
        Item: { pk: `m5:${value}`, kind: "m5", value, tenantId, mintedAt: now(), mintedBy: actor.by },
      }));
      out.push(value);
    } catch (e) {
      if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
    }
  }
  return out.map((code) => ({ code, url: labelUrl(code) }));
}

async function target(tenantId: string, kind: string, id: string) {
  if (kind === "article") accepted(await mustArticle(tenantId, id));
  else if (kind === "unit") await mustUnit(tenantId, id);
  else if (kind === "box") await mustBox(tenantId, id);
  else throw new Refused("A code points at an article, a unit or a box.");
}

/**
 * Bind a code to an article or a unit: one of our blank codes, or an existing
 * one (EAN, a manufacturer's QR, an NFC UID) as an alias.
 */
export async function bindCode(actor: Actor, tenantId: string, raw: string, kind: string, id: string) {
  reads(actor, tenantId);
  const code: Code = normalise(raw);
  if (code.kind === "ean" && kind !== "article") {
    // A GTIN names the product: it goes on the article. A GS1 code's serial
    // goes on the unit, so the same code finds that unit next time.
    if (kind !== "unit") throw new Refused("A product's barcode (EAN/GTIN) goes on an article, not a box.");
    const u = await mustUnit(tenantId, id);
    if (code.serial && !u.serial) {
      await doc.send(new UpdateCommand({
        TableName: T.units(), Key: { tenantId, id: u.id }, UpdateExpression: "SET serial = :s, updatedAt = :at",
        ConditionExpression: "attribute_not_exists(serial)", ExpressionAttributeValues: { ":s": code.serial.slice(0, 60), ":at": now() },
      }));
    }
    kind = "article"; id = u.articleId;
  }
  await target(tenantId, kind, id);
  const pk = codeKey(code, tenantId);
  try {
    if (code.kind === "m5") {
      await doc.send(new UpdateCommand({
        TableName: T.codes(), Key: { pk },
        UpdateExpression: "SET #tg = :id, targetKind = :k, boundBy = :by, boundAt = :at",
        ConditionExpression: "attribute_exists(pk) AND tenantId = :t AND attribute_not_exists(#tg)",
        ExpressionAttributeNames: { "#tg": "target" },
        ExpressionAttributeValues: { ":id": id, ":k": kind, ":by": actor.by, ":at": now(), ":t": tenantId },
      }));
    } else {
      await doc.send(new PutCommand({
        TableName: T.codes(), ConditionExpression: "attribute_not_exists(pk)",
        Item: { pk, kind: code.kind, value: code.value, tenantId, target: id, targetKind: kind, boundBy: actor.by, boundAt: now() },
      }));
    }
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
      if (code.kind !== "m5") {
        // bound to this very thing already (the next box of the same board): fine
        const had = (await doc.send(new GetCommand({ TableName: T.codes(), Key: { pk } }))).Item as { target?: string } | undefined;
        if (had?.target === id) return { code, bound: { kind, id } };
      }
      throw new Refused(code.kind === "m5" ? "That code is not a blank code of this organisation, or it is bound already." : "That code already points at something in this organisation.");
    }
    throw e;
  }
  return { code, bound: { kind, id } };
}

export async function unbindCode(actor: Actor, tenantId: string, raw: string) {
  administers(actor, tenantId);
  const code = normalise(raw);
  const pk = codeKey(code, tenantId);
  await doc.send(new UpdateCommand({
    TableName: T.codes(), Key: { pk },
    UpdateExpression: code.kind === "m5" ? "REMOVE #tg, targetKind, boundBy, boundAt" : "SET retiredAt = :at REMOVE #tg, targetKind",
    ConditionExpression: "tenantId = :t", ExpressionAttributeNames: { "#tg": "target" }, ExpressionAttributeValues: { ":t": tenantId, ...(code.kind === "m5" ? {} : { ":at": now() }) },
  }));
  return { code };
}

/* -------------------------------------------------------------- boxes ---- *
 * ADR-0011 in maker-5-shared. A box belongs to the organisation and may be
 * marked as a workspace's. It holds units (boxId on the unit), counted parts
 * (MkBoxStock lines, with the article's `boxed` counter keeping boxes from
 * holding more than is on hand) and other boxes (parentId). Its links and
 * files are kept on the row; files themselves in S3 under boxes/<tenant>/<box>/.
 * Anyone in the organisation works with boxes; deleting one is an admin's.
 */

const s3 = new S3Client({});
const BUCKET = () => process.env.OBJECT_BUCKET_NAME!;
const fileKey = (tenantId: string, boxId: string, fileId: string) => `boxes/${tenantId}/${boxId}/${fileId}`;

export async function getBoxRow(tenantId: string, id: string): Promise<Box | null> {
  if (!BOX.test(id)) return null;
  const r = await doc.send(new GetCommand({ TableName: T.boxes(), Key: { tenantId, id } }));
  return (r.Item as Box) ?? null;
}
async function mustBox(tenantId: string, id: string) {
  const b = await getBoxRow(tenantId, id);
  if (!b) throw new Refused("No such box in this organisation.");
  return b;
}

/** The boxes a box sits in, outermost first. */
async function boxPath(tenantId: string, b: Box): Promise<Array<{ id: string; name: string }>> {
  const path: Array<{ id: string; name: string }> = [];
  for (let at = b.parentId, i = 0; at && i < 12; i++) {
    const p = await getBoxRow(tenantId, at);
    if (!p) break;
    path.unshift({ id: p.id, name: p.name });
    at = p.parentId;
  }
  return path;
}

async function workspaceOf(tenantId: string, spaceId?: string) {
  if (!spaceId) return null;
  const v = await getSpace(spaceId);
  if (!v || v.tenantId !== tenantId) throw new Refused("That workspace is not in this organisation.");
  return v;
}

export async function listBoxes(actor: Actor, tenantId: string, q = "", spaceId = "") {
  reads(actor, tenantId);
  const all = spaceId
    ? await query<Box>({ TableName: T.boxes(), IndexName: "bySpace", KeyConditionExpression: "spaceId = :s", ExpressionAttributeValues: { ":s": spaceId } })
    : await query<Box>({ TableName: T.boxes(), KeyConditionExpression: "tenantId = :t", ExpressionAttributeValues: { ":t": tenantId } }, 5000);
  const names = Object.fromEntries(all.map((b) => [b.id, b.name]));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter((b) => b.tenantId === tenantId)
    .filter((b) => words.every((w) => `${b.name} ${b.location ?? ""} ${b.note ?? ""}`.toLowerCase().includes(w)))
    .map(({ links, files, ...b }) => ({ ...b, parentName: b.parentId ? names[b.parentId] : undefined, links: links?.length ?? 0, files: files?.length ?? 0 }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** Everything a box's card shows. */
export async function box(actor: Actor, tenantId: string, id: string) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, id);
  const [path, boxes, units, lines, codes, movements, space] = await Promise.all([
    boxPath(tenantId, b),
    query<Box>({ TableName: T.boxes(), IndexName: "byParent", KeyConditionExpression: "parentId = :p", ExpressionAttributeValues: { ":p": id } }),
    query<Unit>({ TableName: T.units(), IndexName: "byBox", KeyConditionExpression: "boxId = :b", ExpressionAttributeValues: { ":b": id } }),
    query<{ articleId: string; qty: number }>({ TableName: T.boxStock(), KeyConditionExpression: "boxId = :b", ExpressionAttributeValues: { ":b": id } }),
    codesOf(id),
    movementsBy("byBox", "boxId", id, 40),
    b.spaceId ? getSpace(b.spaceId) : Promise.resolve(null),
  ]);
  // what is installed in each unit travels with it (the SD card in the Pi)
  const inside = await Promise.all(units.map((u) => query<Unit>({
    TableName: T.units(), IndexName: "byParent", KeyConditionExpression: "parentId = :p", ExpressionAttributeValues: { ":p": u.id },
  })));
  const unitCodes = await Promise.all(units.map((u) => codesOf(u.id)));
  const names = await articleNames(tenantId, [...units, ...inside.flat()].map((u) => u.articleId).concat(lines.map((l) => l.articleId)));
  const arts = await Promise.all([...new Set(lines.map((l) => l.articleId))].map((a) => getArticleRow(tenantId, a)));
  const unitOf = Object.fromEntries(arts.filter(Boolean).map((a) => [a!.id, a!.unit]));
  return {
    box: b, path, codes, movements,
    space: space ? { id: space.id, name: space.name } : null,
    boxes: boxes.map(({ links, files, ...x }) => x).sort((x, y) => x.name.localeCompare(y.name)),
    units: units.map((u, i) => ({
      ...u, articleName: names[u.articleId], codes: unitCodes[i].map((c) => c.value),
      inside: inside[i].map((c) => ({ ...c, articleName: names[c.articleId] })),
    })),
    lines: lines.filter((l) => l.qty > 0).map((l) => ({ ...l, name: names[l.articleId], unit: unitOf[l.articleId] ?? "pcs" })),
  };
}

export async function saveBox(actor: Actor, tenantId: string, b: Record<string, unknown>) {
  reads(actor, tenantId);
  const id = b.id ? String(b.id) : "";
  const existing = id ? await mustBox(tenantId, id) : undefined;
  const f = boxFields(b, existing);
  await workspaceOf(tenantId, f.spaceId);
  const at = now();
  if (existing) {
    const item = { ...existing, ...f, updatedAt: at };
    await transact([
      { Put: { TableName: T.boxes(), Item: item, ConditionExpression: "attribute_exists(id)" } },
      movement({ tenantId, kind: "box", boxId: existing.id, qty: 0, by: actor.by, spaceId: f.spaceId, note: "changed" }),
    ]);
    return item;
  }
  let parentId: string | undefined;
  if (b.parentId) parentId = (await mustBox(tenantId, String(b.parentId))).id;
  const item = { ...f, tenantId, id: mintId("x"), parentId, links: [], files: [], createdAt: at, updatedAt: at, createdBy: actor.by };
  await transact([
    { Put: { TableName: T.boxes(), Item: item, ConditionExpression: "attribute_not_exists(id)" } },
    movement({ tenantId, kind: "box", boxId: item.id, qty: 0, by: actor.by, spaceId: f.spaceId, note: "new" }),
  ]);
  return item;
}

/** Put a box into another box, or set it down at a place. */
export async function moveBox(actor: Actor, tenantId: string, id: string, to: { parentId?: string | null; location?: string }) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, id);
  const sets = ["updatedAt = :at"];
  const removes: string[] = [];
  const values: Record<string, unknown> = { ":at": now() };
  let note: string;
  if (to.parentId) {
    const parent = await mustBox(tenantId, String(to.parentId));
    const chain = new Map<string, string | undefined>([[parent.id, parent.parentId]]);
    for (let at = parent.parentId, i = 0; at && i < 12; i++) {
      const p = await getBoxRow(tenantId, at);
      chain.set(at, p?.parentId);
      at = p?.parentId;
    }
    const why = boxFits(id, parent.id, (x) => chain.get(x));
    if (why) throw new Refused(why);
    sets.push("parentId = :p"); values[":p"] = parent.id;
    removes.push("#l");
    note = `into ${parent.name}`;
  } else {
    const loc = String(to.location ?? "").trim().slice(0, 80);
    removes.push("parentId");
    if (loc) { sets.push("#l = :l"); values[":l"] = loc; } else removes.push("#l");
    note = loc || "out of its box";
  }
  await transact([
    { Update: {
      TableName: T.boxes(), Key: { tenantId, id },
      UpdateExpression: `SET ${sets.join(", ")} REMOVE ${removes.join(", ")}`,
      ConditionExpression: "attribute_exists(id)", ExpressionAttributeNames: { "#l": "location" }, ExpressionAttributeValues: values,
    } },
    movement({ tenantId, kind: "boxmove", boxId: id, qty: 0, by: actor.by, spaceId: b.spaceId, note }),
  ]);
  return { moved: id };
}

/** An empty box can go; one that still holds something cannot. */
export async function deleteBox(actor: Actor, tenantId: string, id: string) {
  administers(actor, tenantId);
  const got = await box(actor, tenantId, id);
  if (got.boxes.length || got.units.length || got.lines.length) throw new Refused("The box is not empty: take everything out first.");
  for (const f of got.box.files ?? []) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: fileKey(tenantId, id, f.id) }));
  await doc.send(new DeleteCommand({ TableName: T.boxes(), Key: { tenantId, id } }));
  // its codes become blank again (ours) or retired (aliases), as unbindCode does
  for (const c of got.codes) {
    await doc.send(new UpdateCommand({
      TableName: T.codes(), Key: { pk: c.pk },
      UpdateExpression: c.kind === "m5" ? "REMOVE #tg, targetKind, boundBy, boundAt" : "SET retiredAt = :at REMOVE #tg, targetKind",
      ExpressionAttributeNames: { "#tg": "target" }, ...(c.kind === "m5" ? {} : { ExpressionAttributeValues: { ":at": now() } }),
    }));
  }
  await doc.send(new PutCommand({ TableName: T.movements(), Item: { sk: sk(), at: now(), tenantId, kind: "box", boxId: id, qty: 0, by: actor.by, note: "deleted" } }));
  return { deleted: id };
}

/** One step of an article's counts and a workspace's allocation, for a reservation made with a check-out. */
function allocate(tenantId: string, spaceId: string, articleId: string, q: number) {
  return { Update: {
    TableName: T.allocations(), Key: { spaceId, articleId },
    UpdateExpression: "SET tenantId = :t, updatedAt = :at ADD #r :q",
    ExpressionAttributeNames: { "#r": "reserved" },
    ExpressionAttributeValues: { ":t": tenantId, ":at": now(), ":q": q },
  } };
}

/** Put a part into a box: a unit (from wherever it was) or a quantity of a counted article. */
export async function checkIn(actor: Actor, tenantId: string, boxId: string, r: { unitId?: string; articleId?: string; qty?: number; note?: string }) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, boxId);
  const note = String(r.note ?? "").slice(0, 300) || undefined;
  if (r.unitId) {
    const u = await mustUnit(tenantId, String(r.unitId));
    if (u.state === "retired") throw new Refused("That unit is retired.");
    if (u.boxId === boxId) throw new Refused("It is in this box already.");
    await transact([
      { Update: {
        TableName: T.units(), Key: { tenantId, id: u.id },
        UpdateExpression: "SET boxId = :b, updatedAt = :at REMOVE holder, parentId, #l",
        ConditionExpression: "attribute_exists(id)", ExpressionAttributeNames: { "#l": "location" },
        ExpressionAttributeValues: { ":b": boxId, ":at": now() },
      } },
      movement({ tenantId, kind: "boxin", boxId, articleId: u.articleId, unitId: u.id, spaceId: u.spaceId ?? b.spaceId, qty: 1, by: actor.by,
        note: [u.boxId ? `from box ${u.boxId}` : u.holder ? `from ${u.holder.by}` : u.parentId ? `out of ${u.parentId}` : "", note].filter(Boolean).join(": ") || undefined }),
    ]);
    return { in: u.id };
  }
  const a = await mustArticle(tenantId, String(r.articleId ?? ""));
  if (a.tracking !== "bulk") throw new Refused("This article is tracked unit by unit: check in the unit itself.");
  const q = qty(r.qty);
  if (!boxable(a, q)) throw new Refused(`Only ${a.onHand - (a.boxed ?? 0)} ${a.unit} of ${a.name} are not in a box yet.`);
  await transact([
    { Update: {
      TableName: T.articles(), Key: { tenantId, id: a.id },
      UpdateExpression: "SET updatedAt = :at ADD boxed :q",
      ConditionExpression: "(attribute_not_exists(boxed) OR boxed <= :max) AND onHand >= :seen",
      ExpressionAttributeValues: { ":at": now(), ":q": q, ":max": a.onHand - q, ":seen": a.onHand },
    } },
    { Update: {
      TableName: T.boxStock(), Key: { boxId, articleId: a.id },
      UpdateExpression: "SET tenantId = :t, updatedAt = :at ADD qty :q",
      ExpressionAttributeValues: { ":t": tenantId, ":at": now(), ":q": q },
    } },
    movement({ tenantId, kind: "boxin", boxId, articleId: a.id, spaceId: b.spaceId, qty: q, by: actor.by, note }),
  ], `Only ${a.onHand - (a.boxed ?? 0)} ${a.unit} of ${a.name} are not in a box yet.`);
  return { in: a.id, qty: q };
}

/**
 * Take a part out of a box: it is then with the person who took it. Named
 * with a workspace, it is also reserved for that workspace, in the same step.
 */
export async function checkOut(actor: Actor, tenantId: string, boxId: string,
  r: { unitId?: string; articleId?: string; qty?: number; spaceId?: string; note?: string }) {
  reads(actor, tenantId);
  await mustBox(tenantId, boxId);
  const note = String(r.note ?? "").slice(0, 300) || undefined;
  const spaceId = r.spaceId ? (await usable(actor, String(r.spaceId))).id : undefined;
  const at = now();
  if (r.unitId) {
    const u = await mustUnit(tenantId, String(r.unitId));
    if (u.boxId !== boxId) throw new Refused("That unit is not in this box.");
    const reserve = Boolean(spaceId) && u.state === "in-stock";
    if (spaceId && !reserve && u.spaceId !== spaceId) throw new Refused(`That unit is ${u.state} for another workspace.`);
    await transact([
      { Update: {
        TableName: T.units(), Key: { tenantId, id: u.id },
        UpdateExpression: `SET holder = :h, updatedAt = :at${reserve ? ", #s = :rs, spaceId = :sp" : ""} REMOVE boxId`,
        ConditionExpression: reserve ? "boxId = :b AND #s = :in" : "boxId = :b",
        ...(reserve ? { ExpressionAttributeNames: { "#s": "state" } } : {}),
        ExpressionAttributeValues: { ":h": { by: actor.by, at }, ":at": at, ":b": boxId,
          ...(reserve ? { ":rs": "reserved", ":in": "in-stock", ":sp": spaceId } : {}) },
      } },
      ...(reserve ? [
        addCounts(tenantId, u.articleId, { onHand: 0, free: -1, reserved: 1 }, { free: 1 }),
        allocate(tenantId, spaceId!, u.articleId, 1),
        movement({ tenantId, kind: "reserve", articleId: u.articleId, unitId: u.id, spaceId, qty: 1, by: actor.by, note }),
      ] : []),
      movement({ tenantId, kind: "boxout", boxId, articleId: u.articleId, unitId: u.id, spaceId: spaceId ?? u.spaceId, qty: 1, by: actor.by, note }),
    ], "That unit was taken meanwhile; look again.");
    return { out: u.id, reserved: reserve };
  }
  const a = await mustArticle(tenantId, String(r.articleId ?? ""));
  if (a.tracking !== "bulk") throw new Refused("This article is tracked unit by unit: take out the unit itself.");
  const q = qty(r.qty);
  await transact([
    { Update: {
      TableName: T.boxStock(), Key: { boxId, articleId: a.id },
      UpdateExpression: "SET updatedAt = :at ADD qty :minus", ConditionExpression: "qty >= :q",
      ExpressionAttributeValues: { ":at": at, ":minus": -q, ":q": q },
    } },
    // one write to the article: out of the box, and (for a workspace) reserved
    { Update: {
      TableName: T.articles(), Key: { tenantId, id: a.id },
      UpdateExpression: spaceId ? "SET updatedAt = :at ADD boxed :minus, #r :q, #f :minus" : "SET updatedAt = :at ADD boxed :minus",
      ConditionExpression: spaceId ? "boxed >= :q AND #f >= :q" : "boxed >= :q",
      ...(spaceId ? { ExpressionAttributeNames: { "#r": "reserved", "#f": "free" } } : {}),
      ExpressionAttributeValues: { ":at": at, ":minus": -q, ":q": q },
    } },
    ...(spaceId ? [
      allocate(tenantId, spaceId, a.id, q),
      movement({ tenantId, kind: "reserve", articleId: a.id, spaceId, qty: q, by: actor.by, note }),
    ] : []),
    movement({ tenantId, kind: "boxout", boxId, articleId: a.id, spaceId, qty: q, by: actor.by, note }),
  ], spaceId ? `There are not ${q} ${a.unit} of ${a.name} in this box, or not that many free.` : `There are not ${q} ${a.unit} of ${a.name} in this box.`);
  return { out: a.id, qty: q, reserved: Boolean(spaceId) };
}

/* box links and files */

export async function addLink(actor: Actor, tenantId: string, boxId: string, l: Record<string, unknown>) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, boxId);
  const link: BoxLink = { id: randomBytes(4).toString("hex"), ...linkFields(l), at: now(), by: actor.by };
  await transact([
    { Update: {
      TableName: T.boxes(), Key: { tenantId, id: boxId },
      UpdateExpression: "SET links = list_append(if_not_exists(links, :none), :one), updatedAt = :at",
      ConditionExpression: "attribute_not_exists(links) OR size(links) < :max",
      ExpressionAttributeValues: { ":none": [], ":one": [link], ":at": now(), ":max": MAX_LINKS },
    } },
    movement({ tenantId, kind: "link", boxId, spaceId: b.spaceId, qty: 0, by: actor.by, note: `${link.kind}: ${link.title}` }),
  ], `A box keeps at most ${MAX_LINKS} links.`);
  return link;
}

/** Replace a list on the box, if nobody changed the box since it was read. */
async function rewrite(tenantId: string, b: Box & { updatedAt?: string }, field: "links" | "files", list: unknown[], log: Record<string, unknown>) {
  await transact([
    { Update: {
      TableName: T.boxes(), Key: { tenantId, id: b.id },
      UpdateExpression: `SET ${field} = :l, updatedAt = :at`, ConditionExpression: "updatedAt = :seen",
      ExpressionAttributeValues: { ":l": list, ":at": now(), ":seen": b.updatedAt },
    } },
    movement({ tenantId, boxId: b.id, spaceId: b.spaceId, qty: 0, ...log }),
  ]);
}

export async function removeLink(actor: Actor, tenantId: string, boxId: string, linkId: string) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, boxId);
  const gone = (b.links ?? []).find((l) => l.id === linkId);
  if (!gone) throw new Refused("No such link on this box.");
  await rewrite(tenantId, b, "links", (b.links ?? []).filter((l) => l.id !== linkId), { kind: "link", by: actor.by, note: `removed ${gone.title}` });
  return { removed: linkId };
}

/** A short-lived upload URL for one file; fileUploaded() records it once it is there. */
export async function uploadFile(actor: Actor, tenantId: string, boxId: string, f: { name?: string; size?: number; type?: string }) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, boxId);
  if ((b.files ?? []).length >= MAX_FILES) throw new Refused(`A box keeps at most ${MAX_FILES} files.`);
  const size = Number(f.size);
  if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new Refused("A file is up to 50 MB.");
  const name = fileName(f.name);
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(f.type ?? "")) ? String(f.type) : "application/octet-stream";
  const fileId = randomBytes(6).toString("hex");
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: BUCKET(), Key: fileKey(tenantId, boxId, fileId), ContentLength: size, ContentType: type,
  }), { expiresIn: 900, signableHeaders: new Set(["content-length", "content-type"]) });
  return { fileId, url, name, size, type };
}

export async function fileUploaded(actor: Actor, tenantId: string, boxId: string,
  f: { fileId?: string; name?: string; type?: string; kind?: string }) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, boxId);
  const fileId = String(f.fileId ?? "");
  if (!/^[0-9a-f]{12}$/.test(fileId)) throw new Refused("No such upload.");
  let size = 0;
  try {
    size = Number((await s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: fileKey(tenantId, boxId, fileId) }))).ContentLength ?? 0);
  } catch { throw new Refused("The file has not arrived; upload it again."); }
  const kind = (LINK_KINDS as readonly string[]).includes(String(f.kind)) ? String(f.kind) as BoxFile["kind"] : "other";
  const file: BoxFile = { id: fileId, kind, name: fileName(f.name), size, type: String(f.type ?? "application/octet-stream").slice(0, 100), at: now(), by: actor.by };
  await transact([
    { Update: {
      TableName: T.boxes(), Key: { tenantId, id: boxId },
      UpdateExpression: "SET files = list_append(if_not_exists(files, :none), :one), updatedAt = :at",
      ConditionExpression: "attribute_not_exists(files) OR size(files) < :max",
      ExpressionAttributeValues: { ":none": [], ":one": [file], ":at": now(), ":max": MAX_FILES },
    } },
    movement({ tenantId, kind: "file", boxId, spaceId: b.spaceId, qty: 0, by: actor.by, note: `${kind}: ${file.name}` }),
  ], `A box keeps at most ${MAX_FILES} files.`);
  return file;
}

export async function fileUrl(actor: Actor, tenantId: string, boxId: string, fileId: string) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, boxId);
  const f = (b.files ?? []).find((x) => x.id === fileId);
  if (!f) throw new Refused("No such file on this box.");
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET(), Key: fileKey(tenantId, boxId, f.id),
    ResponseContentDisposition: `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  }), { expiresIn: 300 });
  return { url, name: f.name };
}

export async function removeFile(actor: Actor, tenantId: string, boxId: string, fileId: string) {
  reads(actor, tenantId);
  const b = await mustBox(tenantId, boxId);
  const gone = (b.files ?? []).find((x) => x.id === fileId);
  if (!gone) throw new Refused("No such file on this box.");
  await rewrite(tenantId, b, "files", (b.files ?? []).filter((x) => x.id !== fileId), { kind: "file", by: actor.by, note: `removed ${gone.name}` });
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: fileKey(tenantId, boxId, fileId) }));
  return { removed: fileId };
}

/* ------------------------------------------------------------ helpers ---- */

function addCounts(tenantId: string, id: string, d: { onHand: number; free: number; reserved: number },
  need?: { free?: number; reserved?: number }) {
  return { Update: {
    TableName: T.articles(), Key: { tenantId, id },
    UpdateExpression: "SET updatedAt = :at ADD #o :o, #f :f, #r :r",
    ConditionExpression: need?.free ? "#f >= :need" : need?.reserved ? "#r >= :need" : "attribute_exists(id)",
    ExpressionAttributeNames: { "#o": "onHand", "#f": "free", "#r": "reserved" },
    ExpressionAttributeValues: {
      ":at": now(), ":o": d.onHand, ":f": d.free, ":r": d.reserved,
      ...(need?.free ? { ":need": need.free } : need?.reserved ? { ":need": need.reserved } : {}),
    },
  } };
}

async function transact(items: unknown[], refused = "Someone changed this meanwhile; look again.") {
  try {
    await doc.send(new TransactWriteCommand({ TransactItems: items as never }));
  } catch (e) {
    if ((e as { name?: string }).name === "TransactionCanceledException") throw new Refused(refused);
    throw e;
  }
}
