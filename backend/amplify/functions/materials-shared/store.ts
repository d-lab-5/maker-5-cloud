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

import { randomBytes } from "node:crypto";
import {
  BatchGetCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { doc, getSpace, type Space } from "../shared/spaces";
import { BadCode, codeKey, labelUrl, mintOwn, normalise, type Code } from "./codes";
import {
  ARTICLE, UNIT, Refused, UNIT_STEP, articleFields, counts, mintId, qty, wouldLoop,
  type Article, type Step, type Unit,
} from "./stock";

export { Refused, BadCode };

const T = {
  articles: () => process.env.ARTICLES_TABLE_NAME!,
  units: () => process.env.UNITS_TABLE_NAME!,
  allocations: () => process.env.ALLOCATIONS_TABLE_NAME!,
  movements: () => process.env.MOVEMENTS_TABLE_NAME!,
  codes: () => process.env.CODES_TABLE_NAME!,
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

const movementsBy = (index: "byArticle" | "byUnit" | "bySpace", key: string, value: string, limit = 50) =>
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
  return { article: a, units, allocations, movements, codes };
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
  return {
    unit: u, article: a, codes, movements,
    parent: parent ? { ...parent, articleName: names[parent.articleId] } : null,
    children: children.map((c) => ({ ...c, articleName: names[c.articleId] })),
    space: space ? { id: space.id, name: space.name } : null,
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

/** What a scanned or typed code points at, in the caller's workspaces. */
export async function resolve(actor: Actor, raw: string) {
  const code = normalise(raw);
  const tenants = code.kind === "m5" ? [""] : [...actor.tenants];
  for (const t of tenants) {
    const r = await doc.send(new GetCommand({ TableName: T.codes(), Key: { pk: codeKey(code, t) } }));
    const row = r.Item as { tenantId: string; target?: string; targetKind?: string } | undefined;
    if (!row) continue;
    if (!actor.tenants.has(row.tenantId)) break;   // somebody else's: as if unknown
    if (!row.target) return { status: "blank", code, tenantId: row.tenantId };
    return { status: row.targetKind, code, tenantId: row.tenantId, id: row.target };
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

/** Stock comes in: a quantity of a bulk article, or units of a serialised one. */
export async function receive(actor: Actor, tenantId: string, articleId: string,
  r: { qty?: number; units?: Array<{ serial?: string; location?: string }>; note?: string }) {
  administers(actor, tenantId);
  const a = await mustArticle(tenantId, articleId);
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
  await transact([
    { Update: {
      TableName: T.articles(), Key: { tenantId, id: articleId },
      UpdateExpression: "SET #o = :n, #f = :n - #r, updatedAt = :at",
      ConditionExpression: "#o = :was AND #r <= :n",
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
  }
  const c = counts(s, q);
  items.push(addCounts(tenantId, articleId, c.article, c.need.free ? { free: q } : c.need.reserved && s !== "return" ? { reserved: q } : undefined));
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
      { Update: { TableName: T.units(), Key: { tenantId, id: unitId }, UpdateExpression: "SET #s = :r, updatedAt = :at",
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
  if (kind === "article") await mustArticle(tenantId, id);
  else if (kind === "unit") await mustUnit(tenantId, id);
  else throw new Refused("A code points at an article or a unit.");
}

/**
 * Bind a code to an article or a unit: one of our blank codes, or an existing
 * one (EAN, a manufacturer's QR, an NFC UID) as an alias.
 */
export async function bindCode(actor: Actor, tenantId: string, raw: string, kind: string, id: string) {
  reads(actor, tenantId);
  const code: Code = normalise(raw);
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
