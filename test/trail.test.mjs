// Headless tests for the inspector path trail (`src/trail.js`): the bounded
// position ring and the toroidal seam-splitting that turns it into drawable
// polylines. The canvas stroke itself needs a browser, but the record/cap/wrap
// logic the renderer relies on is pure and fully testable here.

import assert from "node:assert";
import { Trail, trailSegments } from "../src/trail.js";

const W = 1200;
const H = 800;

// --- A fresh trail is empty and records its first point unconditionally. ---
{
  const t = new Trail(10, 4);
  assert.equal(t.points.length, 0, "starts empty");
  t.record(100, 100, W, H);
  assert.equal(t.points.length, 1, "first point always recorded");
  assert.deepEqual(t.points[0], { x: 100, y: 100 }, "first point stored");
}

// --- A step shorter than minDist is skipped; one past it is kept. ---
{
  const t = new Trail(10, 4);
  t.record(100, 100, W, H);
  t.record(102, 100, W, H); // moved 2 < 4 → skipped
  assert.equal(t.points.length, 1, "sub-minDist step skipped");
  t.record(105, 100, W, H); // moved 5 ≥ 4 from the last KEPT point → kept
  assert.equal(t.points.length, 2, "step past minDist kept");
  // Gating is against the last kept point, not the last offered one.
  t.record(106, 100, W, H); // 1 from kept (105) → skipped
  assert.equal(t.points.length, 2, "gating measured from last kept point");
}

// --- The ring is capped at maxPoints, dropping the oldest first. ---
{
  const t = new Trail(3, 1);
  for (let i = 0; i < 6; i++) t.record(i * 10, 0, W, H);
  assert.equal(t.points.length, 3, "capped at maxPoints");
  // Oldest dropped: the three freshest remain, in order.
  assert.deepEqual(
    t.points.map((p) => p.x),
    [30, 40, 50],
    "oldest points evicted, newest kept in order",
  );
}

// --- minDist is measured on the torus: a hop across the seam is the short one. ---
{
  const t = new Trail(10, 4);
  t.record(2, 400, W, H);
  // x = W-1 is 3 units away across the right/left seam (not W-3 the long way),
  // so the 3 < 4 step is gated out.
  t.record(W - 1, 400, W, H);
  assert.equal(t.points.length, 1, "seam-short step gated by toroidal distance");
  // A genuine long step (mid-world) is kept.
  t.record(600, 400, W, H);
  assert.equal(t.points.length, 2, "real long step kept");
}

// --- clear() forgets the whole track. ---
{
  const t = new Trail(10, 1);
  t.record(0, 0, W, H);
  t.record(50, 0, W, H);
  t.clear();
  assert.equal(t.points.length, 0, "cleared to empty");
}

// --- trailSegments: a contiguous path is one polyline. ---
{
  const pts = [
    { x: 100, y: 100 },
    { x: 200, y: 150 },
    { x: 300, y: 120 },
  ];
  const segs = trailSegments(pts, W, H);
  assert.equal(segs.length, 1, "no seam crossing → one segment");
  assert.equal(segs[0].length, 3, "all points in the single segment");
}

// --- A seam crossing breaks the path into two polylines. ---
{
  const pts = [
    { x: 1190, y: 400 }, // near right edge
    { x: 1195, y: 405 },
    { x: 5, y: 410 }, // wrapped to the left edge: raw x-gap 1190 > W/2
    { x: 20, y: 415 },
  ];
  const segs = trailSegments(pts, W, H);
  assert.equal(segs.length, 2, "seam crossing splits into two segments");
  assert.deepEqual(segs[0].map((p) => p.x), [1190, 1195], "pre-seam run");
  assert.deepEqual(segs[1].map((p) => p.x), [5, 20], "post-seam run");
}

// --- A vertical seam crossing splits too (the H axis is checked). ---
{
  const pts = [
    { x: 400, y: 790 },
    { x: 405, y: 10 }, // raw y-gap 780 > H/2
  ];
  const segs = trailSegments(pts, W, H);
  // Each side is a lone point, so neither makes a drawable (≥2) polyline.
  assert.equal(segs.length, 0, "two singletons across a vertical seam draw nothing");
}

// --- A lone point on one side of a seam isn't emitted as a polyline. ---
{
  const pts = [
    { x: 1195, y: 400 }, // single point before the seam
    { x: 5, y: 400 }, // wraps
    { x: 20, y: 400 },
    { x: 35, y: 400 },
  ];
  const segs = trailSegments(pts, W, H);
  assert.equal(segs.length, 1, "the lone pre-seam point yields no polyline");
  assert.deepEqual(segs[0].map((p) => p.x), [5, 20, 35], "only the multi-point run kept");
}

// --- Fewer than two points yields nothing to draw. ---
{
  assert.deepEqual(trailSegments([], W, H), [], "empty path → no segments");
  assert.deepEqual(trailSegments([{ x: 1, y: 1 }], W, H), [], "single point → no segments");
}

console.log("TRAIL TEST PASSED");
