// Plant kinds. There are two (0 and 1), a sub-resource axis grazers partition
// along with the heritable `forage` gene. This module owns everything about how
// the two kinds *differ*:
//
//   • where each sprouts — `plantKindAt`, a pure function of position, so the
//     kinds grow in distinct patches of the map (a spatial niche), and
//   • what each is *worth right now* — `kindYieldFactor`, a pure function of the
//     clock, so the two are no longer a symmetric coin-flip but trade off
//     against the day-night cycle.
//
// The second part is the point: each kind has its own energy richness and its
// own set of rhythms — a fast daily one (which half of the day it grows richest
// in) *and* a slow climate one (which season and weather it thrives in). A
// "sunleaf" (kind 0) is lean but dependable, pays best by day, and thrives in
// summer rain; a "moonleaf" (kind 1) is rich but fickle, pays best by night, and
// thrives in winter drought. The two kinds pull opposite ways on every axis, so
// which forage specialism wins crosses over with the hour, the season, *and* the
// weather — a clade must track all of them, or hedge as a generalist for a
// steadier but convex-discounted return, instead of settling on either band for
// good. Like the day-night cycle these are pure functions of sim-time (plus the
// pellet's kind/position), so they add no serialized state, stay bit-identical
// across save/load, and read the same at any playback speed.

import { CONFIG } from "./config.js";
import { daylight } from "./daycycle.js";
import { seasonLevel, weatherNoise } from "./weather.js";

// Which of the two plant kinds (0 or 1) sprouts at a point. Two offset sine
// bands carve the world into smooth ~quarter-size patches of each kind, so the
// species grow in distinct regions — a spatial sub-resource axis a forager clade
// can specialise on and follow into its own patches. A pure function of position
// (drawing no rng), so it's both deterministic across save/load and free of any
// perturbation to the simulation's random stream. The split is ~50/50 by area.
export function plantKindAt(x, y) {
  return Math.sin(x * 0.012) + Math.sin(y * 0.016) > 0 ? 1 : 0;
}

// The multiplier on the energy a creature extracts from a plant of `kind` right
// now — all three of each kind's rhythms combined: its static `energy` richness,
// times the fast day-night `kindRhythm`, times the slow `kindClimateRhythm`
// (season × weather). A grazer's yield in `World.forageNear` is scaled by this,
// so it sets *how much energy* a plant is worth without touching *whether* a
// forager will eat it (that stays the time-independent `forageYield` specialism
// gate) — a specialist still works its own kind at the lean hour, lean season, or
// lean spell, just for less. Pure in sim-time, so it adds no serialized state.
export function kindYieldFactor(kind, time) {
  const energy = CONFIG.food.kindTraits[kind === 1 ? 1 : 0].energy;
  return energy * kindRhythm(kind, time) * kindClimateRhythm(kind, time);
}

// Just the day-night part of a kind's yield, in [1 − rhythmDepth, 1]: 1 when the
// cycle is in the kind's preferred half, dipping toward its floor in the other.
// Pulled out of `kindYieldFactor` so the renderer can brighten an in-phase patch
// and fade an out-of-phase one without folding in the static richness — the eye
// reads the *rhythm* (sunleaf glowing by day, moonleaf by night) directly.
export function kindRhythm(kind, time) {
  const t = CONFIG.food.kindTraits[kind === 1 ? 1 : 0];
  const align = t.dayLit ? daylight(time) : 1 - daylight(time);
  return 1 - t.rhythmDepth * (1 - align);
}

// The slow climate part of a kind's yield: a season swing times a weather swing,
// each a *centred* tilt around 1 (boost in the kind's own season/weather, equal
// thinning in the other) rather than the daily rhythm's one-sided dip. A kind is
// in its preferred season when warmth (`seasonLevel`, a raised cosine peaking at
// midsummer) aligns with `seasonLit`, and in its preferred weather when the wet
// level (the weather noise mapped to [0, 1]) aligns with `wetLit`. Because warmth
// and the weather noise are both mean-symmetric, each tilt averages to ~1 over a
// year — so this redistributes *when* a kind pays (a slow boom/bust opposite for
// the two kinds, stacked on the daily one) without making the larder leaner in
// the long run. Pure in sim-time, inheriting the smooth season/weather curves.
export function kindClimateRhythm(kind, time) {
  const t = CONFIG.food.kindTraits[kind === 1 ? 1 : 0];
  const warmth = seasonLevel(time); // [0, 1], 1 at midsummer
  const wet = (weatherNoise(time) + 1) / 2; // [0, 1], 1 at the height of a storm
  const seasonAlign = t.seasonLit ? warmth : 1 - warmth;
  const wetAlign = t.wetLit ? wet : 1 - wet;
  const season = 1 + (t.seasonTilt ?? 0) * (2 * seasonAlign - 1);
  const weather = 1 + (t.wetTilt ?? 0) * (2 * wetAlign - 1);
  return season * weather;
}

// Short HUD label for a plant kind, matched to its renderer colour (kind 0 the
// green "sunleaf", kind 1 the violet "moonleaf").
const KIND_LABELS = ["Sun", "Moon"];
export function kindLabel(kind) {
  return KIND_LABELS[kind === 1 ? 1 : 0];
}
