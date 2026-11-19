import { test } from "node:test";
import assert from "node:assert/strict";
import { A4, CELL, pack, type Size } from "../src/lib/labelPack.ts";

const many = (size: Size, n: number) => Array.from({ length: n }, (_, i) => ({ item: `${size}${i}`, size }));
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

function sane(sheets: ReturnType<typeof pack<string>>["sheets"]) {
  for (const s of sheets) {
    for (const p of s) {
      assert.ok(p.x >= A4.margin - 1e-6 && p.y >= A4.margin - 1e-6, "inside the margin");
      assert.ok(p.x + p.w <= A4.w - A4.margin + 1e-6 && p.y + p.h <= A4.h - A4.margin + 1e-6, "inside the margin");
    }
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) assert.ok(!overlaps(s[i], s[j]), `${s[i].item} / ${s[j].item}`);
  }
}

test("one kind fills a sheet row by row", () => {
  const r = pack(many("box", 12));
  sane(r.sheets);
  assert.equal(r.sheets.length, 1);
  assert.equal(new Set(r.sheets[0].map((p) => p.y)).size, 4, "three a row on A4 less the margins");
});

test("mixed sizes share sheets, and tiny labels fill the room beside the big ones", () => {
  const items = [...many("box", 5), ...many("article", 2), ...many("tag", 7), ...many("tiny", 60)];
  const r = pack(items);
  sane(r.sheets);
  assert.equal(r.sheets.flat().length, items.length);
  assert.equal(r.sheets.length, 1, "all of it on one sheet");
  const areaOf = (s: Size) => CELL[s].w * CELL[s].h;
  assert.ok(r.fill > items.reduce((n, x) => n + areaOf(x.size), 0) / ((A4.w - 14) * (A4.h - 14)) - 1e-9);
});

test("a part-used sheet starts below what is gone, and the next sheets start at the top", () => {
  const r = pack(many("box", 30), { usedTop: 100 });
  sane(r.sheets);
  assert.ok(Math.min(...r.sheets[0].map((p) => p.y)) >= A4.margin + 100);
  assert.equal(Math.min(...r.sheets[1].map((p) => p.y)), A4.margin);
  assert.ok(r.lastBottom > A4.margin && r.lastBottom <= A4.h - A4.margin);
});

test("nothing to print is no sheet", () => {
  assert.deepEqual(pack([]).sheets, []);
});
