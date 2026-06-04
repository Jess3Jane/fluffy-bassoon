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
// own daily rhythm (which half of the cycle it grows richest in). A "sunleaf"
// (kind 0) is lean but dependable and pays best by day; a "moonleaf" (kind 1) is
// rich but fickle and pays best by night. So which forage specialism wins shifts
// with the clock — a clade must track the cycle, or hedge as a generalist for a
// steadier but convex-discounted return, instead of settling on either band for
// good. Like the day-night cycle these are pure functions of sim-time (plus the
// pellet's kind/position), so they add no serialized state, stay bit-identical
// across save/load, and read the same at any playback speed.

import { CONFIG } from "./config.js";
import { daylight } from "./daycycle.js";

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
// now — the two halves of each kind's traits combined: its static `energy`
// richness times a `temporal` factor that rides the day-night cycle. A kind is
// "in phase" when the cycle is in its preferred half (day for a `dayLit` kind,
// night otherwise); in phase the temporal factor is 1, and out of phase it dips
// toward `1 − rhythmDepth` (a deep-rhythm kind becoming nearly worthless at the
// wrong hour). The alignment is the daylight level itself (or its complement),
// so it inherits the raised-cosine's smooth dawn/dusk shoulders rather than
// switching hard. Multiplied into a grazer's yield in `World.forageNear`, so it
// scales *how much energy* a plant is worth without touching *whether* a forager
// will eat it (that stays the time-independent `forageYield` specialism gate) —
// a specialist still works its own kind at the lean hour, just for less.
export function kindYieldFactor(kind, time) {
  return CONFIG.food.kindTraits[kind === 1 ? 1 : 0].energy * kindRhythm(kind, time);
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

// Short HUD label for a plant kind, matched to its renderer colour (kind 0 the
// green "sunleaf", kind 1 the violet "moonleaf").
const KIND_LABELS = ["Sun", "Moon"];
export function kindLabel(kind) {
  return KIND_LABELS[kind === 1 ? 1 : 0];
}
