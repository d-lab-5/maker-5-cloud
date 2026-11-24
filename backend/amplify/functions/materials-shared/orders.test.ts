import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused, articleFields, supplierRefs } from "./stock";
import { arrive, fromLine, lineFields, lineKey, orderFields, supplierRef } from "./orders";
import { suggestionFields } from "./intake";

// Orders (ADR-0023 in maker-5-shared). Every name and number here is invented.

test("an order names its shop by its domain and has its number", () => {
  assert.deepEqual(orderFields({ supplier: "Amazon.de", orderRef: "000-0000000-0000001", orderedAt: "2026-11-20T09:00:00Z" }),
    { supplier: "amazon.de", orderRef: "000-0000000-0000001", orderedAt: "2026-11-20" });
  assert.throws(() => orderFields({ supplier: "amazon", orderRef: "000-0000000-0000001" }), Refused);
  assert.throws(() => orderFields({ supplier: "amazon.de", orderRef: "" }), Refused);
  assert.throws(() => orderFields({ supplier: "amazon.de", orderRef: "x", orderedAt: "yesterday" }), Refused);
});

test("a line is its title, number, quantity and price, and an article to be", () => {
  const l = lineFields({ title: "  Example   tactile switch, 100 pcs ", sku: "b0example1", qty: 2, unitPrice: 6.499, currency: "eur",
    article: { category: "components" } });
  assert.equal(l.title, "Example tactile switch, 100 pcs");
  assert.equal(l.sku, "B0EXAMPLE1");
  assert.equal(l.unitPrice, 6.5);
  assert.equal(l.currency, "EUR");
  assert.equal(l.article?.name, "Example tactile switch, 100 pcs");
  assert.equal(l.article?.tracking, "bulk");
  assert.equal(lineFields({ title: "Example board", what: "device" }).article?.tracking, "serial");
  assert.equal(lineFields({ title: "Example", articleId: "a-2222222222" }).article, undefined);
  assert.throws(() => lineFields({ title: "" }), Refused);
  assert.throws(() => lineFields({ title: "x", qty: 0 }), Refused);
  assert.throws(() => lineFields({ title: "x", sku: "no spaces" }), Refused);
  assert.throws(() => lineFields({ title: "x", currency: "XYZ" }), Refused);
});

test("the same line twice is one line", () => {
  assert.equal(lineKey("amazon.de", "000-1", { sku: "B0EXAMPLE1", title: "A" }), lineKey("amazon.de", "000-1", { sku: "B0EXAMPLE1", title: "B" }));
  assert.notEqual(lineKey("amazon.de", "000-1", { title: "A" }), lineKey("amazon.de", "000-2", { title: "A" }));
  assert.equal(supplierRef({ supplier: "amazon.de", sku: "B0EXAMPLE1" }), "amazon.de:B0EXAMPLE1");
  assert.equal(supplierRef({ supplier: "amazon.de" }), undefined);
});

test("a line is open until all of it arrived", () => {
  assert.deepEqual(arrive({ status: "open", qty: 3, arrived: 0 }, 2), { arrived: 2, status: "open" });
  assert.deepEqual(arrive({ status: "open", qty: 3, arrived: 2 }, 1), { arrived: 3, status: "arrived" });
  assert.deepEqual(arrive({ status: "open", qty: 1, arrived: 0 }, 100), { arrived: 100, status: "arrived" }, "a box of 100 for one line");
  assert.throws(() => arrive({ status: "arrived", qty: 1, arrived: 1 }, 1), Refused);
  assert.throws(() => arrive({ status: "dropped", qty: 1, arrived: 0 }, 1), Refused);
});

test("an article remembers its shops, without doubles", () => {
  assert.deepEqual(supplierRefs(["amazon.de:B0EXAMPLE1"], "amazon.de:B0EXAMPLE1"), ["amazon.de:B0EXAMPLE1"]);
  assert.deepEqual(supplierRefs([], ["amazon.de:B0EXAMPLE1", "reichelt.de:EX-1234"]), ["amazon.de:B0EXAMPLE1", "reichelt.de:EX-1234"]);
  assert.equal(supplierRefs(undefined), undefined);
  assert.throws(() => supplierRefs(["000-0000000-0000001"]), Refused, "an order number is not where it was bought");
  assert.deepEqual(articleFields({ name: "Example", supplierRefs: ["amazon.de:B0EXAMPLE1"] }).supplierRefs, ["amazon.de:B0EXAMPLE1"]);
});

test("an intake item says which order line it arrived for", () => {
  const s = suggestionFields({ what: "bulk", articleId: "a-2222222222", orderLineId: "o-2222222222" }, { family: "m5" });
  assert.equal(s.orderLineId, "o-2222222222");
  assert.throws(() => suggestionFields({ what: "bulk", articleId: "a-2222222222", orderLineId: "x" }, { family: "m5" }), Refused);
});

test("an intake item takes from its order line what it leaves out", () => {
  const line = { articleId: undefined, article: articleFields({ name: "Example switch", category: "components" }), what: "bulk" as const, qty: 100 };
  const s = suggestionFields(fromLine({ orderLineId: "o-2222222222" }, line), { family: "m5" });
  assert.equal(s.article?.name, "Example switch");
  assert.equal(s.qty, 100);
  assert.equal(s.what, "bulk");
  const mine = suggestionFields(fromLine({ orderLineId: "o-2222222222", what: "box", qty: 50, articleId: "a-2222222222" }, line), { family: "m5" });
  assert.equal(mine.articleId, "a-2222222222");
  assert.equal(mine.qty, 50);
  assert.equal(mine.what, "box");
  assert.equal(suggestionFields(fromLine({}, { ...line, articleId: "a-3333333333" }), { family: "m5" }).articleId, "a-3333333333");
});
