// Test for the *realised* spatial canopy readout (`World.stats()`): the standing
// larder's mean `canopyAmp` split by local seedling **harshness** — harsh (barren)
// ground vs. benign (fertile/grass) — and their difference (`canopySort`). This is
// the instrument the condition-dependent canopy work asked for: the germination
// curve selects for heavier canopy where seedlings struggle, so a positive sort
// means the realised standing larder actually tracks that gradient. (At the current
// population scale it reads ≈0 — dispersal and drift swamp the gentle gradient —
// so the readout's job is to make that absence, or a future divergence, legible.)
//
// Covers: the harsh/benign bucketing at `harshnessRef`; the two means and the
// signed sort against a hand computation; the null edges (no food, an empty
// bucket); and that the readout is pure observation — it draws no rng, so it never
// perturbs the deterministic stream. Pure logic over a hand-placed larder, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const HREF = CONFIG.vegetation.canopy.harshnessRef;

// Find a barren (harsh) and a fertile (benign) tile centre on the default
// (seed-0) terrain an unseeded world carries — the same scan the canopy-niche
// test uses. Barren ground reads harshness ≥ `harshnessRef`, fertile well below.
function harshAndBenignSpots(world) {
  const t = world.terrain;
  let harsh = null, benign = null;
  for (let r = 0; r < t.rows && !(harsh && benign); r++) {
    for (let c = 0; c < t.cols; c++) {
      const x = (c + 0.5) * t.tileW, y = (r + 0.5) * t.tileH;
      const h = world.canopyHarshnessAt(x, y);
      if (h >= HREF && !harsh) harsh = { x, y, h };
      if (h < HREF && world.terrain.fertilityAt(x, y) >= 0.99 && !benign) benign = { x, y, h };
    }
  }
  return { harsh, benign };
}

// --- The two means and the signed sort, against a hand computation. ---
{
  const world = new World(makeRng(7), { seed: false });
  const { harsh, benign } = harshAndBenignSpots(world);
  assert.ok(harsh && benign, "the seed grows both harsh (barren) and benign (fertile) ground");
  assert.ok(harsh.h >= HREF && benign.h < HREF, "the spots straddle the harshness reference");

  // Plant a known canopy mix on each: harsh mean 0.7, benign mean 0.3.
  for (const amp of [0.8, 0.6]) world.food.push({ x: harsh.x, y: harsh.y, kind: 0, canopyAmp: amp });
  for (const amp of [0.2, 0.4]) world.food.push({ x: benign.x, y: benign.y, kind: 1, canopyAmp: amp });

  const s = world.stats();
  assert.ok(close(s.canopyHarsh, 0.7), "harsh-ground mean canopy is the mean over barren plants");
  assert.ok(close(s.canopyBenign, 0.3), "benign-ground mean canopy is the mean over fertile plants");
  assert.ok(close(s.canopySort, 0.4), "the sort is harsh minus benign");
  // It points the way the selection target does (heavier canopy on harsh ground).
  assert.ok(s.canopySort > 0, "a harsh-heavier larder reads as a positive sort");
}

// --- A missing `canopyAmp` falls back to the neutral reference, like the global
//     `canopy` readout, so an older pellet shape never reads as NaN. ---
{
  const world = new World(makeRng(7), { seed: false });
  const { harsh, benign } = harshAndBenignSpots(world);
  const NEUTRAL = CONFIG.vegetation.canopy.neutral;
  world.food.push({ x: harsh.x, y: harsh.y, kind: 0 }); // no canopyAmp
  world.food.push({ x: benign.x, y: benign.y, kind: 1, canopyAmp: 0.1 });
  const s = world.stats();
  assert.ok(close(s.canopyHarsh, NEUTRAL), "a pellet with no canopy gene counts as neutral");
  assert.ok(close(s.canopyBenign, 0.1), "the benign bucket is unaffected");
  assert.ok(close(s.canopySort, NEUTRAL - 0.1), "the sort uses the neutral fallback");
}

// --- Null edges: no food, and a one-sided larder (an empty bucket). ---
{
  const empty = new World(makeRng(1), { seed: false });
  const s0 = empty.stats();
  assert.equal(s0.canopyHarsh, null, "harsh mean is null with no food");
  assert.equal(s0.canopyBenign, null, "benign mean is null with no food");
  assert.equal(s0.canopySort, null, "the sort is null with no food");

  // Only benign ground stocked: the harsh mean and the sort are null, but the
  // benign mean reads (so the HUD shows a half-readout rather than nothing).
  const world = new World(makeRng(7), { seed: false });
  const { benign } = harshAndBenignSpots(world);
  world.food.push({ x: benign.x, y: benign.y, kind: 0, canopyAmp: 0.5 });
  const s1 = world.stats();
  assert.equal(s1.canopyHarsh, null, "harsh mean is null with nothing on harsh ground");
  assert.ok(close(s1.canopyBenign, 0.5), "benign mean still reads");
  assert.equal(s1.canopySort, null, "the sort needs both buckets populated");
}

// --- Pure observation: computing the readout draws no rng, so it never perturbs
//     the deterministic stream (the persistence/replay tests rely on this). ---
{
  const world = new World(makeRng(7), { seed: false });
  const { harsh, benign } = harshAndBenignSpots(world);
  world.food.push({ x: harsh.x, y: harsh.y, kind: 0, canopyAmp: 0.7 });
  world.food.push({ x: benign.x, y: benign.y, kind: 1, canopyAmp: 0.3 });
  const before = world.rng.getState();
  const s = world.stats();
  assert.equal(world.rng.getState(), before, "stats() draws no rng");
  assert.ok(Number.isFinite(s.canopySort), "the sort is a finite number, never NaN");
}

console.log("canopy-sort.test.mjs ✓");
