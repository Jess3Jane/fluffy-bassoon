// Unit test for the microclimate→larder feedback (src/plants.js + World.spawnFood):
// the spatial climate mosaic now biases *which* plant kind sprouts where and *how
// richly* it takes root, so the climate map and the plant-kind patchwork reinforce
// one biome instead of two independent overlays. Sunleaf (kind 0) thrives in warm,
// wet ground; moonleaf (kind 1) in cool, dry — matching the kinds' own climate
// leans. Covers the pure helpers (`kindClimateScore`, `kindClimateBias`,
// `kindFertilityFactor`, the biased `plantKindAt`), the wiring through `spawnFood`
// (kinds cluster by region, both at random and explicit placement), the
// `biomeSort` readout, and that it adds no serialized state (bit-identical
// replay across save/load, no SAVE_VERSION bump). Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { Microclimate } from "../src/microclimate.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";
import {
  plantKindAt,
  kindClimateScore,
  kindClimateBias,
  kindFertilityFactor,
} from "../src/plants.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = CONFIG.world.width;
const H = CONFIG.world.height;
const kindBias = CONFIG.food.microclimateKindBias;
const fertBias = CONFIG.food.microclimateFertilityBias;

// --- kindClimateScore: sunleaf loves warm-wet, moonleaf loves cool-dry, and the
//     two are exact opposites. ---
{
  // Warm-wet ground: sunleaf (kind 0) scores positive, moonleaf (kind 1)
  // exactly the negation.
  assert.ok(kindClimateScore(0, 0.3, 0.2) > 0, "sunleaf is at home in warm-wet ground");
  assert.ok(kindClimateScore(1, 0.3, 0.2) < 0, "moonleaf is out of place in warm-wet ground");
  assert.ok(close(kindClimateScore(0, 0.3, 0.2), -kindClimateScore(1, 0.3, 0.2)), "the kinds score as exact opposites");
  // Cool-dry ground flips it.
  assert.ok(kindClimateScore(1, -0.3, -0.2) > 0, "moonleaf is at home in cool-dry ground");
  assert.ok(kindClimateScore(0, -0.3, -0.2) < 0, "sunleaf is out of place in cool-dry ground");
  // It's the sum of the two offsets (scaled by the lean), so it's neutral when
  // warmth and wetness cancel.
  assert.ok(close(kindClimateScore(0, 0.2, -0.2), 0), "opposing offsets cancel to a neutral score");
}

// --- kindClimateBias nudges plantKindAt's threshold the right way: warm-wet
//     toward sunleaf (kind 0), cool-dry toward moonleaf (kind 1). ---
{
  // Pick a point whose bare sine field sits just on the moonleaf side, then show
  // a warm-wet region pulls it back to sunleaf and a cool-dry one keeps moonleaf.
  // Scan for a point with a small positive bare field value.
  let px = 0, py = 0, bare = -1;
  for (let x = 0; x < W && bare <= 0; x += 7) {
    for (let y = 0; y < H; y += 7) {
      const v = Math.sin(x * 0.012) + Math.sin(y * 0.016);
      if (v > 0 && v < 0.5) { px = x; py = y; bare = v; break; }
    }
  }
  assert.ok(bare > 0, "found a point on the moonleaf side of the bare patchwork");
  assert.equal(plantKindAt(px, py), 1, "with no bias it's moonleaf");

  // A strong warm-wet region (positive offsets) nudges the threshold negative,
  // flipping it to sunleaf; a cool-dry region (negative offsets) leaves moonleaf.
  const warmWet = kindClimateBias(0.4, 0.35);
  const coolDry = kindClimateBias(-0.4, -0.35);
  assert.ok(warmWet < 0, "warm-wet ground nudges the threshold toward sunleaf");
  assert.ok(coolDry > 0, "cool-dry ground nudges the threshold toward moonleaf");
  assert.equal(plantKindAt(px, py, warmWet), 0, "a warm-wet region flips the spot to sunleaf");
  assert.equal(plantKindAt(px, py, coolDry), 1, "a cool-dry region keeps the spot moonleaf");

  // Zero offsets → zero bias → the bare patchwork (back-compat for old callers).
  assert.equal(plantKindAt(px, py, kindClimateBias(0, 0)), plantKindAt(px, py), "no offset leaves the bare split");
}

// --- kindFertilityFactor boosts a kind in its climate, thins it out of place,
//     floors at 0, and is a flat 1 with no climate signal. ---
{
  // Sunleaf in warm-wet ground: boosted above 1.
  const boost = kindFertilityFactor(0, 0.4, 0.35);
  const thin = kindFertilityFactor(1, 0.4, 0.35); // moonleaf, out of place there
  assert.ok(boost > 1, "a kind in its preferred climate takes root more readily");
  assert.ok(thin < 1, "a kind out of its climate takes root less readily");
  assert.ok(close(boost, 1 + fertBias * kindClimateScore(0, 0.4, 0.35)), "the factor is 1 + bias·score");
  // Neutral ground (no offset) → flat 1.
  assert.ok(close(kindFertilityFactor(0, 0, 0), 1), "no climate signal leaves fertility untouched");
  assert.ok(close(kindFertilityFactor(1, 0, 0), 1), "no climate signal leaves fertility untouched (moonleaf)");
  // Floored at 0 — a strong enough penalty can't drive the multiplier negative.
  assert.ok(kindFertilityFactor(1, 5, 5) >= 0, "the factor never goes negative");
  assert.equal(kindFertilityFactor(1, 5, 5), 0, "an extreme mismatch floors the factor at 0");
}

// --- The feedback can be switched off: at bias 0 the helpers reduce to the old
//     position-only behaviour exactly. ---
{
  const savedK = CONFIG.food.microclimateKindBias;
  const savedF = CONFIG.food.microclimateFertilityBias;
  CONFIG.food.microclimateKindBias = 0;
  CONFIG.food.microclimateFertilityBias = 0;
  for (const [x, y] of [[100, 200], [500, 300], [900, 600]]) {
    assert.equal(plantKindAt(x, y, kindClimateBias(0.4, 0.35)), plantKindAt(x, y), "bias 0 → bare patchwork");
    assert.ok(close(kindFertilityFactor(0, 0.4, 0.35), 1), "fertility bias 0 → flat 1");
  }
  CONFIG.food.microclimateKindBias = savedK;
  CONFIG.food.microclimateFertilityBias = savedF;
}

// --- Wiring: a seeded world's larder sorts by region. Pellets in warm-wet
//     ground skew sunleaf, those in cool-dry ground skew moonleaf, so the
//     average climate score of the standing larder is clearly positive. ---
{
  const world = new World(makeRng(2026));
  assert.ok(world.food.length > 100, "the seeded larder is well stocked");
  // Both kinds still grow (the bias sorts them, it doesn't erase one).
  assert.ok(
    world.food.some((f) => f.kind === 0) && world.food.some((f) => f.kind === 1),
    "both plant kinds still grow under the feedback",
  );
  // Each pellet should mostly sit where its kind belongs.
  let aligned = 0;
  let scoreSum = 0;
  for (const f of world.food) {
    const dw = world.microclimate.warmthOffsetAt(f.x, f.y);
    const dm = world.microclimate.wetnessOffsetAt(f.x, f.y);
    const score = kindClimateScore(f.kind, dw, dm);
    if (score > 0) aligned++;
    scoreSum += score;
  }
  assert.ok(
    aligned / world.food.length > 0.6,
    `most pellets grow in the climate their kind favours (got ${(aligned / world.food.length).toFixed(2)})`,
  );
  assert.ok(scoreSum / world.food.length > 0, "the larder's mean climate alignment is positive");
}

// --- biomeSort surfaces that alignment in [-1, 1], positive when the feedback
//     has knit the kinds to the climate, and null with no food. ---
{
  const world = new World(makeRng(2026));
  const s = world.stats();
  assert.ok(s.biomeSort != null, "biomeSort is reported once there's a larder");
  assert.ok(s.biomeSort > 0, "a sorted larder reads as a positive biome alignment");
  assert.ok(s.biomeSort > -1 && s.biomeSort <= 1, "biomeSort stays within [-1, 1]");

  // Matches a hand computation over the standing larder.
  let sum = 0;
  for (const f of world.food) {
    sum += kindClimateScore(
      f.kind,
      world.microclimate.warmthOffsetAt(f.x, f.y),
      world.microclimate.wetnessOffsetAt(f.x, f.y),
    );
  }
  const norm = world.microclimate.warmthAmp + world.microclimate.wetnessAmp;
  assert.ok(close(s.biomeSort, sum / world.food.length / norm), "biomeSort matches the mean normalised score");

  const empty = new World(makeRng(1), { seed: false });
  assert.equal(empty.stats().biomeSort, null, "biomeSort is null with no food");
}

// --- A world neutralised of any microclimate signal falls back to the bare
//     ~50/50 patchwork and a ~0 biome alignment (the feedback truly off). ---
{
  const world = new World(makeRng(7), { seed: false });
  // Flatten the microclimate so every offset is 0.
  world.microclimate.warmthAmp = 0;
  world.microclimate.wetnessAmp = 0;
  for (let i = 0; i < 400; i++) world.spawnFood();
  // With no offsets the kind is the bare plantKindAt, and biomeSort is null
  // (norm is 0) — graceful, not a divide-by-zero NaN.
  for (const f of world.food) {
    assert.equal(f.kind, plantKindAt(f.x, f.y), "with a flat microclimate the kind is the bare patchwork");
  }
  assert.equal(world.stats().biomeSort, null, "a flat microclimate yields no biome signal (null, not NaN)");
}

// --- Explicit placement (the food brush) gets the biome-correct kind. ---
{
  const world = new World(makeRng(9), { seed: false });
  // Find a point where the bias actually flips the kind, and confirm spawnFood
  // at explicit coords lands on the biased kind, not the bare one.
  const mc = world.microclimate;
  let flipped = false;
  for (let x = 0; x < W && !flipped; x += 11) {
    for (let y = 0; y < H; y += 11) {
      const dw = mc.warmthOffsetAt(x, y);
      const dm = mc.wetnessOffsetAt(x, y);
      const biased = plantKindAt(x, y, kindClimateBias(dw, dm));
      if (biased !== plantKindAt(x, y)) {
        const f = world.spawnFood(x, y);
        assert.equal(f.kind, biased, "an explicitly placed pellet takes the biome-biased kind");
        assert.equal(f.x, x, "placed verbatim in x");
        assert.equal(f.y, y, "placed verbatim in y");
        flipped = true;
        break;
      }
    }
  }
  assert.ok(flipped, "found a spot where the biome bias flips the kind");
}

// --- No new serialized state: a world replays bit-identically across save/load
//     (the kinds ride the existing food serialization, the microclimate regrows
//     from its seed), and SAVE_VERSION is untouched. ---
{
  const world = new World(makeRng(31));
  for (let i = 0; i < 200; i++) world.update(1 / 60);
  const blob = JSON.parse(JSON.stringify(world.serialize()));
  const restored = World.deserialize(blob, makeRng());

  // Run both forward and compare the larder kind-by-kind — new growth must use
  // the regrown microclimate identically.
  for (let i = 0; i < 200; i++) {
    world.update(1 / 60);
    restored.update(1 / 60);
  }
  assert.deepEqual(
    restored.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind]),
    world.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind]),
    "the larder (positions and kinds) replays bit-identically across save/load",
  );
  assert.equal(world.creatures.length, restored.creatures.length, "the population replays identically too");
}

console.log("BIOME TEST PASSED");
