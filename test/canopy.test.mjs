// Unit + behaviour test for the heritable vegetation-feedback strength: each
// pellet carries a `canopyAmp` gene for how strongly it shapes its understory
// microclimate, so the feedback's *gain* is now a selected trait rather than a
// flat constant. Covers: the germination curve's shape (the two opposing
// pressures and their interior optimum), single-parent inheritance (heritability
// + clamping), the nearest-parent lookup, the canopy-scaled lean vote (with the
// neutral plant reproducing the legacy ±1), the `spawnFood` wiring, the `stats`
// readout, that selection actually pulls the trait back to an interior
// equilibrium from both extremes, and the v12 save round-trip. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import {
  VegetationField,
  canopyGermination,
  inheritCanopy,
} from "../src/vegetation.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = CONFIG.world.width;
const H = CONFIG.world.height;
const NEUTRAL = CONFIG.vegetation.canopy.neutral;

// --- The germination curve: a falling fecundity cost against a rising,
//     saturating facilitation benefit, with an interior optimum between. ---
{
  // A neutral-free baseline: at canopy 0 there is no cost and no shelter, so the
  // multiplier is exactly 1.
  assert.ok(close(canopyGermination(0), 1), "germination at canopy 0 is the bare 1");

  // It rises off 0 (shelter outweighs the small early tax) and ends below its
  // peak at canopy 1 (the linear tax has overtaken the saturated shelter) — i.e.
  // there is an interior maximum, the investment selection settles toward.
  let argmax = 0, peak = -Infinity;
  for (let c = 0; c <= 1.00001; c += 0.01) {
    const g = canopyGermination(c);
    if (g > peak) { peak = g; argmax = c; }
  }
  assert.ok(argmax > 0.01 && argmax < 0.99, `germination peaks in the interior (got ${argmax.toFixed(2)})`);
  assert.ok(canopyGermination(argmax) > canopyGermination(0), "the optimum beats no investment");
  assert.ok(canopyGermination(argmax) > canopyGermination(1), "the optimum beats max investment");
  assert.ok(canopyGermination(0) >= 0 && canopyGermination(1) >= 0, "germination never goes negative");

  // Heavier fecundity cost lowers the return on a given high investment.
  const saved = CONFIG.vegetation.canopy.fecundityCost;
  const before = canopyGermination(0.9);
  CONFIG.vegetation.canopy.fecundityCost = saved * 2;
  assert.ok(canopyGermination(0.9) < before, "a steeper fecundity cost lowers high-canopy germination");
  CONFIG.vegetation.canopy.fecundityCost = saved;
}

// --- Inheritance: a sprout copies its parent's investment with a small mutation,
//     clamped onto [0, 1]; over many draws the mean tracks the parent. ---
{
  const rng = makeRng(101);
  let sum = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const v = inheritCanopy(0.6, rng);
    assert.ok(v >= 0 && v <= 1, "an inherited gene stays within [0, 1]");
    sum += v;
  }
  assert.ok(Math.abs(sum / N - 0.6) < 0.02, "inheritance is centred on the parent's value");
  // Clamping at the rails: an extreme parent can't push a child out of range.
  for (let i = 0; i < 500; i++) {
    assert.ok(inheritCanopy(0, rng) >= 0, "child of a 0 parent stays >= 0");
    assert.ok(inheritCanopy(1, rng) <= 1, "child of a 1 parent stays <= 1");
  }
}

// --- Nearest-parent lookup: a sprout inherits from the nearest same-kind plant
//     in reach, ignores the off-kind, and falls back to neutral with none near. ---
{
  const world = new World(makeRng(5), { seed: false });
  const r = CONFIG.vegetation.canopy.inheritRadius;
  world.food = [
    { x: 400, y: 300, kind: 0, canopyAmp: 0.8 }, // near, same kind
    { x: 400 + r * 0.4, y: 300, kind: 0, canopyAmp: 0.2 }, // farther, same kind
    { x: 405, y: 305, kind: 1, canopyAmp: 0.9 }, // very near, but off-kind
  ];
  world.canopyGrid.rebuild(world.food);
  assert.ok(close(world.parentCanopyAt(400, 300, 0), 0.8), "inherits the nearest same-kind parent");
  assert.ok(close(world.parentCanopyAt(405, 305, 1), 0.9), "the off-kind plant parents only its own kind");
  // Far from any same-kind plant → a pioneer starts at neutral.
  assert.ok(close(world.parentCanopyAt(900, 650, 0), NEUTRAL), "a pioneer with no parent in reach starts neutral");
}

// --- The lean vote is scaled by the plant's investment, and a neutral plant
//     reproduces the legacy ±1 vote exactly (so old/test pellets are unchanged). ---
{
  const clump = (kind, amp, n) =>
    Array.from({ length: n }, (_, i) => ({ x: 600 + (i % 5) * 2 - 4, y: 400 + ((i * 3) % 7) - 3, kind, ...(amp == null ? {} : { canopyAmp: amp }) }));

  // A neutral-canopy stand and a legacy stand (no gene at all) give the identical
  // field — the `?? neutral` fallback and the `amp/neutral` vote agree at neutral.
  const legacy = new VegetationField(W, H);
  const neutral = new VegetationField(W, H);
  legacy.rebuild(clump(0, null, 40));
  neutral.rebuild(clump(0, NEUTRAL, 40));
  for (let i = 0; i < 20; i++) {
    const x = (i * 53.7) % W, y = (i * 97.1) % H;
    assert.ok(close(legacy.warmthOffsetAt(x, y), neutral.warmthOffsetAt(x, y)), "a neutral plant votes exactly like the legacy ±1");
  }

  // A heavily-invested stand shapes its understory more strongly than a light one
  // (same kind, count, and positions — only the gene differs).
  const heavy = new VegetationField(W, H);
  const light = new VegetationField(W, H);
  heavy.rebuild(clump(0, 0.9, 40));
  light.rebuild(clump(0, 0.2, 40));
  assert.ok(
    heavy.warmthOffsetAt(600, 400) > light.warmthOffsetAt(600, 400),
    "a heavy-canopy stand nudges its climate harder than a light one",
  );
}

// --- spawnFood wiring: an explicit plant inherits the local stand's investment
//     (averaged over many draws), and every sprout carries a gene in [0, 1]. ---
{
  const world = new World(makeRng(9), { seed: false });
  world.food = Array.from({ length: 30 }, (_, i) => ({ x: 500 + (i % 6) * 3, y: 350 + ((i * 2) % 9), kind: 0, canopyAmp: 0.75 }));
  world.canopyGrid.rebuild(world.food);
  const start = world.food.length;
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const f = world.spawnFood(503, 353); // inside the stand
    assert.ok(f.canopyAmp >= 0 && f.canopyAmp <= 1, "a planted sprout carries a gene in [0, 1]");
    sum += f.canopyAmp;
  }
  assert.ok(Math.abs(sum / 300 - 0.75) < 0.03, "explicit sprouts inherit the local stand's investment");
  assert.equal(world.food.length, start + 300, "each explicit placement added a pellet");
}

// --- stats(): reports the standing larder's mean canopy, null with no food. ---
{
  const world = new World(makeRng(3), { seed: false });
  assert.equal(world.stats().canopy, null, "no food → canopy is null");
  world.food = [
    { x: 100, y: 100, kind: 0, canopyAmp: 0.4 },
    { x: 200, y: 200, kind: 1, canopyAmp: 0.6 },
  ];
  assert.ok(close(world.stats().canopy, 0.5), "canopy is the mean over the standing larder");
}

// --- Selection works: the trait is pulled back to an interior equilibrium from
//     *both* extremes (proof it is genuinely heritable and under selection, not a
//     mean-reverting constant). Perturb a living world's whole larder high and
//     low and watch the mean canopy move back toward the middle. ---
{
  const recover = (forced) => {
    const world = new World(makeRng(99));
    for (let i = 0; i < 900; i++) world.update(1 / 30); // establish a population + larder
    assert.ok(world.creatures.length > 0 && world.food.length > 0, "precondition: a living, stocked world");
    for (const f of world.food) f.canopyAmp = forced;
    for (let i = 0; i < 3000; i++) world.update(1 / 30); // ~100s of selection
    return world.stats().canopy;
  };
  const fromLow = recover(0.1);
  const fromHigh = recover(0.9);
  assert.ok(fromLow != null && fromLow > 0.25, `canopy climbs back up from 0.1 (got ${fromLow?.toFixed(3)})`);
  assert.ok(fromHigh != null && fromHigh < 0.75, `canopy falls back down from 0.9 (got ${fromHigh?.toFixed(3)})`);
}

// --- Save/load: the gene rides the food tuple, the version covers it, a restored
//     world replays bit-identically (canopy included), and a pre-v12 save is
//     rejected rather than rebuilt off a NaN-voting larder. ---
{
  const world = new World(makeRng(31));
  for (let i = 0; i < 600; i++) world.update(1 / 30);
  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.equal(blob.version, 12, "the heritable canopy gene bumps SAVE_VERSION to 12");
  assert.ok(blob.food.length > 0 && blob.food[0].length === 4, "food serializes as [x, y, kind, canopyAmp]");
  assert.ok(blob.food.every(([, , , a]) => a >= 0 && a <= 1), "every serialized canopy gene is in range");

  const restored = World.deserialize(blob, makeRng());
  for (let i = 0; i < 600; i++) {
    world.update(1 / 30);
    restored.update(1 / 30);
  }
  assert.deepEqual(
    restored.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind, Math.round(f.canopyAmp * 1e6)]),
    world.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind, Math.round(f.canopyAmp * 1e6)]),
    "the larder (canopy genes included) replays bit-identically across save/load",
  );

  const stale = JSON.parse(JSON.stringify(world.serialize()));
  stale.version = 11;
  assert.throws(() => World.deserialize(stale, makeRng()), /unsupported save version/, "a pre-v12 save is rejected");
}

console.log("CANOPY TEST PASSED");
