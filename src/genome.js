// A genome is a small bundle of heritable traits. Each gene has a sensible
// range; mutation nudges values and clamps them back in-bounds. Selection
// acts on these because they directly shape metabolism and behaviour.

import { CONFIG } from "./config.js";

// gene: [min, max] — the legal envelope for each trait.
export const GENES = {
  speed: [10, 90], // max travel speed (units/second)
  turnRate: [1.0, 7.0], // how fast it can change heading (radians/second)
  sense: [40, CONFIG.creature.senseRadius], // perception radius
  size: [0.6, 1.8], // body-size multiplier (affects metabolism + reach)
  wander: [0.0, 1.0], // tendency to roam vs. beeline to food
  metabolismEff: [0.7, 1.3], // efficiency multiplier on living cost
};

export function randomGenome(rng) {
  const g = {};
  for (const [name, [min, max]] of Object.entries(GENES)) {
    g[name] = rng.range(min, max);
  }
  return g;
}

export function mutate(genome, rng) {
  const child = {};
  for (const [name, [min, max]] of Object.entries(GENES)) {
    let v = genome[name];
    if (rng.chance(CONFIG.mutation.rate)) {
      const span = max - min;
      v += rng.normal() * CONFIG.mutation.amount * span;
    }
    child[name] = Math.min(max, Math.max(min, v));
  }
  return child;
}

// Map a genome to a stable-ish hue so related creatures look related. We blend
// a couple of behavioural genes into a single hue on the colour wheel.
export function genomeHue(genome) {
  const speedN = norm("speed", genome.speed);
  const wanderN = norm("wander", genome.wander);
  return Math.round((speedN * 0.6 + wanderN * 0.4) * 360) % 360;
}

function norm(name, value) {
  const [min, max] = GENES[name];
  return (value - min) / (max - min);
}
