// Unit test for the vegetation feedback: the standing larder's reach back onto
// the microclimate (`src/vegetation.js` + the `World.warmthOffsetAt` /
// `wetnessOffsetAt` wiring). The static microclimate shapes which plant kind
// grows where; this closes the loop so a standing stand nudges its *own* local
// climate toward the conditions its kind thrives in (sunleaf warm-wet, moonleaf
// cool-dry), a positive feedback that can sharpen/drift/oscillate the kind
// boundaries. Covers: the pure field (determinism, bounds, kind-aware direction,
// mean-respecting centring), the combined `World` accessor, the feedback-off
// fallback, and that it adds no serialized state (bit-identical replay across
// save/load, no SAVE_VERSION bump). Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { VegetationField } from "../src/vegetation.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = CONFIG.world.width;
const H = CONFIG.world.height;
const ampW = CONFIG.vegetation.warmthAmplitude;
const ampM = CONFIG.vegetation.wetnessAmplitude;

// A clump of `n` pellets of one kind around a point (jittered deterministically).
function clump(x, y, kind, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: x + (i % 5) * 2 - 4, y: y + ((i * 3) % 7) - 3, kind });
  }
  return out;
}

// --- An empty larder leaves every offset at exactly 0 (no nudge until plants
//     stand), and a fresh field reads 0 before any rebuild. ---
{
  const veg = new VegetationField(W, H);
  for (let i = 0; i < 20; i++) {
    const x = (i * 137.5) % W, y = (i * 71.3) % H;
    assert.equal(veg.warmthOffsetAt(x, y), 0, "a fresh field gives no warmth nudge");
    assert.equal(veg.wetnessOffsetAt(x, y), 0, "a fresh field gives no wetness nudge");
  }
  veg.rebuild([]);
  for (let i = 0; i < 20; i++) {
    const x = (i * 53.7) % W, y = (i * 97.1) % H;
    assert.equal(veg.warmthOffsetAt(x, y), 0, "an empty larder gives no warmth nudge");
    assert.equal(veg.wetnessOffsetAt(x, y), 0, "an empty larder gives no wetness nudge");
  }
}

// --- Determinism: rebuild is a pure function of the food set — same food twice
//     gives the same field, and the row count follows the world aspect ratio. ---
{
  const food = [...clump(200, 200, 0, 30), ...clump(900, 600, 1, 30)];
  const a = new VegetationField(W, H);
  const b = new VegetationField(W, H);
  a.rebuild(food);
  b.rebuild(food.slice()); // a copy: still the same contents
  for (let i = 0; i < 40; i++) {
    const x = (i * 31.1) % W, y = (i * 17.7) % H;
    assert.ok(close(a.warmthOffsetAt(x, y), b.warmthOffsetAt(x, y)), "same food → same warmth field");
    assert.ok(close(a.wetnessOffsetAt(x, y), b.wetnessOffsetAt(x, y)), "same food → same wetness field");
  }
  assert.equal(a.rows, Math.max(1, Math.round(a.cols * (H / W))), "rows follow the aspect ratio");
}

// --- Bounds: every offset stays strictly within its configured amplitude (tanh
//     can't saturate past ±1), even under a heavy monoculture. ---
{
  const veg = new VegetationField(W, H);
  veg.rebuild(clump(600, 400, 0, 300)); // a huge single-kind stand
  for (let gy = 0; gy < 30; gy++) {
    for (let gx = 0; gx < 30; gx++) {
      const x = (gx / 30) * W, y = (gy / 30) * H;
      const dw = veg.warmthOffsetAt(x, y);
      const dm = veg.wetnessOffsetAt(x, y);
      assert.ok(Math.abs(dw) < ampW + 1e-12, "warmth nudge within ±amplitude");
      assert.ok(Math.abs(dm) < ampM + 1e-12, "wetness nudge within ±amplitude");
    }
  }
}

// --- Kind-aware direction: a sunleaf stand reads warmer & wetter, a moonleaf
//     stand cooler & drier, and the two axes move together (same sign). ---
{
  const veg = new VegetationField(W, H);
  // Equal-sized opposite stands far apart, so the mean lean is ~0 and each reads
  // toward its own kind.
  const sun = { x: 250, y: 200 };
  const moon = { x: 950, y: 600 };
  veg.rebuild([...clump(sun.x, sun.y, 0, 40), ...clump(moon.x, moon.y, 1, 40)]);
  assert.ok(veg.warmthOffsetAt(sun.x, sun.y) > 0.5 * ampW, "a sunleaf stand runs warm");
  assert.ok(veg.wetnessOffsetAt(sun.x, sun.y) > 0.5 * ampM, "a sunleaf stand runs damp");
  assert.ok(veg.warmthOffsetAt(moon.x, moon.y) < -0.5 * ampW, "a moonleaf stand runs cool");
  assert.ok(veg.wetnessOffsetAt(moon.x, moon.y) < -0.5 * ampM, "a moonleaf stand runs dry");
  // The two axes share a sign at every point (one signal scales both).
  for (let i = 0; i < 30; i++) {
    const x = (i * 41.3) % W, y = (i * 67.9) % H;
    const dw = veg.warmthOffsetAt(x, y), dm = veg.wetnessOffsetAt(x, y);
    assert.ok(dw === 0 || dm === 0 || Math.sign(dw) === Math.sign(dm), "warmth and wetness nudges share a sign");
  }
}

// --- Mean-respecting: read relative to the larder's global mean, so the
//     globally dominant kind is penalised on bare ground (a self-balancing pull),
//     and the spatial-average nudge stays ~0. ---
{
  const veg = new VegetationField(W, H);
  // A lopsided larder: lots of sunleaf in one corner, nothing elsewhere. Bare
  // ground far from the stand should read *cooler* (negative), pulling back
  // toward moonleaf where sunleaf globally dominates.
  veg.rebuild(clump(150, 150, 0, 60));
  assert.ok(veg.warmthOffsetAt(150, 150) > 0, "the sunleaf stand itself reads warm");
  assert.ok(veg.warmthOffsetAt(800, 600) < 0, "bare ground reads cool where sunleaf globally dominates");

  // The spatial average of the nudge is ~0 (mean-respecting): sample on a grid.
  let sum = 0, count = 0;
  for (let gy = 0; gy < 24; gy++) {
    for (let gx = 0; gx < 24; gx++) {
      sum += veg.warmthOffsetAt((gx / 24) * W, (gy / 24) * H);
      count++;
    }
  }
  assert.ok(Math.abs(sum / count) < 0.25 * ampW, `the spatial-average nudge is ~0 (got ${(sum / count).toFixed(4)})`);
}

// --- Wiring: World.warmthOffsetAt / wetnessOffsetAt sum the static microclimate
//     and the living vegetation nudge, and fall back to the bare microclimate
//     with no food. ---
{
  const world = new World(makeRng(3), { seed: false });
  // No food yet → vegetation term is 0 → the combined read equals the static one.
  for (let i = 0; i < 20; i++) {
    const x = (i * 91.7) % W, y = (i * 33.1) % H;
    assert.ok(close(world.warmthOffsetAt(x, y), world.microclimate.warmthOffsetAt(x, y)), "no food → combined warmth == microclimate");
    assert.ok(close(world.wetnessOffsetAt(x, y), world.microclimate.wetnessOffsetAt(x, y)), "no food → combined wetness == microclimate");
  }
  // Plant a sunleaf stand and rebuild the field: the combined read now differs
  // from the static one by exactly the vegetation nudge.
  world.vegetation.rebuild(clump(400, 300, 0, 40));
  const x = 400, y = 300;
  assert.ok(
    close(world.warmthOffsetAt(x, y), world.microclimate.warmthOffsetAt(x, y) + world.vegetation.warmthOffsetAt(x, y)),
    "combined warmth is microclimate + vegetation",
  );
  assert.ok(world.vegetation.warmthOffsetAt(x, y) > 0, "the stand adds a real (positive) warmth nudge");
}

// --- The feedback can be switched off: zero amplitudes make the vegetation term
//     vanish, so the world reads exactly as the bare microclimate even with a
//     standing larder. ---
{
  const world = new World(makeRng(8), { seed: false });
  world.vegetation.warmthAmp = 0;
  world.vegetation.wetnessAmp = 0;
  world.vegetation.rebuild(clump(500, 400, 1, 50));
  for (let i = 0; i < 20; i++) {
    const x = (i * 47.3) % W, y = (i * 29.7) % H;
    assert.ok(close(world.warmthOffsetAt(x, y), world.microclimate.warmthOffsetAt(x, y)), "amp 0 → combined warmth == microclimate");
    assert.ok(close(world.wetnessOffsetAt(x, y), world.microclimate.wetnessOffsetAt(x, y)), "amp 0 → combined wetness == microclimate");
  }
}

// --- update() rebuilds the field from the live larder: after stepping a seeded
//     world, the vegetation field is no longer flat (the larder has shaped it). ---
{
  const world = new World(makeRng(2026));
  for (let i = 0; i < 30; i++) world.update(1 / 60);
  let anyNudge = false;
  for (let gy = 0; gy < 20 && !anyNudge; gy++) {
    for (let gx = 0; gx < 20; gx++) {
      if (Math.abs(world.vegetation.warmthOffsetAt((gx / 20) * W, (gy / 20) * H)) > 1e-6) {
        anyNudge = true;
        break;
      }
    }
  }
  assert.ok(anyNudge, "a stepped, stocked world has a non-flat vegetation field");
}

// --- No new serialized state: the snapshot still carries SAVE_VERSION 11 and no
//     vegetation field, and a restored world replays bit-for-bit — the feedback
//     rebuilds identically from the restored larder. ---
{
  const world = new World(makeRng(31));
  for (let i = 0; i < 200; i++) world.update(1 / 60);
  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.equal(blob.version, 13, "save version covers the heritable canopy gene");
  assert.equal(blob.vegetation, undefined, "the vegetation field is not serialized (it's recomputed)");

  const restored = World.deserialize(blob, makeRng());
  for (let i = 0; i < 200; i++) {
    world.update(1 / 60);
    restored.update(1 / 60);
  }
  // The larder (positions and kinds) — grown through the feedback on both — must
  // match pellet-for-pellet.
  assert.deepEqual(
    restored.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind, Math.round(f.canopyAmp * 1e6)]),
    world.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind, Math.round(f.canopyAmp * 1e6)]),
    "the larder (positions, kinds, and canopy genes) replays bit-identically across save/load",
  );
  assert.equal(world.creatures.length, restored.creatures.length, "the population replays identically too");
  // And the rebuilt vegetation fields agree sample-for-sample.
  for (let i = 0; i < 20; i++) {
    const x = (i * 61.7) % W, y = (i * 23.3) % H;
    assert.ok(close(world.warmthOffsetAt(x, y), restored.warmthOffsetAt(x, y)), "combined climate replays identically");
  }
}

console.log("VEGETATION TEST PASSED");
