// The day-night cycle: a smooth daylight level that rises and falls on a fixed
// period of sim-time. It modulates food growth (plants photosynthesise in the
// light, so the world greens up by day and starves a little by night) and tints
// the renderer. Everything here is a *pure function of elapsed sim-time*, so it
// needs no extra serialized state and stays bit-identical across save/load and
// at any playback speed.

import { CONFIG } from "./config.js";

// Cycle position in [0, 1): 0 = noon (the world starts at midday), 0.5 =
// midnight, wrapping back to noon. Sim-time can only ever grow, but the modulo
// is written to stay correct even if a caller passes a negative time.
export function dayPhase(time) {
  const period = CONFIG.dayNight.periodSeconds;
  return (((time % period) + period) % period) / period;
}

// Daylight level in [0, 1]: a raised cosine, so it peaks smoothly at noon
// (phase 0) and bottoms out at midnight (phase 0.5), with gentle dawn/dusk
// shoulders in between rather than a hard switch.
export function daylight(time) {
  return (1 + Math.cos(2 * Math.PI * dayPhase(time))) / 2;
}

// Multiplier on the food spawn rate for the current moment. Food grows at full
// rate at noon and tapers toward `nightFoodGrowth` of that at midnight — never
// to zero, so a long night slows the larder without guaranteeing a die-off.
export function foodGrowthFactor(time) {
  const floor = CONFIG.dayNight.nightFoodGrowth;
  return floor + (1 - floor) * daylight(time);
}

// A human-readable name for the current part of the cycle, for the HUD. Day and
// Night are the bright/dark plateaus; the transitions are Dawn (brightening) and
// Dusk (dimming), told apart by which half of the cycle we're in.
export function phaseLabel(time) {
  const light = daylight(time);
  if (light > 0.85) return "Day";
  if (light < 0.15) return "Night";
  // Daylight is rising over the back half of the cycle (midnight → noon).
  return dayPhase(time) > 0.5 ? "Dawn" : "Dusk";
}
