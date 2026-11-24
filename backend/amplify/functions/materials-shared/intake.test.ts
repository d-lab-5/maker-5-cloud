import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "./stock";
import { normalise, markOf, family } from "./codes";
import { captureFields, photoFields, plan, suggestionFields, articleOf, type IntakeItem } from "./intake";

// The intake (ADR-0022 in maker-5-shared).

const item = (over: Partial<IntakeItem> = {}): IntakeItem => ({
  tenantId: "t-1", id: "i-2222222222", code: { kind: "m5", value: "K7Q2M9" }, family: "m5",
  placeId: "x-2222222222", placeName: "Shelf A", photos: [], status: "new", at: "2026-11-24", by: "someone@example.org", ...over,
});

test("a DHC label is read like an M5 one, and prints its own mark", () => {
  for (const raw of ["DHC K7Q2M9", "dhc-k7q2m9", "DHCK7Q2M9", "M5 K7Q2M9"]) assert.deepEqual(normalise(raw), { kind: "m5", value: "K7Q2M9" }, raw);
  assert.equal(markOf("dhc"), "DHC");
  assert.equal(markOf(family(undefined)), "M5");
});

test("a scan's note and count, and a photo's type and size, are checked", () => {
  assert.deepEqual(captureFields({ note: "  two   Pi 3  ", qty: "2" }), { note: "two Pi 3", qty: 2 });
  assert.throws(() => captureFields({ qty: -1 }), Refused);
  assert.deepEqual(photoFields({ type: "image/jpeg", size: 1000 }), { type: "image/jpeg", size: 1000 });
  assert.throws(() => photoFields({ type: "image/svg+xml", size: 10 }), Refused);
  assert.throws(() => photoFields({ type: "image/jpeg", size: 9 * 1024 * 1024 }), Refused);
});

test("a device is one unit of a serial article; our code goes on the unit", () => {
  const s = suggestionFields({ what: "device", serial: "SN1", article: { name: "Mini PC", category: "controllers/sbc" } }, item({ family: "dhc" }));
  assert.equal(s.article?.tracking, "serial");
  assert.equal(s.article?.family, "dhc", "a DHC label makes a DHC article");
  assert.deepEqual(plan(item(), s), { what: "device", qty: 1, serial: "SN1", bind: "unit" });
  const ean = plan(item({ code: { kind: "ean", value: "04006381333931" } }), s);
  assert.equal(ean.bind, "article", "a product's barcode names the article");
});

test("a box of parts becomes a box in the place; loose parts are counted into it", () => {
  const box = suggestionFields({ what: "box", qty: 100, boxKind: "bag", article: { name: "Resistor 10k", category: "components/passives" } }, item());
  assert.deepEqual(plan(item(), box), { what: "box", qty: 100, bind: "box", boxName: "Resistor 10k", boxKind: "bag" });
  const loose = suggestionFields({ what: "bulk", article: { name: "M3 screw", category: "mechanical/fasteners" } }, item());
  assert.deepEqual(plan(item({ qty: 40 }), loose), { what: "bulk", qty: 40, bind: "article" });
  assert.throws(() => suggestionFields({ what: "box", boxKind: "shelf", article: { name: "x" } }, item()), Refused);
});

test("a known label moves what it names, or adds to its article", () => {
  assert.deepEqual(plan(item({ known: { kind: "unit", id: "u-2222222222" } }), undefined),
    { what: "move", qty: 1, bind: "none", move: { kind: "unit", id: "u-2222222222" } });
  assert.throws(() => plan(item({ known: { kind: "box", id: "x-2222222222" } }), undefined), Refused, "not into itself");
  const k = item({ known: { kind: "article", id: "a-2222222222" } });
  const s = suggestionFields({ what: "bulk", qty: 5, articleId: "a-3333333333" }, k);
  assert.equal(articleOf(k, s), "a-2222222222", "the label's article wins");
  assert.deepEqual(plan(k, s, { tracking: "bulk", name: "LED" }), { what: "bulk", qty: 5, bind: "none", articleId: "a-2222222222" });
});

test("what cannot be checked in is refused before anything is written", () => {
  const dev = suggestionFields({ what: "device", article: { name: "PSU", category: "power/supplies" } }, item());
  assert.throws(() => plan(item({ status: "checked-in" }), dev), /checked in already/);
  assert.throws(() => plan(item({ status: "dropped" }), dev), /dropped/);
  assert.throws(() => plan(item({ placeId: undefined }), dev), /shelf or box/);
  assert.throws(() => plan(item(), undefined), /Describe/);
  assert.throws(() => plan(item(), dev, { tracking: "bulk", name: "PSU" }), /unit by unit/);
  assert.throws(() => plan(item(), suggestionFields({ what: "bulk", articleId: "a-2222222222" }, item()), { tracking: "bulk", name: "x", proposed: { by: "e", at: "t" } }), /proposed/);
  assert.throws(() => suggestionFields({ what: "thing" }, item()), Refused);
});
