// Test for the *realised* spatial canopy readout (`World.stats()`): the standing
// larder's mean `canopyAmp` split by local seedling **harshness** — harsh (barren)
// ground vs. benign (fertile/grass) — and their difference (`canopySort`). This is
// the instrument the condition-dependent canopy work asked for: the germination
// curve selects for heavier canopy where seedlings struggle, so a positive sort
// means the realised standing larder actually tracks that gradient. The sort is now
// genuinely realised by *viability selection* (`canopyViability` + `World.update`'s
// withering): a plant mismatched to its local harshness is culled, pulling the
// standing distribution onto the local optimum — heavier on barren, lighter on
// fertile — where the gentle differential-seeding channel alone left it at ≈0.
//
// Covers: the harsh/benign bucketing at `harshnessRef`; the two means and the
// signed sort against a hand computation; the null edges (no food, an empty
// bucket); that the readout is pure observation (draws no rng); and that withering
// actually culls mismatched plants (and at `witherRate` 0 leaves them alone). Pure
// logic over a hand-placed larder, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { canopyGermination } from "../src/vegetation.js";
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

// --- Withering wiring: `World.update` culls a plant mismatched to its local
//     harshness much faster than a well-matched one, and at `witherRate` 0 leaves
//     both alone. This is the mechanism that realises the sort. ---
{
  const argmaxCanopy = (h) => {
    let a = 0, p = -Infinity;
    for (let c = 0; c <= 1.00001; c += 0.002) {
      const g = canopyGermination(c, h);
      if (g > p) { p = g; a = c; }
    }
    return a;
  };

  // Place equal cohorts of well-matched (canopy at the local optimum) and badly-
  // mismatched (canopy 1.0, far above a benign optimum) plants on the same benign
  // spot, run a few steps, and count how many of each *original* pellet survives.
  // No creatures (seed: false), so grazing doesn't muddy the count; food growth adds
  // unrelated pellets, which we ignore by tracking the cohorts by reference.
  const stockCohorts = (world) => {
    const { benign } = harshAndBenignSpots(world);
    const opt = argmaxCanopy(benign.h);
    const matched = [], mismatched = [];
    for (let i = 0; i < 130; i++) {
      const m = { x: benign.x, y: benign.y, kind: 0, canopyAmp: opt };
      const x = { x: benign.x, y: benign.y, kind: 0, canopyAmp: 1.0 };
      matched.push(m); mismatched.push(x);
      world.food.push(m, x);
    }
    return { matched, mismatched };
  };
  const surviving = (world, cohort) => {
    const live = new Set(world.food);
    return cohort.filter((f) => live.has(f) && !f.dead).length;
  };

  // With withering on, the mismatched cohort is culled far harder than the matched one.
  {
    const world = new World(makeRng(7), { seed: false });
    const { matched, mismatched } = stockCohorts(world);
    for (let i = 0; i < 30; i++) world.update(1 / 30);
    const mAlive = surviving(world, matched);
    const xAlive = surviving(world, mismatched);
    assert.ok(mAlive > xAlive, `matched plants outlast mismatched (matched ${mAlive} > mismatched ${xAlive})`);
    assert.ok(xAlive < matched.length * 0.5, `most mismatched plants are withered (mismatched ${xAlive}/${mismatched.length})`);
    assert.ok(mAlive > matched.length * 0.8, `well-matched plants are largely spared (matched ${mAlive}/${matched.length})`);
  }

  // With witherRate 0, the pass is skipped: neither cohort is culled by mismatch.
  {
    const saved = CONFIG.vegetation.canopy.witherRate;
    CONFIG.vegetation.canopy.witherRate = 0;
    try {
      const world = new World(makeRng(7), { seed: false });
      const { matched, mismatched } = stockCohorts(world);
      for (let i = 0; i < 30; i++) world.update(1 / 30);
      assert.equal(surviving(world, matched), matched.length, "no withering: matched cohort intact");
      assert.equal(surviving(world, mismatched), mismatched.length, "no withering: mismatched cohort intact");
    } finally {
      CONFIG.vegetation.canopy.witherRate = saved;
    }
  }
}

console.log("canopy-sort.test.mjs ✓");
