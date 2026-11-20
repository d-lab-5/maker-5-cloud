// npm test (backend): the Lambdas validate against the same files as
// packages/ontology, and refuse what its shapes refuse (ADR-0007).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONCEPTS, SHAPES, TBOX } from "./ontology.generated";
import { validateAbox } from "./validate";

const ONTOLOGY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/ontology");
const read = (rel: string) => fs.readFileSync(path.join(ONTOLOGY, rel), "utf8");
const P = `@prefix m5: <https://maker-5.cloud/ontology#> . @prefix schema: <https://schema.org/> .\n`;

test("the generated copy matches packages/ontology", () => {
  assert.equal(TBOX, read("tbox/maker-5.ttl"), "run: node backend/scripts/sync-ontology.mjs");
  assert.equal(CONCEPTS, read("tbox/maker-5-concepts.ttl"), "run: node backend/scripts/sync-ontology.mjs");
  assert.equal(SHAPES, read("shapes/maker-5-shapes.ttl"), "run: node backend/scripts/sync-ontology.mjs");
});

test("a conforming A-Box is accepted", async () => {
  const v = await validateAbox(`${P}<https://maker-5.cloud/id/block/b-1> a m5:Block ; schema:name "Sensor board" ; m5:blockType m5:Electronic .`);
  assert.equal(v.ok, true, v.problems.join("; "));
  assert.equal(v.triples, 3);
});

test("a block without a name is refused, with the shape's message", async () => {
  const v = await validateAbox(`${P}<https://maker-5.cloud/id/block/b-1> a m5:Block .`);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /needs a name/.test(p)), v.problems.join("; "));
});

test("an A-Box may not describe the vocabulary or anything outside the id space", async () => {
  const v = await validateAbox(`${P}m5:Block a <http://www.w3.org/2002/07/owl#Class> .`);
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /outside/);
});

test("not Turtle is refused, not thrown", async () => {
  const v = await validateAbox("this is not turtle");
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /not valid Turtle/);
});

test("a save counts blocks and modules for the landing page", async () => {
  const v = await validateAbox(`${P}<https://maker-5.cloud/id/block/b-1> a m5:Block ; schema:name "Bell board" ; m5:blockType m5:Electronic .`);
  assert.deepEqual(v.counts, { blocks: 1, modules: 0 });
});
