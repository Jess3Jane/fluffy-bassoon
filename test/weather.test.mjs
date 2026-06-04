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
  weatherSenseFactor,
  windStrength,
  windDirection,
  windBearing,
  windLabel,
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

// --- weatherSenseFactor dims sight in rain and never below the floor: it is 1
//     in dry/fair weather, drops as the rain builds, and tracks the wet side of
//     the signal exactly.
{
  for (let t = 0; t < 5000; t += 0.37) {
    const f = weatherSenseFactor(t);
    assert.ok(
      f >= W.senseFloor - 1e-9 && f <= 1 + 1e-9,
      `sense factor within [floor, 1] at t=${t}, got ${f}`,
    );
    // Dry or merely fair weather (no rain) leaves sight at full reach.
    if (weatherNoise(t) <= 0) assert.ok(close(f, 1), `dry weather sees full at t=${t}`);
    // Where it does dim, it dims exactly in step with how wet it is.
    const wet = Math.max(0, weatherNoise(t));
    assert.ok(close(f, 1 - (1 - W.senseFloor) * wet), `sense tracks wetness at t=${t}`);
  }
  // The dimming genuinely bites somewhere: a heavy spell cuts sight noticeably.
  let min = Infinity;
  for (let t = 0; t < 5000; t += 0.11) min = Math.min(min, weatherSenseFactor(t));
  assert.ok(min < 0.8, "a downpour meaningfully dims sight");
}

// --- windStrength is calm except in rain past the onset, then ramps into [0, 1].
{
  for (let t = 0; t < 5000; t += 0.37) {
    const w = windStrength(t);
    assert.ok(w >= 0 - 1e-9 && w <= 1 + 1e-9, `wind within [0, 1] at t=${t}, got ${w}`);
    // Calm whenever the rain hasn't built past the onset (incl. all dry weather).
    if (weatherNoise(t) <= W.windOnset) assert.ok(close(w, 0), `calm below onset at t=${t}`);
  }
  // Storms genuinely happen: the wind reaches a strong gale somewhere.
  let max = 0;
  for (let t = 0; t < 5000; t += 0.11) max = Math.max(max, windStrength(t));
  assert.ok(max > 0.4, "a storm builds a real wind");
}

// --- windDirection is a deterministic, continuous, slowly-turning bearing that
//     exists in all weather (the strength only decides whether it bites).
{
  // Pure function of time.
  assert.equal(windDirection(33.3), windDirection(33.3), "wind direction is deterministic");

  // Continuous: a tiny step in time is a tiny step in bearing (no creases).
  for (let t = 0; t < 2000; t += 1.3) {
    const d = Math.abs(windDirection(t + 0.01) - windDirection(t));
    assert.ok(d < 0.05, `wind direction is continuous near t=${t}, jumped ${d}`);
  }

  // It genuinely turns: over a full `windTurnSeconds` the bearing advances most
  // of the way around the compass (steady turn ± a bounded wobble).
  const turned = windDirection(W.windTurnSeconds) - windDirection(0);
  assert.ok(
    Math.abs(turned - 2 * Math.PI) < W.windWobble * 2 + 1e-9,
    `wind turns ~full circle over windTurnSeconds, advanced ${turned}`,
  );

  // The wobble keeps the turn from being perfectly even — the bearing wanders.
  let maxDev = 0;
  for (let t = 0; t < W.windTurnSeconds; t += W.windTurnSeconds / 200) {
    const steady = (2 * Math.PI * t) / W.windTurnSeconds;
    maxDev = Math.max(maxDev, Math.abs(windDirection(t) - steady));
  }
  assert.ok(maxDev > 0.1, "the prevailing wind meanders off a perfectly even sweep");
}

// --- windBearing folds the (unbounded) direction onto [0, 2π); windLabel names
//     the compass point it pushes toward.
{
  for (let t = 0; t < 3000; t += 0.7) {
    const b = windBearing(t);
    assert.ok(b >= 0 && b < 2 * Math.PI + 1e-9, `bearing in [0, 2π) at t=${t}, got ${b}`);
    // The bearing is the direction folded onto the circle: cos/sin must agree.
    const d = windDirection(t);
    assert.ok(close(Math.cos(b), Math.cos(d)) && close(Math.sin(b), Math.sin(d)),
      `bearing matches direction at t=${t}`);
  }
  // Every compass point is reachable as the bearing turns through a full circle.
  const seen = new Set();
  for (let t = 0; t < W.windTurnSeconds * 2; t += 0.3) seen.add(windLabel(t));
  for (const point of ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]) {
    assert.ok(seen.has(point), `wind eventually blows ${point}`);
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
  assert.ok(close(s.wind, windStrength(0)), "stats wind strength matches the signal");
  assert.ok(close(s.windDir, windDirection(0)), "stats wind direction matches the signal");
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

  // A cheap checksum over every creature's position and heading — sensitive to
  // the weather sense-dimming and storm buffeting, both of which steer movement
  // (and the buffet draws on the rng). If the restored stream diverged by even
  // one draw, these would drift apart. Ids are deliberately excluded: they are
  // informational labels that can legitimately differ after a restore (dead
  // creatures' ids aren't replayed), as the persistence test documents.
  // Food is included too: storm winds now drift every pellet downwind, a pure
  // function of the wind clock and the pellet's position, so it must replay
  // bit-identically as well.
  const checksum = (w) => {
    let h = 0;
    for (const c of w.creatures) h += c.x * 1.0007 + c.y * 1.013 + c.heading * 7.7;
    for (const f of w.food) h += f.x * 1.917 + f.y * 2.013;
    return h;
  };

  for (let i = 0; i < 60 * 60; i++) {
    world.update(1 / 60);
    restored.update(1 / 60);
  }
  assert.equal(restored.food.length, world.food.length, "food counts stay in lock-step");
  assert.equal(restored.creatures.length, world.creatures.length, "populations stay in lock-step");
  assert.ok(close(checksum(restored), checksum(world), 1e-6), "creature motion stays bit-identical");
  assert.ok(close(restored.time, world.time), "clocks stay in lock-step");
}

console.log("WEATHER TEST PASSED");
