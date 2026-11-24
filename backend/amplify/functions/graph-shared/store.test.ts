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

test("active means an edge used it in the last 14 days", async () => {
  const { activeAt } = await import("./activity");
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(activeAt("2026-11-07T12:00:00Z", now), true);
  assert.equal(activeAt("2026-11-06T11:00:00Z", now), false);
  assert.equal(activeAt(undefined, now), false);
});

test("ADR-0017: a repository link is a GitHub address, a branch and a full commit", async () => {
  const { repoProblem } = await import("./store");
  assert.equal(repoProblem({ url: "https://github.com/example-org/door-bell", branch: "main", commit: "a".repeat(40) }), null);
  assert.equal(repoProblem({ url: "https://github.com/example-org/door-bell", branch: "main" }), null);
  assert.match(repoProblem({ url: "https://example.org/x/y", branch: "main" })!, /GitHub/);
  assert.match(repoProblem({ url: "https://github.com/example-org/door-bell/../x", branch: "main" })!, /GitHub/);
  assert.match(repoProblem({ url: "https://github.com/example-org/door-bell", branch: "a..b" })!, /branch/);
  assert.match(repoProblem({ url: "https://github.com/example-org/door-bell", branch: "main", commit: "abc" })!, /commit/);
});
