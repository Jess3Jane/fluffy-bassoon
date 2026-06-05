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
import {
  plantKindAt,
  kindYieldFactor,
  kindRhythm,
  kindClimateRhythm,
  kindLabel,
} from "../src/plants.js";
import { daylight } from "../src/daycycle.js";
import { seasonLevel, weatherNoise } from "../src/weather.js";

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

// --- The two kinds peak in opposite halves of the *daily* cycle: kind 0
//     (sunleaf) by day, kind 1 (moonleaf) by night. Tested on the daily rhythm
//     directly (isolated from the slow climate axis), since that opposite-phase
//     trade-off is the whole point — which forage specialism pays shifts with the
//     clock.
{
  assert.ok(
    kindRhythm(0, noon) > kindRhythm(0, midnight),
    "the day-lit kind's daily rhythm is higher at noon than at midnight",
  );
  assert.ok(
    kindRhythm(1, midnight) > kindRhythm(1, noon),
    "the night kind's daily rhythm is higher at midnight than at noon",
  );
  // At noon the day kind leads on the daily axis; at midnight it reverses — so a
  // specialist's fortunes genuinely cross over the cycle rather than one kind
  // simply dominating always.
  assert.ok(kindRhythm(0, noon) > kindRhythm(1, noon), "day kind's daily rhythm leads at noon");
  assert.ok(kindRhythm(1, midnight) > kindRhythm(0, midnight), "night kind's daily rhythm leads at midnight");
  // The daily curve inherits the daylight curve's smooth shoulders (no hard
  // switch): the dawn/dusk quarter sits strictly between the day and night
  // extremes.
  const dusk = period / 4;
  assert.ok(close(daylight(dusk), 0.5), "sanity: quarter point is half-lit");
  for (const kind of [0, 1]) {
    const hi = Math.max(kindRhythm(kind, noon), kindRhythm(kind, midnight));
    const lo = Math.min(kindRhythm(kind, noon), kindRhythm(kind, midnight));
    const mid = kindRhythm(kind, dusk);
    assert.ok(mid > lo && mid < hi, `kind ${kind} daily rhythm is intermediate at dusk`);
  }
}

// --- kindYieldFactor is richness × daily rhythm × climate rhythm, and a pure
//     function of time.
{
  for (const kind of [0, 1]) {
    const energy = CONFIG.food.kindTraits[kind].energy;
    for (let t = 0; t <= period * 2; t += period / 13) {
      assert.ok(
        close(kindYieldFactor(kind, t), energy * kindRhythm(kind, t) * kindClimateRhythm(kind, t)),
        `kind ${kind} factor is energy × daily × climate at t=${t}`,
      );
    }
  }
  // Pure in time: same time → same value, regardless of anything else.
  assert.ok(close(kindYieldFactor(1, 7.5), kindYieldFactor(1, 7.5)), "pure function of time");
}

// --- kindClimateRhythm: the slow season × weather tilt. The two kinds lean
//     opposite ways (sunleaf → summer rain, moonleaf → winter drought), so on the
//     climate axis their fortunes cross over with the seasons just as they do
//     with the hour. Each tilt is centred (a boost in the preferred climate, an
//     equal thinning in the other) and averages to ~1 over a year, so the larder
//     isn't made leaner long-run.
{
  const seasonYear = CONFIG.weather.seasonSeconds;
  const wPeriod = CONFIG.weather.periodSeconds;
  const midsummer = 0; // seasonLevel ≈ 1
  const midwinter = seasonYear / 2; // seasonLevel ≈ 0
  assert.ok(close(seasonLevel(midsummer), 1, 1e-6), "sanity: midsummer is peak warmth");
  assert.ok(close(seasonLevel(midwinter), 0, 1e-6), "sanity: midwinter is trough warmth");

  // The weather noise isn't periodic, so isolate the season axis by averaging the
  // climate rhythm over a window several weather periods wide centred on each
  // solstice: the weather tilt averages out (it's mean-symmetric) and the season
  // tilt remains, since the season barely moves over so short a window.
  const seasonMean = (kind, centre) => {
    let sum = 0;
    let n = 0;
    for (let t = centre - 3 * wPeriod; t <= centre + 3 * wPeriod; t += wPeriod / 40) {
      sum += kindClimateRhythm(kind, t);
      n++;
    }
    return sum / n;
  };
  const sunSummer = seasonMean(0, midsummer);
  const sunWinter = seasonMean(0, midwinter);
  const moonSummer = seasonMean(1, midsummer);
  const moonWinter = seasonMean(1, midwinter);
  assert.ok(sunSummer > sunWinter, "sunleaf's climate yield is richer (on average) in summer than winter");
  assert.ok(moonWinter > moonSummer, "moonleaf's climate yield is richer (on average) in winter than summer");
  // The two kinds cross over across the year: sunleaf leads the seasonal average
  // in summer, moonleaf in winter.
  assert.ok(sunSummer > moonSummer, "sunleaf leads the seasonal average in summer");
  assert.ok(moonWinter > sunWinter, "moonleaf leads the seasonal average in winter");

  // Weather also bites within a season: holding the season ~fixed (a short span
  // near an equinox where warmth ≈ 0.5), the rain-leaning sunleaf out-yields the
  // drought-leaning moonleaf in the wettest sampled spell and under-yields it in
  // the driest.
  const equinox = seasonYear / 4; // seasonLevel ≈ 0.5
  assert.ok(close(seasonLevel(equinox), 0.5, 1e-6), "sanity: quarter-year is mid warmth");
  let wettest = equinox;
  let driest = equinox;
  for (let t = equinox; t <= equinox + 10 * wPeriod; t += wPeriod / 30) {
    if (weatherNoise(t) > weatherNoise(wettest)) wettest = t;
    if (weatherNoise(t) < weatherNoise(driest)) driest = t;
  }
  assert.ok(
    kindClimateRhythm(0, wettest) > kindClimateRhythm(1, wettest),
    "the rain-leaning sunleaf out-yields the drought-leaning moonleaf in the wettest spell",
  );
  assert.ok(
    kindClimateRhythm(1, driest) > kindClimateRhythm(0, driest),
    "the drought-leaning moonleaf out-yields the rain-leaning sunleaf in the driest spell",
  );

  // Centred: averaged densely over a full year (both season and weather sweeping
  // through their ranges many times), each kind's climate rhythm sits near 1, so
  // the long-run larder is unchanged.
  for (const kind of [0, 1]) {
    let sum = 0;
    let n = 0;
    for (let t = 0; t < seasonYear; t += seasonYear / 4000) {
      sum += kindClimateRhythm(kind, t);
      n++;
    }
    const mean = sum / n;
    assert.ok(Math.abs(mean - 1) < 0.04, `kind ${kind} climate rhythm averages ~1 over a year (${mean})`);
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
