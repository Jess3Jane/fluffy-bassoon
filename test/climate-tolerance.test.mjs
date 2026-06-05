// Unit test for heritable climate tolerance: the season and weather no longer
// select on creatures only through the larder they grow, but directly, through a
// metabolic tax on how far the current climate has drifted from each creature's
// preferred warmth / wetness. Covers the pure stress curve (`climateStress` in
// src/genome.js), the canonical climate axes it reads (`climateWarmth` /
// `climateWetness` in src/weather.js), the exact wiring into base metabolism in
// `Creature.update`, the cull direction (a summer-adapted body pays more in
// winter, a winter-adapted one more in summer), the `World.stats()` readout, and
// the gene round-tripping through save/load (with a pre-v10 save rejected and the
// deterministic stream — which the stress never touches — still replaying
// bit-identically). Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { Creature } from "../src/creature.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";
import { GENES, climateStress, randomGenome } from "../src/genome.js";
import {
  climateWarmth,
  climateWetness,
  seasonLevel,
  weatherNoise,
} from "../src/weather.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const seasonYear = CONFIG.weather.seasonSeconds;

// --- climateStress is the squared drift of the climate from the preferred
//     point, zero when matched, symmetric in the sign of the drift, monotone in
//     each axis, and capped at 2 at the opposite corner.
{
  assert.ok(close(climateStress(0.5, 0.5, 0.5, 0.5), 0), "matched climate → no stress");
  assert.ok(close(climateStress(0, 0, 1, 1), 2), "perfect anti-adaptation → max stress (2)");

  // Exactly the squared Euclidean drift on the two axes.
  for (const [wp, mp, w, m] of [
    [0.5, 0.5, 0.7, 0.2],
    [0.1, 0.9, 0.4, 0.4],
    [0.3, 0.6, 0.3, 0.6],
  ]) {
    assert.ok(
      close(climateStress(wp, mp, w, m), (w - wp) ** 2 + (m - mp) ** 2),
      "stress equals (Δwarmth)² + (Δwetness)²",
    );
  }

  // Symmetric: drifting the climate the same distance either side of the
  // preferred point costs the same.
  assert.ok(
    close(climateStress(0.5, 0.5, 0.8, 0.5), climateStress(0.5, 0.5, 0.2, 0.5)),
    "stress is symmetric in the sign of the warmth drift",
  );
  assert.ok(
    close(climateStress(0.5, 0.5, 0.5, 0.8), climateStress(0.5, 0.5, 0.5, 0.2)),
    "stress is symmetric in the sign of the wetness drift",
  );

  // Monotone increasing as the climate strays further on either axis.
  let prev = -1;
  for (let d = 0; d <= 0.5; d += 0.05) {
    const s = climateStress(0.5, 0.5, 0.5 + d, 0.5);
    assert.ok(s > prev - 1e-12, "stress rises monotonically with warmth drift");
    prev = s;
  }

  // Convex (squared): doubling the drift quadruples the stress, so a small
  // mismatch is nearly free and the cost climbs steeply only at the extremes.
  const near = climateStress(0.5, 0.5, 0.6, 0.5); // 0.1 off
  const far = climateStress(0.5, 0.5, 0.7, 0.5); // 0.2 off
  assert.ok(close(far / near, 4), "twice the drift is four times the stress (squared)");
}

// --- The climate axes: warmth is the season, wetness the weather noise folded
//     onto [0, 1]. Both stay in range, and warmth peaks at midsummer / bottoms at
//     midwinter (the world starts at midsummer).
{
  for (let t = 0; t <= seasonYear; t += seasonYear / 50) {
    assert.ok(close(climateWarmth(t), seasonLevel(t)), "climateWarmth is seasonLevel");
    assert.ok(close(climateWetness(t), (weatherNoise(t) + 1) / 2), "climateWetness folds the weather noise onto [0,1]");
    const w = climateWarmth(t);
    const m = climateWetness(t);
    assert.ok(w >= 0 && w <= 1, "warmth in [0,1]");
    assert.ok(m >= 0 && m <= 1, "wetness in [0,1]");
  }
  assert.ok(close(climateWarmth(0), 1, 1e-6), "midsummer (t=0) is peak warmth");
  assert.ok(close(climateWarmth(seasonYear / 2), 0, 1e-6), "midwinter is trough warmth");
}

// --- The gene pair joins the genome like any other adaptive gene: randomGenome
//     draws it in range, and it lives in GENES (so it rides mutation, crossover,
//     geneVector, and the save).
{
  assert.ok("warmthPref" in GENES && "wetnessPref" in GENES, "both prefs are adaptive genes");
  for (let seed = 1; seed <= 20; seed++) {
    const g = randomGenome(makeRng(seed));
    assert.ok(g.warmthPref >= 0 && g.warmthPref <= 1, "warmthPref in range");
    assert.ok(g.wetnessPref >= 0 && g.wetnessPref <= 1, "wetnessPref in range");
  }
}

// --- The metabolism wiring is exact. Step one creature in an empty world (no
//     food, no neighbours) and check its energy fell by precisely the documented
//     cost — base × metabolismEff × size² × (1 + climateStressCost·stress), plus
//     the unchanged movement term. `dist` is independent of the heading wander,
//     so the per-step cost is fully determined without simulating the rng.
const dt = 1 / 60;
function stepOne({ warmthPref, wetnessPref, time = 0, seed = 9, genomeSeed = 123 }) {
  const world = new World(makeRng(seed), { seed: false });
  // Neutralise the spatial microclimate so these assertions isolate the *global*
  // climate-tolerance formula — the spatial offset is covered by its own test.
  // Zeroing the amplitudes makes every position read the global level exactly.
  world.microclimate.warmthAmp = 0;
  world.microclimate.wetnessAmp = 0;
  world.time = time;
  const g = randomGenome(makeRng(genomeSeed));
  g.diet = 0; // a grazer: no hunting, and with no food around no feeding either
  g.alarmVoice = 0; // no alarm cries to spend energy on
  g.foodVoice = 0; // no food calls
  g.warmthPref = warmthPref;
  g.wetnessPref = wetnessPref;
  const c = new Creature(300, 200, g, world.rng);
  c.energy = 100; // below reproduceThreshold, above one step's cost
  world.creatures.push(c);
  const before = c.energy;
  const x0 = c.x;
  const y0 = c.y;
  world.update(dt);
  // Replicate the cost formula from Creature.update exactly.
  const sizeCost = g.size * g.size;
  const dist = g.speed * dt * world.terrain.speedAt(x0, y0);
  const stress = climateStress(g.warmthPref, g.wetnessPref, climateWarmth(time), climateWetness(time));
  const factor = 1 + CONFIG.creature.climateStressCost * stress;
  let cost = CONFIG.creature.baseMetabolism * g.metabolismEff * sizeCost * factor;
  cost += dist * CONFIG.creature.moveMetabolism * sizeCost;
  return { c, before, expected: before - cost * dt, stress, sizeCost, g };
}
{
  // A mismatched creature: prefs far from the current climate.
  const r = stepOne({ warmthPref: 0, wetnessPref: 0, time: 0 });
  assert.ok(r.stress > 0, "the test creature is genuinely mismatched");
  assert.ok(close(r.c.energy, r.expected, 1e-6), "energy falls by exactly the climate-taxed metabolism");
  assert.ok(r.c.alive, "and it survives the step");
}

// --- A creature sitting in its preferred climate pays the base rate (factor 1);
//     a mismatched one pays strictly more, and by exactly the documented extra.
{
  const time = 0;
  const warmth = climateWarmth(time);
  const wet = climateWetness(time);
  const matched = stepOne({ warmthPref: warmth, wetnessPref: wet, time });
  const mismatched = stepOne({ warmthPref: 1 - warmth, wetnessPref: 1 - wet, time });
  assert.ok(close(matched.stress, 0), "a creature at the climate point has zero stress");
  assert.ok(mismatched.stress > matched.stress, "the anti-adapted creature is more stressed");
  // Identical genome (bar the prefs) and identical position/seed → identical
  // movement, so the energy gap is purely the climate tax.
  assert.ok(matched.c.energy > mismatched.c.energy, "the matched creature keeps more energy");
  const extra =
    CONFIG.creature.baseMetabolism *
    matched.g.metabolismEff *
    matched.sizeCost *
    CONFIG.creature.climateStressCost *
    mismatched.stress *
    dt;
  assert.ok(
    close(matched.c.energy - mismatched.c.energy, extra, 1e-6),
    "the energy gap equals base × eff × size² × climateStressCost × stress × dt",
  );
}

// --- Cull direction: the climate becomes a selective axis. At midwinter a
//     winter-adapted body is cheaper to run than a summer-adapted one; at
//     midsummer the order reverses — so winters cull the summer-adapted and
//     (warm-season) the cold-adapted, exactly the intended pressure.
{
  const wet = 0.5; // hold wetness neutral so warmth is the only axis in play
  const winterStressOfSummerBody = climateStress(1, 0.5, climateWarmth(seasonYear / 2), wet);
  const winterStressOfWinterBody = climateStress(0, 0.5, climateWarmth(seasonYear / 2), wet);
  assert.ok(
    winterStressOfWinterBody < winterStressOfSummerBody,
    "in deep winter the winter-adapted body is less stressed than the summer-adapted one",
  );
  const summerStressOfSummerBody = climateStress(1, 0.5, climateWarmth(0), wet);
  const summerStressOfWinterBody = climateStress(0, 0.5, climateWarmth(0), wet);
  assert.ok(
    summerStressOfSummerBody < summerStressOfWinterBody,
    "in midsummer the summer-adapted body is less stressed than the winter-adapted one",
  );
}

// --- World.stats() averages the two new prefs across the live population.
{
  const world = new World(makeRng(2), { seed: false });
  const c1 = world.spawnCreature(100, 100);
  c1.genome.warmthPref = 0.2;
  c1.genome.wetnessPref = 0.8;
  const c2 = world.spawnCreature(200, 200);
  c2.genome.warmthPref = 0.6;
  c2.genome.wetnessPref = 0.4;
  const s = world.stats();
  assert.ok(close(s.avg.warmthPref, 0.4), "stats averages warmthPref");
  assert.ok(close(s.avg.wetnessPref, 0.6), "stats averages wetnessPref");
}

// --- The prefs ride the v10 genome snapshot; a pre-v10 save is rejected; and
//     because climate stress draws no rng, a restored world still replays
//     bit-identically (the standard save/load continuation guarantee).
{
  const world = new World(makeRng(77));
  for (let i = 0; i < 120; i++) world.update(dt);
  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.equal(blob.version, 13, "snapshot carries the current SAVE_VERSION");

  const restored = World.deserialize(blob, makeRng());
  assert.deepEqual(
    restored.creatures.map((c) => c.genome.warmthPref),
    world.creatures.map((c) => c.genome.warmthPref),
    "every creature's warmthPref survives a save/load round-trip",
  );
  assert.deepEqual(
    restored.creatures.map((c) => c.genome.wetnessPref),
    world.creatures.map((c) => c.genome.wetnessPref),
    "every creature's wetnessPref survives a save/load round-trip",
  );

  // Step the original and the restored world forward in lock-step: the climate
  // tax never draws rng, so the two stay bit-identical (positions + energies).
  const checksum = (w) => {
    let h = 0;
    for (const c of w.creatures) h += c.x * 31 + c.y * 7 + c.energy * 13 + c.genome.warmthPref;
    return h;
  };
  for (let i = 0; i < 60; i++) {
    world.update(dt);
    restored.update(dt);
  }
  assert.ok(close(checksum(world), checksum(restored), 1e-6), "restored world replays bit-identically");

  const stale = JSON.parse(JSON.stringify(world.serialize()));
  stale.version = 10;
  assert.throws(
    () => World.deserialize(stale, makeRng()),
    /unsupported save version/,
    "a pre-v11 save is rejected rather than loaded with a NaN-offset microclimate",
  );
}

console.log("CLIMATE-TOLERANCE TEST PASSED");
