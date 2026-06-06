// Headless tests for the minimap heatmap maths (`src/heatmap.js`): the grid
// binning, the normalisation, and the colour ramp. The canvas wash itself needs a
// browser, but every quantity it paints from is a pure function fully testable
// here — the binning of weighted world points into a coarse grid, the gamma'd
// [0, 1] normalisation, and the rgba ramp the cells are coloured by.

import assert from "node:assert";
import {
  HEATMAP_MODES,
  HEATMAP_LABELS,
  heatGridSize,
  binPoints,
  gridMax,
  normalize,
  sampleRamp,
  heatColor,
} from "../src/heatmap.js";

const approx = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= (eps ?? 1e-9), `${msg}: ${a} vs ${b}`);

const id = (v) => v;
const X = (p) => p.x;
const Y = (p) => p.y;
const ONE = () => 1;

// --- The mode list and labels stay in sync. ---
{
  assert.deepStrictEqual(HEATMAP_MODES, ["off", "population", "food", "scent"]);
  for (const m of HEATMAP_MODES) {
    assert.ok(typeof HEATMAP_LABELS[m] === "string" && HEATMAP_LABELS[m].length > 0, `label for ${m}`);
  }
}

// --- heatGridSize targets ~cellPx per cell, never below 1×1. ---
{
  const a = heatGridSize(210, 140, 7);
  assert.strictEqual(a.cols, 30, "210/7 = 30 cols");
  assert.strictEqual(a.rows, 20, "140/7 = 20 rows");
  // A tiny thumbnail still yields at least one cell on each axis.
  const b = heatGridSize(3, 2, 7);
  assert.ok(b.cols >= 1 && b.rows >= 1, "at least 1×1");
}

// --- binPoints buckets points into the right cells by position. ---
{
  // 4×2 grid over a 400×200 world: each cell is 100×100. Three points placed in
  // distinct cells, two sharing one cell.
  const pts = [
    { x: 50, y: 50 }, // col 0, row 0
    { x: 150, y: 50 }, // col 1, row 0
    { x: 150, y: 150 }, // col 1, row 1
    { x: 199, y: 150 }, // col 1, row 1 (same cell as above)
  ];
  const grid = binPoints(pts, 4, 2, 400, 200, X, Y, ONE);
  assert.strictEqual(grid.length, 8, "grid is cols*rows");
  assert.strictEqual(grid[0 * 4 + 0], 1, "cell (0,0) has one");
  assert.strictEqual(grid[0 * 4 + 1], 1, "cell (1,0) has one");
  assert.strictEqual(grid[1 * 4 + 1], 2, "cell (1,1) accumulates two");
  // Empty cells stay zero.
  assert.strictEqual(grid[1 * 4 + 3], 0, "untouched cell is zero");
}

// --- A point exactly on the far edge clamps into the last cell, not past it. ---
{
  const grid = binPoints([{ x: 400, y: 200 }], 4, 2, 400, 200, X, Y, ONE);
  // Last cell is (col 3, row 1).
  assert.strictEqual(grid[1 * 4 + 3], 1, "edge point lands in the last cell");
  // Nothing overflowed the array.
  assert.strictEqual(gridMax(grid), 1, "no overflow / double count");
}

// --- Weights accumulate, and non-positive weights are skipped. ---
{
  const pts = [
    { x: 10, y: 10, w: 2.5 },
    { x: 10, y: 10, w: 1.5 }, // same cell, adds
    { x: 10, y: 10, w: 0 }, // ignored
    { x: 10, y: 10, w: -3 }, // ignored
    { x: 10, y: 10, w: NaN }, // ignored
  ];
  const grid = binPoints(pts, 2, 2, 100, 100, X, Y, (p) => p.w);
  approx(grid[0], 4.0, 1e-9, "positive weights sum, non-positive skipped");
}

// --- An empty / missing item list yields an all-zero grid (no throw). ---
{
  const a = binPoints([], 3, 3, 100, 100, X, Y, ONE);
  assert.strictEqual(gridMax(a), 0, "empty list → zero grid");
  const b = binPoints(null, 3, 3, 100, 100, X, Y, ONE);
  assert.strictEqual(b.length, 9, "null list → zero grid of the right size");
  assert.strictEqual(gridMax(b), 0, "null list → all zero");
}

// --- gridMax reports the peak cell. ---
{
  const g = Float64Array.from([0, 3, 1, 7, 2, 0]);
  assert.strictEqual(gridMax(g), 7, "max picks the peak");
  assert.strictEqual(gridMax(new Float64Array(4)), 0, "all-zero max is 0");
}

// --- normalize scales onto [0, 1] with the peak at exactly 1. ---
{
  const g = Float64Array.from([0, 1, 4]); // max 4
  const n = normalize(g, 1); // gamma 1 → plain linear for an easy check
  approx(n[0], 0, 1e-9, "zero stays zero");
  approx(n[1], 0.25, 1e-9, "1/4 linear");
  approx(n[2], 1, 1e-9, "peak normalises to 1");
  // The input is not mutated.
  assert.strictEqual(g[2], 4, "input grid untouched");
}

// --- normalize's gamma lifts the dim end while pinning the ends. ---
{
  const g = Float64Array.from([0, 1, 4]);
  const n = normalize(g, 0.5); // sqrt
  approx(n[0], 0, 1e-9, "0 stays 0 under gamma");
  approx(n[2], 1, 1e-9, "peak stays 1 under gamma");
  approx(n[1], Math.sqrt(0.25), 1e-9, "midpoint lifted by sqrt");
  assert.ok(n[1] > 0.25, "gamma < 1 lifts the dim cell above linear");
}

// --- A flat/empty grid normalises to all zeros (no divide-by-zero). ---
{
  const n = normalize(new Float64Array(5));
  assert.strictEqual(n.length, 5, "same length");
  for (const v of n) assert.strictEqual(v, 0, "all zero, no NaN");
  assert.ok(![...n].some(Number.isNaN), "no NaN from 0/0");
}

// --- sampleRamp: ends pinned, alpha climbs from transparent to the cap. ---
{
  const lo = sampleRamp(0);
  approx(lo[3], 0, 1e-9, "alpha 0 at the dim end");
  const hi = sampleRamp(1);
  assert.ok(hi[3] > lo[3], "alpha rises with intensity");
  assert.ok(hi[3] <= 0.72 + 1e-9, "alpha capped");
  // rgb stays in range across the ramp, and is monotone-ish hot toward 1
  // (the top stop is the warm red-orange, redder than the cold blue base).
  assert.ok(hi[0] > lo[0], "hot end is redder than the cold end");
  for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const [r, g, b, a] = sampleRamp(t);
    for (const ch of [r, g, b]) assert.ok(ch >= 0 && ch <= 255, `rgb in range at t=${t}`);
    assert.ok(a >= 0 && a <= 1, `alpha in [0,1] at t=${t}`);
  }
}

// --- sampleRamp clamps out-of-range t rather than extrapolating. ---
{
  assert.deepStrictEqual(sampleRamp(-5), sampleRamp(0), "t<0 clamps to 0");
  assert.deepStrictEqual(sampleRamp(5), sampleRamp(1), "t>1 clamps to 1");
}

// --- heatColor: a zero/negative cell is fully transparent; a hot cell isn't. ---
{
  assert.strictEqual(heatColor(0), "rgba(0,0,0,0)", "zero cell paints nothing");
  assert.strictEqual(heatColor(-1), "rgba(0,0,0,0)", "negative cell paints nothing");
  const hot = heatColor(1);
  assert.ok(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/.test(hot), "well-formed rgba string");
  // The hot string carries a real (non-zero) alpha.
  const a = parseFloat(hot.slice(hot.lastIndexOf(",") + 1));
  assert.ok(a > 0, "hot cell has visible alpha");
}

// --- End-to-end: bin → normalize → colour a small synthetic population. ---
{
  // A clump in one corner, a lone point elsewhere: the clump cell should
  // normalise to 1 (the peak) and the lone cell to a dimmer, still-positive value.
  const pts = [
    { x: 5, y: 5 },
    { x: 6, y: 6 },
    { x: 7, y: 7 }, // three in cell (0,0)
    { x: 95, y: 95 }, // one in cell (3,3)
  ];
  const grid = binPoints(pts, 4, 4, 100, 100, X, Y, ONE);
  const n = normalize(grid);
  approx(n[0], 1, 1e-9, "the dense clump cell is the peak");
  const lone = n[3 * 4 + 3];
  assert.ok(lone > 0 && lone < 1, "the lone cell is dimmer but visible");
  assert.notStrictEqual(heatColor(n[0]), "rgba(0,0,0,0)", "clump cell paints");
  assert.notStrictEqual(heatColor(lone), "rgba(0,0,0,0)", "lone cell paints");
}

console.log("HEATMAP TEST PASSED");
