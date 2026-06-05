// Unit test for the microclimate: a static, per-region spatial offset to the
// warmth/wetness a creature feels, layered under the global season/weather clock
// so `warmthPref` / `wetnessPref` partition creatures across *space* and not only
// across the year. Covers the pure field (`src/microclimate.js`): determinism
// from the seed, seamless toroidal wrapping, the offsets staying within their
// configured amplitudes, and the two axes being independent geographies. Then the
// wiring: `Creature.update` now taxes a creature against its *local* climate
// (global level + the offset at its position, clamped to [0, 1]); the field
// regrows bit-for-bit from a saved seed (SAVE_VERSION 11); and `World.stats()`
// reports the spatial-sorting correlation. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { Creature } from "../src/creature.js";
import { Microclimate } from "../src/microclimate.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";
import { randomGenome, climateStress } from "../src/genome.js";
import { climateWarmth, climateWetness } from "../src/weather.js";
import { clamp01 } from "../src/math.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = CONFIG.world.width;
const H = CONFIG.world.height;
const ampW = CONFIG.microclimate.warmthAmplitude;
const ampM = CONFIG.microclimate.wetnessAmplitude;

// --- Determinism: the same seed grows the same field; different seeds differ. ---
{
  const a = new Microclimate(W, H, 1234);
  const b = new Microclimate(W, H, 1234);
  const c = new Microclimate(W, H, 5678);
  let anyDiff = false;
  for (let i = 0; i < 50; i++) {
    const x = (i * 137.5) % W;
    const y = (i * 71.3) % H;
    assert.ok(close(a.warmthOffsetAt(x, y), b.warmthOffsetAt(x, y)), "same seed → same warmth offset");
    assert.ok(close(a.wetnessOffsetAt(x, y), b.wetnessOffsetAt(x, y)), "same seed → same wetness offset");
    if (!close(a.warmthOffsetAt(x, y), c.warmthOffsetAt(x, y), 1e-6)) anyDiff = true;
  }
  assert.ok(anyDiff, "a different seed grows a genuinely different field");
}

// --- Bounds: every offset stays within its configured amplitude. ---
{
  const mc = new Microclimate(W, H, 42);
  for (let gy = 0; gy < 40; gy++) {
    for (let gx = 0; gx < 40; gx++) {
      const x = (gx / 40) * W;
      const y = (gy / 40) * H;
      const dw = mc.warmthOffsetAt(x, y);
      const dm = mc.wetnessOffsetAt(x, y);
      assert.ok(dw >= -ampW - 1e-12 && dw <= ampW + 1e-12, "warmth offset within ±amplitude");
      assert.ok(dm >= -ampM - 1e-12 && dm <= ampM + 1e-12, "wetness offset within ±amplitude");
    }
  }
}

// --- The field has real spread (it's not flat) and reaches well toward both
//     extremes, so there genuinely are warm and cool regions to sort along. ---
{
  const mc = new Microclimate(W, H, 7);
  let lo = Infinity, hi = -Infinity;
  for (let gy = 0; gy < 60; gy++) {
    for (let gx = 0; gx < 60; gx++) {
      const v = mc.warmthOffsetAt((gx / 60) * W, (gy / 60) * H);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  assert.ok(hi > 0.3 * ampW, "the field has a genuinely warm region");
  assert.ok(lo < -0.3 * ampW, "the field has a genuinely cool region");
}

// --- Seamless wrapping: the field tiles across the toroidal world, so sampling a
//     point and the same point one world away gives the same offset. ---
{
  const mc = new Microclimate(W, H, 99);
  for (let i = 0; i < 20; i++) {
    const x = (i * 97.1) % W;
    const y = (i * 53.7) % H;
    assert.ok(close(mc.warmthOffsetAt(x, y), mc.warmthOffsetAt(x + W, y), 1e-9), "warmth wraps in x");
    assert.ok(close(mc.warmthOffsetAt(x, y), mc.warmthOffsetAt(x, y + H), 1e-9), "warmth wraps in y");
    assert.ok(close(mc.wetnessOffsetAt(x, y), mc.wetnessOffsetAt(x - W, y + H), 1e-9), "wetness wraps both ways");
  }
}

// --- The two axes are independent geographies: the warm regions aren't simply
//     the wet ones (the fields are drawn from separate lattices). ---
{
  const mc = new Microclimate(W, H, 314);
  let same = 0, total = 0;
  for (let i = 0; i < 200; i++) {
    const x = (i * 41.3) % W;
    const y = (i * 67.9) % H;
    // Compare on a common [-1,1] scale by dividing out each amplitude.
    const dw = mc.warmthOffsetAt(x, y) / ampW;
    const dm = mc.wetnessOffsetAt(x, y) / ampM;
    total++;
    if (close(dw, dm, 1e-6)) same++;
  }
  assert.ok(same < total, "warmth and wetness fields are not identical");
}

// --- Wiring: Creature.update now taxes the creature against its *local* climate.
//     Step one creature (no food, no neighbours) and check its energy fell by
//     exactly the local-climate-taxed metabolism — the climate-tolerance formula,
//     but with the warmth/wetness read at the creature's position. ---
const dt = 1 / 60;
{
  const world = new World(makeRng(9), { seed: false });
  // Give it a real, non-trivial microclimate (the default seed-0 field also has
  // spread, but pin a known seed for clarity).
  world.microclimate = new Microclimate(W, H, 24601);
  const time = 0;
  world.time = time;
  const g = randomGenome(makeRng(123));
  g.diet = 0; // grazer: no hunting; with no food around, no feeding either
  g.alarmVoice = 0;
  g.foodVoice = 0;
  g.warmthPref = 0.2; // deliberately off the local climate so stress > 0
  g.wetnessPref = 0.8;
  const c = new Creature(300, 200, g, world.rng);
  c.energy = 100;
  world.creatures.push(c);
  const x0 = c.x, y0 = c.y;
  world.update(dt);

  // Replicate the cost formula exactly, reading the climate at the *post-move*
  // position (where Creature.update samples it).
  const sizeCost = g.size * g.size;
  const dist = g.speed * dt * world.terrain.speedAt(x0, y0);
  const warmth = clamp01(climateWarmth(time) + world.microclimate.warmthOffsetAt(c.x, c.y));
  const wetness = clamp01(climateWetness(time) + world.microclimate.wetnessOffsetAt(c.x, c.y));
  const stress = climateStress(g.warmthPref, g.wetnessPref, warmth, wetness);
  let cost = CONFIG.creature.baseMetabolism * g.metabolismEff * sizeCost * (1 + CONFIG.creature.climateStressCost * stress);
  cost += dist * CONFIG.creature.moveMetabolism * sizeCost;
  assert.ok(stress > 0, "the test creature is genuinely mismatched to its local climate");
  assert.ok(close(c.energy, 100 - cost * dt, 1e-6), "energy falls by exactly the *local*-climate-taxed metabolism");
}

// --- The local tax differs by position: the same creature pays a different rate
//     in a warm spot than in a cool one (otherwise the spatial axis is inert). ---
{
  const world = new World(makeRng(5), { seed: false });
  const mc = new Microclimate(W, H, 24601);
  world.microclimate = mc;
  world.time = CONFIG.weather.seasonSeconds / 4; // a mid-warmth moment so offsets bite both ways

  // Find a clearly warm and a clearly cool point.
  let warmPt = null, coolPt = null;
  for (let gy = 0; gy < 40 && (!warmPt || !coolPt); gy++) {
    for (let gx = 0; gx < 40; gx++) {
      const x = (gx / 40) * W, y = (gy / 40) * H;
      const v = mc.warmthOffsetAt(x, y);
      if (v > 0.5 * ampW) warmPt = { x, y };
      if (v < -0.5 * ampW) coolPt = { x, y };
    }
  }
  assert.ok(warmPt && coolPt, "found a warm and a cool spot to compare");

  // Identical genome, identical heading seed → identical movement; the only
  // difference is the microclimate at the two spots. A warm-adapted body (high
  // warmthPref) keeps more energy in the warm spot than in the cool one.
  function stepAt(pt) {
    const w = new World(makeRng(5), { seed: false });
    w.microclimate = mc;
    w.time = world.time;
    const g = randomGenome(makeRng(321));
    g.diet = 0; g.alarmVoice = 0; g.foodVoice = 0;
    g.warmthPref = 1; g.wetnessPref = 0.5;
    const cr = new Creature(pt.x, pt.y, g, w.rng);
    cr.energy = 100;
    w.creatures.push(cr);
    w.update(dt);
    return cr.energy;
  }
  assert.ok(stepAt(warmPt) > stepAt(coolPt), "a warm-adapted body keeps more energy in a warm region than a cool one");
}

// --- World.stats() reports the spatial-sorting correlation: positive when
//     warm-adapted creatures sit in warm regions, negative when anti-sorted,
//     null below two creatures. ---
{
  const world = new World(makeRng(2), { seed: false });
  const mc = world.microclimate;
  assert.equal(world.stats().climateSortWarmth, null, "no sorting figure with an empty world");

  // Gather a set of points spanning the warmth range, sorted by their offset.
  const pts = [];
  for (let gx = 0; gx < 24; gx++) {
    const x = (gx / 24) * W, y = (gx * 53) % H;
    pts.push({ x, y, warm: mc.warmthOffsetAt(x, y) });
  }
  pts.sort((a, b) => a.warm - b.warm);

  // Sorted population: warmthPref rises with the local warmth offset → r > 0.
  for (let i = 0; i < pts.length; i++) {
    const cr = world.spawnCreature(pts[i].x, pts[i].y);
    cr.genome.warmthPref = i / (pts.length - 1); // coldest spot → 0, warmest → 1
  }
  const sorted = world.stats().climateSortWarmth;
  assert.ok(sorted != null && sorted > 0.8, `a well-sorted population reads strongly positive (${sorted})`);

  // Anti-sorted: flip every preference so warm-adapted bodies sit in cool spots.
  for (let i = 0; i < world.creatures.length; i++) {
    world.creatures[i].genome.warmthPref = 1 - i / (pts.length - 1);
  }
  const anti = world.stats().climateSortWarmth;
  assert.ok(anti != null && anti < -0.8, `an anti-sorted population reads strongly negative (${anti})`);
}

// --- The microclimate seed rides the v11 save and regrows the field bit-for-bit;
//     a pre-v11 save is rejected; and because the field draws no main rng once
//     grown, a restored world replays bit-identically. ---
{
  const world = new World(makeRng(77));
  for (let i = 0; i < 120; i++) world.update(dt);
  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.equal(blob.version, 11, "snapshot carries SAVE_VERSION 11");
  assert.equal(typeof blob.microclimateSeed, "number", "the microclimate seed is serialized");

  const restored = World.deserialize(blob, makeRng());
  assert.equal(restored.microclimateSeed, world.microclimateSeed, "the seed round-trips");
  // The regrown field samples identically to the original.
  for (let i = 0; i < 30; i++) {
    const x = (i * 91.7) % W, y = (i * 33.1) % H;
    assert.ok(
      close(restored.microclimate.warmthOffsetAt(x, y), world.microclimate.warmthOffsetAt(x, y)),
      "the regrown microclimate matches the original sample-for-sample",
    );
  }

  // Lock-step replay stays bit-identical (the local-climate tax draws no rng).
  const checksum = (w) => {
    let h = 0;
    for (const c of w.creatures) h += c.x * 31 + c.y * 7 + c.energy * 13;
    return h;
  };
  for (let i = 0; i < 60; i++) {
    world.update(dt);
    restored.update(dt);
  }
  assert.ok(close(checksum(world), checksum(restored), 1e-6), "restored world replays bit-identically");

  const stale = JSON.parse(JSON.stringify(world.serialize()));
  stale.version = 10;
  assert.throws(() => World.deserialize(stale, makeRng()), /unsupported save version/, "a pre-v11 save is rejected");
}

console.log("MICROCLIMATE TEST PASSED");
