// Test for the *condition-dependent* canopy optimum: the shelter (facilitation)
// benefit a parent's canopy gives its seedlings now scales with the local
// **harshness**, so the evolved canopy investment is no longer one global band but
// a *spatial selection target* that diverges with the biome — heavy where seedlings
// struggle (barren soil), light where they don't (fertile soil). Covers: the
// germination curve's optimum shifting up with harshness (and down toward cheap
// seeding when benign); the harshness scale staying non-negative at the benign
// extreme (no inverted shelter *penalty*); the default (harshness-omitted) call
// reproducing the old curve exactly at the reference, so the world is unchanged
// there; terrain driving harshness (the complement of tile fertility, barren >
// fertile) without touching the rng stream; and the end-to-end claim that selection
// pulls the trait higher on barren ground than fertile ground. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { canopyGermination } from "../src/vegetation.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// The canopy investment the germination curve peaks at, for a given harshness —
// the optimum selection pulls the trait toward at a spot of that harshness.
function argmaxCanopy(harshness) {
  let argmax = 0, peak = -Infinity;
  for (let c = 0; c <= 1.00001; c += 0.002) {
    const g = canopyGermination(c, harshness);
    if (g > peak) { peak = g; argmax = c; }
  }
  return argmax;
}

// The germination-weighted mean canopy over a uniform spread of the trait — the
// direction selection pulls the population at a spot of that harshness (heavier
// where the curve rewards investment, lighter where it rewards cheap seeding).
function selectionTarget(harshness) {
  let num = 0, den = 0;
  for (let c = 0; c <= 1.00001; c += 0.002) {
    const g = canopyGermination(c, harshness);
    num += c * g;
    den += g;
  }
  return num / den;
}

// --- The optimum is condition-dependent: it climbs monotonically with harshness,
//     and at the reference it equals the plain (harshness-omitted) curve. ---
{
  const cfg = CONFIG.vegetation.canopy;

  // The default call sits at the reference harshness, so it reproduces the old
  // single-argument curve exactly — the world is unchanged where conditions sit at
  // the reference, and the existing canopy.test.mjs (which calls it one-arg) holds.
  for (let c = 0; c <= 1.00001; c += 0.05) {
    assert.ok(
      close(canopyGermination(c), canopyGermination(c, cfg.harshnessRef)),
      "the harshness-omitted call equals the reference-harshness curve",
    );
  }

  // Harsher ground → a higher optimum (shelter is worth its fecundity cost), benign
  // ground → a lower one (cheap seeding wins). Monotone across the harshness span.
  const benign = argmaxCanopy(0.0);
  const grass = argmaxCanopy(0.15);
  const ref = argmaxCanopy(cfg.harshnessRef);
  const barren = argmaxCanopy(0.7);
  assert.ok(
    benign < grass && grass < ref && ref < barren,
    `optimum rises with harshness (benign ${benign.toFixed(2)} < grass ${grass.toFixed(2)} < ref ${ref.toFixed(2)} < barren ${barren.toFixed(2)})`,
  );
  // The divergence is real, not a rounding artefact: barren wants meaningfully more
  // canopy than fertile soil does.
  assert.ok(barren - benign > 0.1, `barren optimum clearly exceeds benign (gap ${(barren - benign).toFixed(2)})`);
  // And every optimum stays interior — the curve never degenerates to a corner, so
  // there is always a real tradeoff selection balances.
  for (const h of [0, 0.15, cfg.harshnessRef, 0.7, 1]) {
    const a = argmaxCanopy(h);
    assert.ok(a > 0 && a < 1, `the optimum stays interior at harshness ${h} (got ${a.toFixed(2)})`);
  }

  // The selection *direction* (germination-weighted mean) moves the same way, so the
  // population is pulled toward heavier canopy on harsher ground.
  assert.ok(
    selectionTarget(0.0) < selectionTarget(cfg.harshnessRef) && selectionTarget(cfg.harshnessRef) < selectionTarget(0.7),
    "selection pulls the trait higher as the ground gets harsher",
  );
}

// --- The harshness scale is clamped non-negative: an extreme-benign spot zeroes the
//     shelter benefit (cheap seeding fully wins) rather than inverting it into a
//     shelter *penalty* that would punish investment below the bare curve. ---
{
  // With facilitation scaled to zero, the curve is just the falling fecundity term,
  // so it is monotone-decreasing and peaks at canopy 0.
  const veryBenign = argmaxCanopy(-10); // well past the clamp
  assert.ok(close(veryBenign, 0), "an extreme-benign spot drives the optimum to no investment");
  // It never dips below the fecundity floor (no negative germination), and a higher
  // canopy never germinates *better* than zero canopy there.
  assert.ok(canopyGermination(0.5, -10) <= canopyGermination(0, -10) + 1e-9, "benign shelter never rewards investment");
  for (let c = 0; c <= 1.00001; c += 0.1) {
    assert.ok(canopyGermination(c, -10) >= 0, "germination never goes negative under the clamp");
  }
}

// --- Terrain drives harshness: it is the complement of the tile's fertility, so
//     barren ground reads harsher than fertile, and it draws no rng. ---
{
  const world = new World(makeRng(7), { seed: false });
  // Pure function of terrain fertility, in [0, 1].
  for (let i = 0; i < 50; i++) {
    const x = (i * 53.7) % world.width;
    const y = (i * 97.1) % world.height;
    const h = world.canopyHarshnessAt(x, y);
    assert.ok(h >= 0 && h <= 1, "harshness stays within [0, 1]");
    assert.ok(close(h, 1 - world.terrain.fertilityAt(x, y)), "harshness is the complement of terrain fertility");
  }

  // Find a barren and a fertile tile centre and confirm the ordering.
  const t = world.terrain;
  let barren = null, fertile = null;
  for (let r = 0; r < t.rows && !(barren && fertile); r++) {
    for (let c = 0; c < t.cols; c++) {
      const x = (c + 0.5) * t.tileW, y = (r + 0.5) * t.tileH;
      const f = t.fertilityAt(x, y);
      if (f > 0 && f < 0.4 && !barren) barren = { x, y };
      if (f >= 0.99 && !fertile) fertile = { x, y };
    }
  }
  assert.ok(barren && fertile, "the seed grows both barren and fertile ground");
  assert.ok(
    world.canopyHarshnessAt(barren.x, barren.y) > world.canopyHarshnessAt(fertile.x, fertile.y),
    "barren ground is harsher for a seedling than fertile ground",
  );

  // It perturbs no rng — a harshness lookup must not advance the deterministic
  // stream (so the world stays bit-identical across save/load, as the persistence
  // and canopy round-trip tests assume).
  const before = world.rng.getState();
  world.canopyHarshnessAt(barren.x, barren.y);
  world.canopyHarshnessAt(fertile.x, fertile.y);
  assert.equal(world.rng.getState(), before, "a harshness lookup draws no rng");
}

// --- End to end: at the actual terrain points, the canopy the germination curve
//     selects for is higher on the barren spot than the fertile one — so a stand
//     founding on barren soil is pulled toward heavier canopy than one on fertile
//     soil. (Realised standing-larder sorting is dispersal/drift-limited at this
//     scale — the kin-structured variant is the deeper cut — but the spatial
//     selection target the curve sets up is unambiguous and deterministic.) ---
{
  const world = new World(makeRng(7), { seed: false });
  const t = world.terrain;
  let barren = null, fertile = null;
  for (let r = 0; r < t.rows && !(barren && fertile); r++) {
    for (let c = 0; c < t.cols; c++) {
      const x = (c + 0.5) * t.tileW, y = (r + 0.5) * t.tileH;
      const f = t.fertilityAt(x, y);
      if (f > 0 && f < 0.4 && !barren) barren = { x, y };
      if (f >= 0.99 && !fertile) fertile = { x, y };
    }
  }
  const onBarren = selectionTarget(world.canopyHarshnessAt(barren.x, barren.y));
  const onFertile = selectionTarget(world.canopyHarshnessAt(fertile.x, fertile.y));
  assert.ok(
    onBarren > onFertile,
    `canopy is selected heavier on barren than fertile ground (barren ${onBarren.toFixed(3)} > fertile ${onFertile.toFixed(3)})`,
  );
}

console.log("CANOPY-NICHE TEST PASSED");
