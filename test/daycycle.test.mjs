// Unit test for the day-night cycle: the daylight curve, the food-growth
// modulation it drives, and the HUD phase labels. Also checks that, because the
// whole cycle is a pure function of sim-time, a save/load round-trip keeps food
// growing in lock-step. Pure logic, no DOM.

import assert from "node:assert";
import { dayPhase, daylight, foodGrowthFactor, phaseLabel } from "../src/daycycle.js";
import { CONFIG } from "../src/config.js";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";

const period = CONFIG.dayNight.periodSeconds;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- dayPhase wraps time onto [0, 1), starting (and looping) at noon.
{
  assert.ok(close(dayPhase(0), 0), "time 0 is the start of the cycle");
  assert.ok(close(dayPhase(period / 2), 0.5), "half a period → midnight phase");
  assert.ok(close(dayPhase(period), 0), "a full period wraps back to the start");
  assert.ok(close(dayPhase(period * 3.25), 0.25), "phase wraps over many cycles");
}

// --- daylight is a raised cosine: full at noon, dark at midnight, half at the
//     dawn/dusk quarter points, and always within [0, 1].
{
  assert.ok(close(daylight(0), 1), "noon is full daylight");
  assert.ok(close(daylight(period / 2), 0), "midnight is fully dark");
  assert.ok(close(daylight(period / 4), 0.5), "dusk quarter is half-lit");
  assert.ok(close(daylight(period * 3 / 4), 0.5), "dawn quarter is half-lit");
  for (let t = 0; t <= period * 2; t += period / 50) {
    const l = daylight(t);
    assert.ok(l >= 0 && l <= 1, `daylight in [0,1] at t=${t}, got ${l}`);
  }
}

// --- foodGrowthFactor tracks daylight between the night floor and full (1).
{
  assert.ok(close(foodGrowthFactor(0), 1), "noon grows food at full rate");
  assert.ok(
    close(foodGrowthFactor(period / 2), CONFIG.dayNight.nightFoodGrowth),
    "midnight grows food at the night floor",
  );
  for (let t = 0; t <= period; t += period / 50) {
    const f = foodGrowthFactor(t);
    assert.ok(
      f >= CONFIG.dayNight.nightFoodGrowth - 1e-9 && f <= 1 + 1e-9,
      `growth factor within [floor, 1] at t=${t}, got ${f}`,
    );
  }
}

// --- phaseLabel names the bright/dark plateaus and the transitions between.
{
  assert.equal(phaseLabel(0), "Day", "noon reads as Day");
  assert.equal(phaseLabel(period / 2), "Night", "midnight reads as Night");
  assert.equal(phaseLabel(period / 4), "Dusk", "dimming quarter reads as Dusk");
  assert.equal(phaseLabel(period * 3 / 4), "Dawn", "brightening quarter reads as Dawn");
}

// --- stats() surfaces the live daylight level for the HUD.
{
  const world = new World(makeRng(1), { seed: false });
  assert.ok(close(world.stats().daylight, 1), "fresh world starts at full daylight");
}

// --- The cycle is pure in sim-time, so a save/load round-trip keeps food
//     growth deterministic: original and restored worlds stay identical even as
//     the day-night modulation pushes the spawn rate up and down.
{
  const world = new World(makeRng(31415));
  for (let i = 0; i < 60 * 30; i++) world.update(1 / 60); // 30s in, well past noon

  const restored = World.deserialize(
    JSON.parse(JSON.stringify(world.serialize())),
    makeRng(),
  );
  assert.ok(close(restored.time, world.time), "restored world resumes at the same time");

  for (let i = 0; i < 60 * 30; i++) {
    world.update(1 / 60);
    restored.update(1 / 60);
  }
  assert.equal(restored.food.length, world.food.length, "food counts stay in lock-step");
  assert.ok(close(restored.time, world.time), "clocks stay in lock-step");
}

console.log("DAYCYCLE TEST PASSED");
