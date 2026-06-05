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

// --- Climate axes (for tolerance selection) ------------------------------
//
// The season and weather each define an axis the animals can adapt *to*, not
// just feed off — warmth (the season) and wetness (the weather) — both folded
// onto [0, 1] so a creature's heritable `warmthPref` / `wetnessPref` genes live
// on the same scale. These are the canonical climate readouts the metabolic
// climate-stress (`genome.climateStress`) reads, so the two slow rhythms select
// on creatures directly and not only through the larder they modulate.

// Current seasonal warmth in [0, 1]: 1 at midsummer, 0 at midwinter — the
// climate-tolerance layer's name for `seasonLevel`.
export function climateWarmth(time) {
  return seasonLevel(time);
}

// Current weather wetness in [0, 1]: 0 in the deepest drought, ~0.5 in fair
// weather, 1 at the height of a storm — the weather noise folded onto the full
// [0, 1] axis. (Distinct from the half-wave `wetness` below, which keeps only
// the wet side for the rain-only behavioural effects; this is the symmetric
// axis a creature's wetness preference is judged against.)
export function climateWetness(time) {
  return (weatherNoise(time) + 1) / 2;
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

// The prevailing wind's *direction* (radians, in world space: 0 points along +x,
// increasing clockwise as +y runs down the screen). Unlike the strength, the
// bearing exists in all weather — it just only *bites* when the wind blows. It
// turns steadily around the compass (one full turn per `windTurnSeconds`), with
// a smooth value-noise wobble layered on so it meanders instead of sweeping at a
// perfectly even rate. Pure in sim-time like the rest of the layer, so it adds
// no saved state and replays identically. The returned angle is unbounded
// (cos/sin consume it directly); use `windBearing` to fold it onto [0, 2π).
export function windDirection(time) {
  const turn = (2 * Math.PI * time) / CONFIG.weather.windTurnSeconds;
  // Sample the wobble noise a few times per full turn so the bearing drifts off
  // the steady sweep and back without ever jumping.
  const wobble =
    (valueNoise1((time * 4) / CONFIG.weather.windTurnSeconds + 50) - 0.5) *
    2 *
    CONFIG.weather.windWobble;
  return turn + wobble;
}

// The wind bearing folded onto [0, 2π), for display.
export function windBearing(time) {
  const a = windDirection(time);
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// A compass label for the direction the wind blows *toward* (its push). With +x
// east and +y south (screen-down), the eight points fall at 45° steps from due
// east at bearing 0.
const COMPASS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
export function windLabel(time) {
  const idx = Math.round(windBearing(time) / (Math.PI / 4)) % 8;
  return COMPASS[idx];
}

// --- Combined ------------------------------------------------------------

// The combined season × weather multiplier on food growth, floored so it never
// stops the larder entirely. This rides on top of the day-night cycle's own
// `foodGrowthFactor`, so the full food spawn rate is the product of the two.
export function climateFoodFactor(time) {
  const f = seasonFactor(time) * weatherFactor(time);
  return Math.max(CONFIG.weather.foodFloor, f);
}
