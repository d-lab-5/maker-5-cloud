// Same approach as digitalhome-cloud-darkfactory's core tests: n3 for parsing,
// @zazuko/env-node + rdf-validate-shacl for SHACL, as the Lambdas do.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import N3 from "n3";
import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const parse = (ttl) => new N3.Parser().parse(ttl);

async function validate(abox) {
  const shapes = rdf.dataset(); shapes.addAll(parse(read("shapes/maker-5-shapes.ttl")));
  const data = rdf.dataset(); data.addAll(parse(abox)); data.addAll(parse(read("tbox/maker-5-concepts.ttl")));
  return new SHACLValidator(shapes, { factory: rdf }).validate(data);
}

const P = "@prefix m5: <https://maker-5.cloud/ontology#> . @prefix schema: <https://schema.org/> .\n";

test("the T-Box, the concepts and the shapes parse", () => {
  for (const f of ["tbox/maker-5.ttl", "tbox/maker-5-concepts.ttl", "shapes/maker-5-shapes.ttl"]) assert.ok(parse(read(f)).length > 5, f);
});

test("every concept is labelled in EN, DE and FR", () => {
  const s = new N3.Store(parse(read("tbox/maker-5-concepts.ttl")));
  const SKOS = "http://www.w3.org/2004/02/skos/core#";
  for (const c of s.getSubjects("http://www.w3.org/1999/02/22-rdf-syntax-ns#type", SKOS + "Concept", null)) {
    const langs = s.getObjects(c, SKOS + "prefLabel", null).map((o) => o.language);
    for (const l of ["en", "de", "fr"]) assert.ok(langs.includes(l), `${c.value} has no @${l} prefLabel`);
  }
});

test("the example A-Box conforms", async () => {
  const r = await validate(read("abox/examples/example.ttl"));
  assert.ok(r.conforms, r.results.map((x) => x.message?.[0]?.value).join("; "));
});

test("a block without a name, or with a kind from no scheme, does not", async () => {
  assert.equal((await validate(`${P}<https://maker-5.cloud/id/block/b-1> a m5:Block .`)).conforms, false);
  assert.equal((await validate(`${P}<https://maker-5.cloud/id/block/b-1> a m5:Block ; schema:name "x" ; m5:blockType m5:Nonsense .`)).conforms, false);
});

test("a block names one article of the stock, with a whole quantity", async () => {
  const A = "https://maker-5.cloud/id/article/a-abcdefghjk";
  const ok = `${P}<https://maker-5.cloud/id/block/b-1> a m5:Block ; schema:name "Controller" ; m5:usesArticle <${A}> ; m5:quantity 2 .`;
  assert.ok((await validate(ok)).conforms);
  for (const bad of [`m5:usesArticle <https://example.org/a-1>`, `m5:usesArticle "a-abcdefghjk"`, `m5:usesArticle <${A}> ; m5:quantity 0`,
                     `m5:usesArticle <${A}> ; m5:quantity "two"`]) {
    assert.equal((await validate(`${P}<https://maker-5.cloud/id/block/b-1> a m5:Block ; schema:name "x" ; ${bad} .`)).conforms, false, bad);
  }
});

test("a wire joins two pins of blocks, and a block's supply and place are one each (ADR-0014)", async () => {
  const B = "https://maker-5.cloud/id/block";
  const parts = `${P}<${B}/b-1> a m5:Block ; schema:name "Controller" ; m5:supplyState m5:SupplyToBuy ; m5:canvasX 40 ; m5:canvasY 80 .
<${B}/b-2> a m5:Block ; schema:name "Opto" .
<${B}/b-1#p11> a m5:Pin ; schema:name "GPIO17" ; m5:pinOf <${B}/b-1> ; m5:pinNumber 11 ; m5:pinRole m5:PinSignal .
<${B}/b-2#p4> a m5:Pin ; schema:name "C" ; m5:pinOf <${B}/b-2> ; m5:pinNumber 4 .`;
  const wire = `<https://maker-5.cloud/id/wire/w-1> a m5:Wire ; m5:wireColor "yellow" ;`;
  assert.ok((await validate(`${parts}\n${wire} m5:wireEnd <${B}/b-1#p11> , <${B}/b-2#p4> .`)).conforms);
  for (const bad of [`${wire} m5:wireEnd <${B}/b-1#p11> .`,
                     `<${B}/b-3> a m5:Block ; schema:name "x" ; m5:supplyState m5:PinPower .`,
                     `<${B}/b-1#p12> a m5:Pin ; schema:name "y" .`,
                     `<${B}/b-1#p13> a m5:Pin ; schema:name "z" ; m5:pinOf <${B}/b-1> ; m5:pinRole m5:SupplyToBuy .`]) {
    assert.equal((await validate(`${parts}\n${bad}`)).conforms, false, bad);
  }
});

test("a block names at most one Fritzing part, by its file in the library", async () => {
  const B = `${P}<https://maker-5.cloud/id/block/b-1> a m5:Block ; schema:name "Opto" ;`;
  assert.ok((await validate(`${B} m5:fritzingPart "core/Sharp-PC817.fzp" .`)).conforms);
  for (const bad of [`"https://example.org/x.fzp"`, `"obsolete/x.fzp"`, `"core/../x.fzp"`, `"core/a.fzp", "core/b.fzp"`]) {
    assert.equal((await validate(`${B} m5:fritzingPart ${bad} .`)).conforms, false, bad);
  }
});

test("ADR-0020: a block records the commit last deployed to it, and when", async () => {
  const B = `${P}@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n<https://maker-5.cloud/id/block/b-1> a m5:Block ; schema:name "Pi" ;`;
  const at = `"2026-11-20T12:00:00Z"^^xsd:dateTime`;
  assert.ok((await validate(`${B} m5:deployedCommit "${"a".repeat(40)}" ; m5:deployedAt ${at} .`)).conforms);
  assert.equal((await validate(`${B} m5:deployedCommit "abc" .`)).conforms, false);
  assert.equal((await validate(`${B} m5:deployedAt "yesterday" .`)).conforms, false);
});
