import { test } from "node:test";
import assert from "node:assert/strict";
import { ARTICLE, UNIT, Refused, UNIT_STEP, articleFields, counts, mintId, qty, wouldLoop, type Article } from "./stock";

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
  const f = articleFields({ name: "  Raspberry  Pi 1 B ", category: "compute", tracking: "serial", unit: "m" });
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
