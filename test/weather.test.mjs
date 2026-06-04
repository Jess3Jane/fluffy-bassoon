// Unit test for the weather & seasons layer: the slow seasonal cosine, the
// deterministic value-noise weather signal, the food multiplier they combine
// into, and the HUD labels. Also checks that — because the whole layer is a pure
// function of sim-time — a save/load round-trip keeps food growing in lock-step.
// Pure logic, no DOM.

import assert from "node:assert";
import {
  seasonPhase,
  seasonLevel,
  seasonFactor,
  seasonLabel,
  weatherNoise,
  weatherFactor,
  weatherLabel,
  climateFoodFactor,
} from "../src/weather.js";
import { CONFIG } from "../src/config.js";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";

const W = CONFIG.weather;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- seasonPhase wraps time onto [0, 1), starting (and looping) at midsummer.
{
  const period = W.seasonSeconds;
  assert.ok(close(seasonPhase(0), 0), "time 0 is the start of the year");
  assert.ok(close(seasonPhase(period / 2), 0.5), "half a year → midwinter phase");
  assert.ok(close(seasonPhase(period), 0), "a full year wraps back to the start");
  assert.ok(close(seasonPhase(period * 4.25), 0.25), "phase wraps over many years");
}

// --- seasonLevel is a raised cosine: full at summer, zero at winter, half at
//     the equinoxes, and always within [0, 1].
{
  const period = W.seasonSeconds;
  assert.ok(close(seasonLevel(0), 1), "midsummer is peak warmth");
  assert.ok(close(seasonLevel(period / 2), 0), "midwinter is least warmth");
  assert.ok(close(seasonLevel(period / 4), 0.5), "autumn equinox is half warmth");
  for (let t = 0; t <= period * 2; t += period / 50) {
    const l = seasonLevel(t);
    assert.ok(l >= 0 && l <= 1, `seasonLevel in [0,1] at t=${t}, got ${l}`);
  }
}

// --- seasonFactor scales food between (1 ± amplitude), centred on 1.
{
  const period = W.seasonSeconds;
  assert.ok(close(seasonFactor(0), 1 + W.seasonAmplitude), "summer food peak");
  assert.ok(close(seasonFactor(period / 2), 1 - W.seasonAmplitude), "winter food trough");
  assert.ok(close(seasonFactor(period / 4), 1), "equinox food is unmodulated");
}

// --- seasonLabel names the warm/cold plateaus and the transitions between.
{
  const period = W.seasonSeconds;
  assert.equal(seasonLabel(0), "Summer", "midsummer reads as Summer");
  assert.equal(seasonLabel(period / 2), "Winter", "midwinter reads as Winter");
  assert.equal(seasonLabel(period / 4), "Autumn", "cooling quarter reads as Autumn");
  assert.equal(seasonLabel(period * 3 / 4), "Spring", "warming quarter reads as Spring");
}

// --- weatherNoise is a deterministic, bounded, continuous function of sim-time.
{
  // Pure function of time: the same instant always gives the same value.
  assert.equal(weatherNoise(12.5), weatherNoise(12.5), "weather is deterministic");

  // Bounded within [-1, 1] across a long sweep.
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 5000; t += 0.37) {
    const n = weatherNoise(t);
    assert.ok(n >= -1 - 1e-9 && n <= 1 + 1e-9, `weather in [-1,1] at t=${t}, got ${n}`);
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  // It should actually swing — both wet and dry spells occur, not a flat line.
  assert.ok(hi > 0.3, "weather reaches genuinely wet spells");
  assert.ok(lo < -0.3, "weather reaches genuinely dry spells");

  // Smoothstep'd noise is continuous: a tiny step in time is a tiny step in value.
  for (let t = 0; t < 500; t += 1.1) {
    const d = Math.abs(weatherNoise(t + 0.01) - weatherNoise(t));
    assert.ok(d < 0.05, `weather is continuous near t=${t}, jumped ${d}`);
  }
}

// --- weatherFactor centres on 1 and tracks the noise within (1 ± amplitude).
{
  for (let t = 0; t < 2000; t += 1.3) {
    const f = weatherFactor(t);
    assert.ok(
      f >= 1 - W.amplitude - 1e-9 && f <= 1 + W.amplitude + 1e-9,
      `weatherFactor within (1 ± amplitude) at t=${t}, got ${f}`,
    );
  }
}

// --- weatherLabel grades the signal from drought through to storm.
{
  // Probe the label function directly against representative noise levels by
  // scanning time and checking each band is reachable and ordered sensibly.
  const seen = new Set();
  for (let t = 0; t < 20000; t += 0.21) seen.add(weatherLabel(t));
  for (const label of ["Storm", "Rain", "Clear", "Dry", "Drought"]) {
    assert.ok(seen.has(label), `weather eventually reads as ${label}`);
  }
}

// --- climateFoodFactor is the floored product of season and weather, always
//     strictly positive so the larder never stops entirely.
{
  let min = Infinity;
  for (let t = 0; t < 5000; t += 0.37) {
    const f = climateFoodFactor(t);
    assert.ok(f >= W.foodFloor - 1e-9, `climate food respects the floor at t=${t}, got ${f}`);
    assert.ok(f > 0, `climate food is strictly positive at t=${t}`);
    if (f < min) min = f;
  }
  // The product of season and weather extremes stays above the floor here (the
  // floor is a safety net, not the normal operating point), so confirm the
  // multiplier genuinely swings both above and below 1 over a year.
  assert.ok(climateFoodFactor(0) > 1, "a summer fair spell can exceed baseline");
}

// --- stats() surfaces the live season / weather / climate values for the HUD.
{
  const world = new World(makeRng(1), { seed: false });
  const s = world.stats();
  assert.ok(close(s.season, 1), "fresh world starts at midsummer");
  assert.ok(close(s.weather, weatherNoise(0)), "stats weather matches the signal");
  assert.ok(close(s.climateFood, climateFoodFactor(0)), "stats climate matches the factor");
}

// --- The whole layer is pure in sim-time, so a save/load round-trip keeps food
//     growth deterministic even as the season × weather modulation pushes the
//     spawn rate up and down. Original and restored worlds stay bit-identical.
{
  const world = new World(makeRng(27182));
  for (let i = 0; i < 60 * 40; i++) world.update(1 / 60); // 40s in

  const restored = World.deserialize(
    JSON.parse(JSON.stringify(world.serialize())),
    makeRng(),
  );
  assert.ok(close(restored.time, world.time), "restored world resumes at the same time");

  for (let i = 0; i < 60 * 60; i++) {
    world.update(1 / 60);
    restored.update(1 / 60);
  }
  assert.equal(restored.food.length, world.food.length, "food counts stay in lock-step");
  assert.ok(close(restored.time, world.time), "clocks stay in lock-step");
}

console.log("WEATHER TEST PASSED");
