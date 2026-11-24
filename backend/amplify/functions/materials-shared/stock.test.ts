import { test } from "node:test";
import assert from "node:assert/strict";
import { ARTICLE, BOX, MAX_BATCH, batchNames, MAX_BOX_DEPTH, MAX_PROPOSE, UNIT, Refused, accepted, proposalFields, boxFields, boxFits, boxable, fileName, linkFields, UNIT_STEP, articleFields, counts, mintId, qty, wouldLoop, type Article } from "./stock";

// Stock rules (ADR-0008, ADR-0010 in maker-5-shared).

test("ids are minted like the workspace's", () => {
  assert.match(mintId("a"), ARTICLE);
  assert.match(mintId("u"), UNIT);
});

test("every step keeps on hand = free + reserved, and asks for what it takes", () => {
  for (const s of ["reserve", "release", "consume", "return"] as const) {
    const c = counts(s, 3);
    assert.equal(c.article.onHand, c.article.free + c.article.reserved, s);
  }
  assert.deepEqual(counts("reserve", 2).need, { free: 2 });
  assert.deepEqual(counts("consume", 2).need, { reserved: 2 });
  assert.deepEqual(counts("return", 2).need, { consumed: 2 });
  assert.equal(UNIT_STEP.consume.to, "in-use");
  assert.equal(UNIT_STEP.return.to, "in-stock");
});

test("quantities are whole and positive", () => {
  assert.equal(qty("4"), 4);
  for (const bad of [0, -1, 1.5, "x", null]) assert.throws(() => qty(bad), Refused);
});

test("an article's fields: a name, a known category, and tracking fixed while in stock", () => {
  const f = articleFields({ name: "  Raspberry  Pi 1 B ", category: "controllers/sbc", tracking: "serial", unit: "m" });
  assert.equal(f.name, "Raspberry Pi 1 B");
  assert.equal(f.unit, "pcs", "a serialised article is counted in pieces");
  assert.throws(() => articleFields({ name: "" }), /needs a name/);
  assert.throws(() => articleFields({ name: "x", category: "food" }), /No category/);
  assert.throws(() => articleFields({ name: "x", datasheet: "http://example.org/a.pdf" }), /https/);
  const inStock = { name: "Card", category: "storage", tracking: "serial", onHand: 2 } as Article;
  assert.throws(() => articleFields({ tracking: "bulk" }, inStock), /cannot change/);
});

test("a unit cannot be installed in itself, however deep", () => {
  const parents: Record<string, string | undefined> = { pi: "case", case: undefined, card: "pi" };
  assert.equal(wouldLoop("card", "pi", (id) => parents[id]), false);
  assert.equal(wouldLoop("pi", "card", (id) => parents[id]), true, "the Pi into the card that sits in it");
  assert.equal(wouldLoop("case", "card", (id) => parents[id]), true);
  assert.equal(wouldLoop("x", "x", () => undefined), true);
});

// Boxes (ADR-0011 in maker-5-shared). Every name here is invented.

test("a box is minted, named and of a known kind", () => {
  assert.match(mintId("x"), BOX);
  assert.deepEqual(boxFields({ name: "  Doorbell   prototype ", kind: "box", location: "Shelf B" }),
    { name: "Doorbell prototype", kind: "box", spaceId: undefined, location: "Shelf B", note: undefined });
  assert.throws(() => boxFields({ name: "" }), Refused);
  assert.throws(() => boxFields({ name: "Crate", kind: "crate" }), Refused);
});

test("a batch of boxes: the names given, or numbered after the highest taken", () => {
  assert.deepEqual(batchNames({ names: "Wall cabinet\n  \nElectronics bench \r\nCabinet" }, []), ["Wall cabinet", "Electronics bench", "Cabinet"]);
  assert.deepEqual(batchNames({ n: 3 }, []), ["Box 01", "Box 02", "Box 03"]);
  assert.deepEqual(batchNames({ n: 2 }, ["Box 07", "box 21", "Box 3a", "Toolbox 40"]), ["Box 22", "Box 23"]);
  assert.deepEqual(batchNames({ n: 1, prefix: "Bin (A)" }, ["Bin (A) 04"]), ["Bin (A) 05"]);
  assert.throws(() => batchNames({ n: 0 }, []), Refused);
  assert.throws(() => batchNames({ n: MAX_BATCH + 1 }, []), Refused);
  assert.throws(() => batchNames({ names: Array.from({ length: MAX_BATCH + 1 }, (_, i) => `B${i}`) }, []), Refused);
  assert.equal(boxFields({ name: "Wall cabinet", kind: "cabinet" }).kind, "cabinet");
  assert.equal(boxFields({ name: "Electronics bench", kind: "bench" }).kind, "bench");
});

test("a box never goes inside itself, and nests at most eight deep", () => {
  const up: Record<string, string> = { "x-b": "x-a", "x-c": "x-b" };
  const parentOf = (id: string) => up[id];
  assert.equal(boxFits("x-d", "x-c", parentOf), null);
  assert.match(boxFits("x-a", "x-c", parentOf) ?? "", /inside itself/);
  const deep: Record<string, string> = {};
  for (let i = 1; i < MAX_BOX_DEPTH + 2; i++) deep[`x-${i}`] = `x-${i - 1}`;
  assert.match(boxFits("x-new", `x-${MAX_BOX_DEPTH + 1}`, (id) => deep[id]) ?? "", /at most/);
});

test("boxes never hold more of an article than is on hand", () => {
  assert.ok(boxable({ onHand: 10 }, 10));
  assert.ok(boxable({ onHand: 10, boxed: 4 }, 6));
  assert.ok(!boxable({ onHand: 10, boxed: 4 }, 7));
});

test("links are https, of a known kind; file names lose their path", () => {
  assert.deepEqual(linkFields({ url: "https://example.org/doorbell/firmware", kind: "firmware" }),
    { url: "https://example.org/doorbell/firmware", kind: "firmware", title: "example.org/doorbell/firmware" });
  assert.throws(() => linkFields({ url: "http://example.org/x" }), Refused);
  assert.throws(() => linkFields({ url: "https://example.org/x", kind: "music" }), Refused);
  assert.equal(fileName("C:\\work\\doorbell.step"), "doorbell.step");
  assert.equal(fileName("../../etc/passwd"), "passwd");
  assert.throws(() => fileName("   "), Refused);
});

test("an edge proposes articles: checked like an admin's, at most 50 at once, never with stock moved", () => {
  const got = proposalFields([{ name: "Optocoupler PC817", category: "electronic" }, { name: "Step-down 12 V to 5 V" }]);
  assert.deepEqual(got.map((a) => [a.name, a.category, a.tracking]), [["Optocoupler PC817", "components", "bulk"], ["Step-down 12 V to 5 V", "other", "bulk"]]);
  assert.throws(() => proposalFields([]), Refused);
  assert.throws(() => proposalFields([{ name: "" }]), Refused);
  assert.throws(() => proposalFields([{ name: "x", category: "food" }]), Refused);
  assert.throws(() => proposalFields(Array.from({ length: MAX_PROPOSE + 1 }, (_, i) => ({ name: `p${i}` }))), Refused);
  assert.throws(() => accepted({ name: "PC817", proposed: { by: "edge:e-1", at: "2026-01-01" } }), /proposed/);
  assert.doesNotThrow(() => accepted({ name: "PC817" }));
});

test("ADR-0019: two levels of category, the old values mapped", async () => {
  const { CATEGORIES, category, inCategory, catalogue } = await import("./stock");
  assert.ok(CATEGORIES.includes("controllers") && CATEGORIES.includes("controllers/sbc"));
  assert.equal(category("compute"), "controllers/sbc");
  assert.equal(category("storage"), "controllers/storage");
  assert.equal(category("media/audio"), "media/audio");
  assert.equal(category("constructor"), "other", "no prototype keys");
  assert.equal(articleFields({ name: "Card", category: "storage" }).category, "controllers/storage");
  assert.equal(inCategory("controllers/sbc", "controllers"), true);
  assert.equal(inCategory("compute", "controllers"), true, "an old value is found under its new top");
  assert.equal(inCategory("controllers/sbc", "controllers/mcu"), false);
  assert.equal(inCategory("controllersx", "controllers"), false);
  const tiles = catalogue([{ category: "controllers/sbc", free: 2 }, { category: "compute", free: 1 },
    { category: "media/audio", free: 0 }, { category: "components", free: 5, proposed: true }]);
  const of = (c: string) => tiles.find((x) => x.code === c)!;
  assert.deepEqual([of("controllers").articles, of("controllers").free, of("controllers/sbc").articles], [2, 3, 2]);
  assert.equal(of("media").articles, 1);
  assert.equal(of("components").articles, 0, "a proposed article is not counted");
  assert.equal(of("controllers").label.de, "Steuerungen & Rechner");
});
