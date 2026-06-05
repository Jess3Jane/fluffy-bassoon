// Test for the *kin-structured withering* that widens the realised canopy sort: where
// a plant's lineage kin cluster densely (`kinGate`), the wither pressure on a canopy
// *mismatched to its ground* is amplified, so a barren kin stand purifies onto its
// (heavy) local optimum and a benign one onto its (light) optimum. Crucially the lever
// *removes* the mismatched rather than *adding* survival to the matched — so it can't
// bloom barren ground into a food magnet (the failure mode of a shelter bonus) and it
// acts on each plant's own viability (so there is no commons for a cheat to free-ride
// on). Every plant carries a neutral `lineage` tag (counter-minted, no rng).
//
// Covers: that the germination curve (`canopyGermination` / `canopyViability`) is the
// established one, unchanged (the kin structure is in withering, not the curve);
// `World.kinDensityAt` (tagless → 0, same-lineage saturating count, strangers excluded,
// the radius cutoff); lineage inheritance through `spawnFood` (a sprout inherits its
// parent's tag, a pioneer founds a fresh one, the counter advances only on pioneers);
// the withering wiring (a mismatched canopy in a dense kin stand is culled harder than
// the same canopy alone; a well-matched plant is spared however dense its kin; at
// `kinWitherSharpen` 0 the pass is the old one); and the v13 save round-trip. No DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { canopyGermination, canopyViability } from "../src/vegetation.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const C = CONFIG.vegetation.canopy;

// --- The germination curve is the established two-argument one: the kin structure
//     lives in the withering pass, so the curve and viability are untouched. ---
{
  // The curve takes no extra kin argument — a stray third arg is ignored, so the kin
  // structure cannot have leaked into the germination/viability functions.
  for (const h of [0.15, 0.7]) for (let c = 0; c <= 1.0; c += 0.25) {
    assert.ok(close(canopyGermination(c, h, 1), canopyGermination(c, h)), "canopyGermination ignores any third argument");
    assert.ok(close(canopyViability(c, h, 1), canopyViability(c, h)), "canopyViability ignores any third argument");
  }
  // Spot-check the curve still has its interior optimum (the kin work didn't touch it).
  let argmax = 0, peak = -Infinity;
  for (let c = 0; c <= 1.00001; c += 0.01) { const g = canopyGermination(c); if (g > peak) { peak = g; argmax = c; } }
  assert.ok(argmax > 0.01 && argmax < 0.99, "the germination curve still peaks in the interior");
}

// --- kinDensityAt: the local same-lineage density gate, in [0, 1]. ---
{
  const world = new World(makeRng(5), { seed: false });
  const stand = [];
  for (let i = 0; i < C.kinDensityNorm; i++) stand.push({ x: 400 + (i % 4) * 3, y: 300 + ((i * 2) % 5), kind: 0, canopyAmp: 0.6, lineage: 7 });
  world.food = [...stand, { x: 405, y: 302, kind: 1, canopyAmp: 0.1, lineage: 9 }]; // + a stranger
  world.canopyGrid.rebuild(world.food);

  assert.ok(close(world.kinDensityAt(402, 301, 7), 1), "a dense same-lineage stand saturates the gate to 1");
  assert.ok(close(world.kinDensityAt(405, 302, 9), 1 / C.kinDensityNorm), "a stranger reads only its own sparse density");
  assert.equal(world.kinDensityAt(402, 301, undefined), 0, "a tagless plant has no kin gate");
  assert.equal(world.kinDensityAt(402, 301, null), 0, "a null-lineage plant has no kin gate");
  assert.equal(world.kinDensityAt(400 + C.kinDensityRadius + 40, 300, 7), 0, "kin beyond the density radius aren't counted");
  // The gate draws no rng.
  const before = world.rng.getState();
  world.kinDensityAt(402, 301, 7);
  assert.equal(world.rng.getState(), before, "kinDensityAt draws no rng");
}

// --- Lineage inheritance through spawnFood: a sprout takes its parent's tag, a
//     pioneer founds a fresh one, and the counter advances only on pioneer births. ---
{
  const world = new World(makeRng(9), { seed: false });
  world.nextPlantLineage = 100;
  world.food = Array.from({ length: 20 }, (_, i) => ({
    x: 500 + (i % 5) * 4, y: 350 + ((i * 2) % 7), kind: 0, canopyAmp: 0.5, lineage: 42,
  }));
  world.canopyGrid.rebuild(world.food);

  const inside = world.spawnFood(502, 352);
  assert.equal(inside.lineage, 42, "a sprout inside a stand inherits its parent's lineage");
  assert.equal(world.nextPlantLineage, 100, "inheriting a lineage does not advance the counter");

  const pioneer = world.spawnFood(50, 50);
  assert.equal(pioneer.lineage, 100, "a pioneer founds the next lineage tag");
  assert.equal(world.nextPlantLineage, 101, "founding a pioneer advances the counter once");

  for (const f of world.food) assert.equal(typeof f.lineage, "number", "every grown pellet has a lineage tag");
}

// --- Withering wiring: on harsh ground a canopy mismatched to it is culled *harder*
//     inside a dense kin stand than the same canopy alone, a well-matched canopy is
//     spared however dense its kin, and at `kinWitherSharpen` 0 the pass is the old one. ---
{
  // Find a harsh (barren) tile on the default terrain.
  const probe = new World(makeRng(7), { seed: false });
  const t = probe.terrain;
  let harsh = null;
  for (let r = 0; r < t.rows && !harsh; r++) {
    for (let c = 0; c < t.cols; c++) {
      const x = (c + 0.5) * t.tileW, y = (r + 0.5) * t.tileH;
      if (probe.canopyHarshnessAt(x, y) >= 0.6) { harsh = { x, y }; break; }
    }
  }
  assert.ok(harsh, "the seed grows harsh (barren) ground");

  // A light canopy (0.15) is badly mismatched to harsh ground (its optimum is heavy),
  // so it withers — and a *kin stand* of light plants withers it harder than lone
  // light strangers of the same canopy. Pad the larder so withering runs near full
  // strength without adding kin to the strangers.
  const buildWorld = (sharpen) => {
    const w = new World(makeRng(7), { seed: false });
    const saved = CONFIG.vegetation.canopy.kinWitherSharpen;
    CONFIG.vegetation.canopy.kinWitherSharpen = sharpen;
    const kin = [], strangers = [];
    for (let i = 0; i < 80; i++) {
      const k = { x: harsh.x + (i % 9) - 4, y: harsh.y + ((i * 2) % 9) - 4, kind: 0, canopyAmp: 0.15, lineage: 1 };
      const s = { x: harsh.x + (i % 9) - 4, y: harsh.y + ((i * 2) % 9) - 4, kind: 0, canopyAmp: 0.15, lineage: 3000 + i };
      kin.push(k); strangers.push(s); w.food.push(k, s);
    }
    for (let i = 0; i < 200; i++) w.food.push({ x: (i * 37) % w.width, y: (i * 53) % w.height, kind: 0, canopyAmp: 0.5, lineage: 5000 + i });
    for (let i = 0; i < 120; i++) w.update(1 / 30);
    CONFIG.vegetation.canopy.kinWitherSharpen = saved;
    const live = new Set(w.food);
    return {
      kinAlive: kin.filter((f) => live.has(f) && !f.dead).length,
      strAlive: strangers.filter((f) => live.has(f) && !f.dead).length,
    };
  };

  const on = buildWorld(C.kinWitherSharpen);
  assert.ok(
    on.kinAlive < on.strAlive,
    `a mismatched kin stand is culled harder than lone strangers of the same canopy (kin ${on.kinAlive} < strangers ${on.strAlive})`,
  );

  // A well-matched plant (canopy near the harsh optimum) is spared regardless of kin —
  // its viability is ~1, so the amplification has nothing to bite.
  {
    const w = new World(makeRng(7), { seed: false });
    // Optimum on this harsh ground (argmax of the curve there).
    let opt = 0, p = -Infinity;
    const h = w.canopyHarshnessAt(harsh.x, harsh.y);
    for (let c = 0; c <= 1.00001; c += 0.002) { const g = canopyGermination(c, h); if (g > p) { p = g; opt = c; } }
    const kin = [];
    for (let i = 0; i < 80; i++) { const k = { x: harsh.x + (i % 9) - 4, y: harsh.y + ((i * 2) % 9) - 4, kind: 0, canopyAmp: opt, lineage: 1 }; kin.push(k); w.food.push(k); }
    for (let i = 0; i < 200; i++) w.food.push({ x: (i * 37) % w.width, y: (i * 53) % w.height, kind: 0, canopyAmp: 0.5, lineage: 5000 + i });
    for (let i = 0; i < 120; i++) w.update(1 / 30);
    const live = new Set(w.food);
    const alive = kin.filter((f) => live.has(f) && !f.dead).length;
    assert.ok(alive > kin.length * 0.85, `a well-matched kin stand is largely spared (${alive}/${kin.length})`);
  }

  // At sharpen 0 the kin stand and the strangers wither alike (the old pass).
  const off = buildWorld(0);
  assert.ok(
    Math.abs(off.kinAlive - off.strAlive) <= Math.max(6, off.strAlive * 0.25),
    `with sharpen off, kin and strangers wither alike (kin ${off.kinAlive} ≈ strangers ${off.strAlive})`,
  );
}

// --- Save/load: the lineage tag and the counter ride the v13 save, and a restored
//     world replays the larder (tags included) bit-identically. ---
{
  const world = new World(makeRng(31));
  for (let i = 0; i < 600; i++) world.update(1 / 30);
  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.equal(blob.version, 13, "the lineage tag bumps SAVE_VERSION to 13");
  assert.ok(blob.food.every(([, , , , l]) => typeof l === "number"), "every serialized pellet carries a numeric lineage");
  assert.equal(typeof blob.nextPlantLineage, "number", "the lineage counter is saved");

  const restored = World.deserialize(blob, makeRng());
  assert.equal(restored.nextPlantLineage, world.nextPlantLineage, "the lineage counter restores exactly");
  for (let i = 0; i < 400; i++) { world.update(1 / 30); restored.update(1 / 30); }
  assert.deepEqual(
    restored.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind, Math.round(f.canopyAmp * 1e6), f.lineage]),
    world.food.map((f) => [Math.round(f.x * 1e6), Math.round(f.y * 1e6), f.kind, Math.round(f.canopyAmp * 1e6), f.lineage]),
    "the larder (lineage tags included) replays bit-identically across save/load",
  );
}

console.log("CANOPY-KIN TEST PASSED");
