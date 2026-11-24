import { test } from "node:test";
import assert from "node:assert/strict";
import { nextNumber } from "../src/lib/boxNames.ts";

test("a batch starts after the highest number of its name", () => {
  assert.equal(nextNumber("Cabinet", ["Cabinet 01", "Cabinet 02", "Box 07"]), 3);
  assert.equal(nextNumber("Box", []), 1);
  assert.equal(nextNumber("Bin (A)", ["bin (a) 09"]), 10);
});
