// ADR-0018 in maker-5-shared: an edge's touch is written at most once an hour.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOUCH_EVERY_MS, touchDue } from "./store";

test("a touch is due the first time, and again only after an hour", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(touchDue(undefined, now), true);
  assert.equal(touchDue("2026-11-20T11:30:00Z", now), false);
  assert.equal(touchDue(new Date(now - TOUCH_EVERY_MS).toISOString(), now), true);
  assert.equal(touchDue("not a date", now), true);
});
