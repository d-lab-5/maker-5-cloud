import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogue, categoryName, categoryOf, inCategory, subCategories, topCategories } from "../dist/index.js";

test("ADR-0019: two levels, old values mapped, names in three languages", () => {
  assert.equal(topCategories()[0].code, "controllers");
  assert.ok(subCategories("controllers").some((c) => c.code === "controllers/sbc"));
  assert.equal(categoryOf("compute"), "controllers/sbc");
  assert.equal(categoryOf("constructor"), "other");
  assert.equal(inCategory("compute", "controllers"), true);
  assert.equal(categoryName("media/audio", "de"), "Audio");
  assert.equal(categoryName("controllers/sbc", "fr", true), "Contrôleurs & ordinateurs › Ordinateurs monocarte");
  const n = catalogue([{ category: "controllers/sbc", free: 1 }, { category: "storage", free: 2 }, { category: "tools", free: 1, proposed: true }]);
  assert.deepEqual(n.controllers, { articles: 2, free: 3 });
  assert.equal(n.tools.articles, 0);
});
