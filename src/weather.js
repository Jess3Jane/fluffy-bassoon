// Weather & seasons: two slow rhythms layered over the day-night cycle that
// modulate how fast food regrows, driving longer-period boom/bust dynamics than
// a single day can. Like the day-night cycle, *everything here is a pure
// function of elapsed sim-time* — seasons are a slow cosine and weather is
// deterministic value-noise sampled at the clock — so neither adds serialized
// state, both stay bit-identical across save/load, and they read the same at any
// playback speed.
//
//   * Seasons swing slowly across a "year" many days long: rich summers, lean
//     winters, with autumn cooling and spring warming in between.
//   * Weather flickers faster on top — rain spells boost food, droughts thin it —
//     so within any season the larder still has its good weeks and bad weeks.

import { CONFIG } from "./config.js";

// --- Seasons -------------------------------------------------------------

// Year position in [0, 1): 0 = peak summer (the world starts at midsummer),
// 0.5 = deep winter, wrapping back to summer. Written to stay correct even for a
// negative time, matching dayPhase.
export function seasonPhase(time) {
  const period = CONFIG.weather.seasonSeconds;
  return (((time % period) + period) % period) / period;
}

// Seasonal warmth in [0, 1]: a raised cosine peaking at midsummer (phase 0) and
// bottoming at midwinter (phase 0.5), with gentle autumn/spring shoulders.
export function seasonLevel(time) {
  return (1 + Math.cos(2 * Math.PI * seasonPhase(time))) / 2;
}

// Food multiplier from the season alone: summer ×(1 + amplitude), winter
// ×(1 − amplitude), centred on 1 at the equinox shoulders.
export function seasonFactor(time) {
  const a = CONFIG.weather.seasonAmplitude;
  return 1 + a * (2 * seasonLevel(time) - 1);
}

// A human-readable season name for the HUD. Summer and Winter are the warm/cold
// plateaus; the transitions are Autumn (cooling) and Spring (warming), told
// apart by which half of the year we're in.
export function seasonLabel(time) {
  const level = seasonLevel(time);
  if (level > 0.75) return "Summer";
  if (level < 0.25) return "Winter";
  // Warmth falls over the first half of the year (summer → winter), then rises.
  return seasonPhase(time) < 0.5 ? "Autumn" : "Spring";
}

// --- Weather -------------------------------------------------------------

// Deterministic hash of an integer into [0, 1). Bit-mixing scatters adjacent
// integers, so each value-noise lattice point gets an unrelated value.
function hashInt(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

// Smooth 1-D value noise at a continuous coordinate: interpolate between hashed
// lattice points with a smoothstep so the signal has no creases. Result [0, 1).
function valueNoise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hashInt(i);
  const b = hashInt(i + 1);
  return a + (b - a) * u;
}

// Weather signal in [-1, 1]: positive is wet (rain), negative is dry (drought),
// zero is fair. Two octaves — a slow base swing plus a faster ripple — give the
// weather some texture without ever leaving [-1, 1]. The second octave is offset
// into a different part of the lattice so it doesn't echo the first.
export function weatherNoise(time) {
  const x = time / CONFIG.weather.periodSeconds;
  const base = valueNoise1(x) * 2 - 1;
  const detail = valueNoise1(x * 2.7 + 100) * 2 - 1;
  return base * 0.7 + detail * 0.3;
}

// Food multiplier from the weather alone: rain pushes it above 1, drought below.
export function weatherFactor(time) {
  return 1 + CONFIG.weather.amplitude * weatherNoise(time);
}

// A human-readable weather name for the HUD, graded from drought to storm.
export function weatherLabel(time) {
  const n = weatherNoise(time);
  if (n > 0.55) return "Storm";
  if (n > 0.15) return "Rain";
  if (n < -0.55) return "Drought";
  if (n < -0.15) return "Dry";
  return "Clear";
}

// --- Behavioural effects -------------------------------------------------
//
// Weather reaches past the larder into how creatures move and sense. Only the
// *wet* half of the signal bites: rain and storms. Drought is the dry, still
// opposite — clear air to see through and calm air to steer in — so the two
// extremes trade off against each other (rain feeds the world but fogs and
// jostles it; drought starves it but leaves it legible). Both stay pure
// functions of sim-time, so they add no serialized state and replay identically.

// How wet it is right now, in [0, 1]: the positive (rain) side of the weather
// signal, with dry/fair weather reading as 0. The behavioural effects below all
// scale off this.
function wetness(time) {
  return Math.max(0, weatherNoise(time));
}

// Multiplier on a creature's sense range for the current weather, in
// [senseFloor, 1]. Clear and dry air sees the full distance (1); rain dims sight
// toward `senseFloor` at the height of a downpour, so food and prey are harder
// to spot through the rain even as the rain grows more of it.
export function weatherSenseFactor(time) {
  return 1 - (1 - CONFIG.weather.senseFloor) * wetness(time);
}

// Storm wind strength in [0, 1]: zero in calm, dry, or only-lightly-wet weather,
// then ramping up once the rain passes `windOnset` and building to a full gale
// at the peak of a storm. Drives the heading buffeting a creature feels.
export function windStrength(time) {
  const onset = CONFIG.weather.windOnset;
  const wet = wetness(time);
  if (wet <= onset) return 0;
  return (wet - onset) / (1 - onset);
}

// --- Combined ------------------------------------------------------------

// The combined season × weather multiplier on food growth, floored so it never
// stops the larder entirely. This rides on top of the day-night cycle's own
// `foodGrowthFactor`, so the full food spawn rate is the product of the two.
export function climateFoodFactor(time) {
  const f = seasonFactor(time) * weatherFactor(time);
  return Math.max(CONFIG.weather.foodFloor, f);
}
