import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "./stock";
import { MAX_DOCS, docFields, sameDoc, withDocs, type DocFile } from "./docs";

// Documents of a part (ADR-0024 in maker-5-shared). Every name here is invented.

const doc = (id: string, sha?: string): DocFile =>
  ({ id, kind: "receipt", name: `${id}.pdf`, size: 10, type: "application/pdf", sha256: sha, at: "2026-11-25", by: "u" });

test("a document is a named file of a kind, with its hash and where it came from", () => {
  const d = docFields({ name: "../Service - Shipment EXAMPLE1.pdf", size: 1000, type: "application/pdf",
    sha256: "A".repeat(64), source: "  example.org   EX-1 " });
  assert.equal(d.name, "Service - Shipment EXAMPLE1.pdf");
  assert.equal(d.kind, "receipt", "a supplier's document is a receipt unless said");
  assert.equal(d.sha256, "a".repeat(64));
  assert.equal(d.source, "example.org EX-1");
  assert.equal(docFields({ name: "x.bin", size: 1, type: "not a type" }).type, "application/octet-stream");
  assert.throws(() => docFields({ name: "x.pdf", size: 0 }), Refused);
  assert.throws(() => docFields({ name: "x.pdf", size: 51 * 1024 * 1024 }), Refused);
  assert.throws(() => docFields({ name: "x.pdf", size: 1, kind: "secret" }), Refused);
  assert.throws(() => docFields({ name: "x.pdf", size: 1, sha256: "abc" }), Refused);
});

test("the same document is kept once, by its id or its content", () => {
  assert.ok(sameDoc(doc("aaaaaaaaaaaa"), doc("aaaaaaaaaaaa")));
  assert.ok(sameDoc(doc("aaaaaaaaaaaa", "1".repeat(64)), doc("bbbbbbbbbbbb", "1".repeat(64))));
  assert.ok(!sameDoc(doc("aaaaaaaaaaaa"), doc("bbbbbbbbbbbb")));
  const { list, added } = withDocs([doc("aaaaaaaaaaaa", "1".repeat(64))],
    [doc("bbbbbbbbbbbb", "1".repeat(64)), doc("cccccccccccc"), doc("cccccccccccc")]);
  assert.deepEqual(list.map((d) => d.id), ["aaaaaaaaaaaa", "cccccccccccc"]);
  assert.deepEqual(added.map((d) => d.id), ["cccccccccccc"]);
});

test("a part keeps at most MAX_DOCS documents", () => {
  const full = Array.from({ length: MAX_DOCS }, (_, i) => doc(String(i).padStart(12, "0")));
  assert.throws(() => withDocs(full, [doc("ffffffffffff")]), Refused);
  assert.equal(withDocs(full, [full[0]]).added.length, 0, "one it has already is no new one");
});
