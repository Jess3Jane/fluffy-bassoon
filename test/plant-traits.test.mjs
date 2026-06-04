// Unit test for per-kind plant traits: the two plant kinds are no longer a
// symmetric coin-flip but trade off against the day-night cycle. Covers the
// pure-in-time yield factor (`kindYieldFactor` / `kindRhythm` in src/plants.js)
// — its richness × rhythm shape, the opposite day/night peaks of the two kinds,
// and its bounds — the way it flows through `World.forageNear` so a grazer's
// energy intake rises and falls with the clock, the `World.stats()` readout, and
// that being pure-in-time it adds no serialized state (a save/load round-trip
// keeps the yields in lock-step). Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";
import { plantKindAt, kindYieldFactor, kindRhythm, kindLabel } from "../src/plants.js";
import { daylight } from "../src/daycycle.js";

const period = CONFIG.dayNight.periodSeconds;
const noon = 0; // the world starts at noon (full daylight)
const midnight = period / 2; // bottom of the cycle (full dark)
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- plantKindAt is a pure function of position that grows both kinds.
{
  assert.equal(plantKindAt(123, 456), plantKindAt(123, 456), "deterministic in position");
  let saw0 = false;
  let saw1 = false;
  for (let x = 0; x < CONFIG.world.width; x += 37) {
    for (let y = 0; y < CONFIG.world.height; y += 41) {
      const k = plantKindAt(x, y);
      assert.ok(k === 0 || k === 1, "kind is 0 or 1");
      if (k === 0) saw0 = true;
      else saw1 = true;
    }
  }
  assert.ok(saw0 && saw1, "both kinds appear across the map");
}

// --- kindRhythm: in [1 − rhythmDepth, 1], peaking (=1) in the kind's own half
//     of the cycle and bottoming at its floor in the other.
{
  for (const kind of [0, 1]) {
    const { dayLit, rhythmDepth } = CONFIG.food.kindTraits[kind];
    const inPhase = dayLit ? noon : midnight;
    const outPhase = dayLit ? midnight : noon;
    assert.ok(close(kindRhythm(kind, inPhase), 1), `kind ${kind} peaks in its own half`);
    assert.ok(
      close(kindRhythm(kind, outPhase), 1 - rhythmDepth),
      `kind ${kind} bottoms at its rhythm floor in the other half`,
    );
    // Bounds across a whole cycle.
    for (let t = 0; t <= period; t += period / 50) {
      const r = kindRhythm(kind, t);
      assert.ok(r >= 1 - rhythmDepth - 1e-9 && r <= 1 + 1e-9, `kind ${kind} rhythm in band`);
    }
  }
}

// --- The two kinds peak in opposite halves of the cycle: kind 0 (sunleaf) pays
//     best by day, kind 1 (moonleaf) by night. This opposite-phase trade-off is
//     the whole point — which forage specialism pays shifts with the clock.
{
  assert.ok(
    kindYieldFactor(0, noon) > kindYieldFactor(0, midnight),
    "the day-lit kind is worth more at noon than at midnight",
  );
  assert.ok(
    kindYieldFactor(1, midnight) > kindYieldFactor(1, noon),
    "the night kind is worth more at midnight than at noon",
  );
  // At noon the day kind out-pays the night kind; at midnight it reverses — so a
  // specialist's fortunes genuinely cross over the cycle rather than one kind
  // simply dominating always.
  assert.ok(kindYieldFactor(0, noon) > kindYieldFactor(1, noon), "day kind leads at noon");
  assert.ok(kindYieldFactor(1, midnight) > kindYieldFactor(0, midnight), "night kind leads at midnight");
}

// --- kindYieldFactor is richness × rhythm, and a pure function of time.
{
  for (const kind of [0, 1]) {
    const energy = CONFIG.food.kindTraits[kind].energy;
    for (let t = 0; t <= period * 2; t += period / 13) {
      assert.ok(
        close(kindYieldFactor(kind, t), energy * kindRhythm(kind, t)),
        `kind ${kind} factor is energy × rhythm at t=${t}`,
      );
    }
  }
  // Pure in time: same time → same value, regardless of anything else.
  assert.ok(close(kindYieldFactor(1, 7.5), kindYieldFactor(1, 7.5)), "pure function of time");
  // It inherits the daylight curve's smooth shoulders (no hard switch): the
  // dawn/dusk quarter sits strictly between the day and night extremes.
  const dusk = period / 4;
  assert.ok(close(daylight(dusk), 0.5), "sanity: quarter point is half-lit");
  for (const kind of [0, 1]) {
    const hi = Math.max(kindYieldFactor(kind, noon), kindYieldFactor(kind, midnight));
    const lo = Math.min(kindYieldFactor(kind, noon), kindYieldFactor(kind, midnight));
    const mid = kindYieldFactor(kind, dusk);
    assert.ok(mid > lo && mid < hi, `kind ${kind} yield is intermediate at dusk`);
  }
}

// --- forageNear scales the energy gained by the kind's current yield factor, so
//     the same patch is worth more in its kind's own phase. A kind-0 specialist
//     grazing identical kind-0 plants reaps more at noon than at midnight; a
//     kind-1 specialist reaps more at midnight than at noon.
{
  const layout = () => [
    { x: 100, y: 100, kind: 0 },
    { x: 101, y: 100, kind: 0 },
  ];
  const forageOnce = (time, forage, kind) => {
    const world = new World(makeRng(1), { seed: false });
    world.time = time;
    world.food = layout().map((f) => ({ ...f, kind }));
    world.foodGrid.rebuild(world.food);
    return world.forageNear(100, 100, 10, forage).gained;
  };

  const sunDay = forageOnce(noon, 0, 0);
  const sunNight = forageOnce(midnight, 0, 0);
  assert.ok(sunDay > sunNight, "a sunleaf specialist gains more energy by day");

  const moonDay = forageOnce(noon, 1, 1);
  const moonNight = forageOnce(midnight, 1, 1);
  assert.ok(moonNight > moonDay, "a moonleaf specialist gains more energy by night");

  // The gained energy is exactly the per-plant forage yield × the kind factor.
  const expected = 2 * kindYieldFactor(0, noon); // forageYield(0,0) === 1
  assert.ok(close(sunDay, expected), "gained equals Σ forageYield × kindYieldFactor");
}

// --- World.stats() surfaces the live per-kind yield, matching kindYieldFactor.
{
  const world = new World(makeRng(2), { seed: false });
  world.time = period / 3;
  const s = world.stats();
  assert.ok(close(s.kindYield[0], kindYieldFactor(0, world.time)), "stats kindYield[0]");
  assert.ok(close(s.kindYield[1], kindYieldFactor(1, world.time)), "stats kindYield[1]");
}

// --- Being pure in time, the kind traits add NO serialized state: a save/load
//     round-trip restores the same time and so the same yields, with no extra
//     fields slipped into the snapshot.
{
  const world = new World(makeRng(77));
  for (let i = 0; i < 120; i++) world.update(1 / 60);
  const snap = JSON.parse(JSON.stringify(world.serialize()));
  const restored = World.deserialize(snap, makeRng());
  assert.ok(close(restored.time, world.time), "time round-trips");
  for (const kind of [0, 1]) {
    assert.ok(
      close(kindYieldFactor(kind, restored.time), kindYieldFactor(kind, world.time)),
      `kind ${kind} yield matches after load (pure in time, no saved state)`,
    );
  }
  assert.ok(!("kindTraits" in snap), "no per-kind trait state leaks into the save");
}

// --- HUD label sanity.
{
  assert.equal(kindLabel(0), "Sun");
  assert.equal(kindLabel(1), "Moon");
}

console.log("PLANT-TRAITS TEST PASSED");
