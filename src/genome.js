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
  diet: [0.0, 1.0], // 0 = pure herbivore (plants), 1 = pure carnivore (prey)

  // Scent signalling: how the creature uses the shared pheromone field. These
  // turn the plume layer from a fixed reflex into something selection acts on,
  // so honest signalling, silence, eavesdropping, and deception can all evolve.
  // A "voice" controls how loudly it emits a plume (each emission costs energy);
  // a "trust" controls how strongly it heeds that plume on the air. Splitting
  // emit from response per kind is what lets, e.g., a deceiver cry "danger"
  // loudly (high alarmVoice) while ignoring the channel itself (low alarmTrust)
  // to scatter rivals off contested food.
  foodVoice: [0.0, 1.0], // loudness of the "food here" plume laid while feeding
  alarmVoice: [0.0, 1.0], // loudness/rate of voluntary "danger" (alarm) cries
  foodTrust: [0.0, 1.0], // how strongly food scent steers this creature
  alarmTrust: [0.0, 1.0], // how strongly danger scent steers this creature
};

export function randomGenome(rng) {
  const g = {};
  for (const [name, [min, max]] of Object.entries(GENES)) {
    g[name] = rng.range(min, max);
  }
  // Neutral lineage marker: a hue (degrees) carried down to offspring with a
  // slight drift, so a founder and its descendants share a colour and clades
  // become visible. It affects nothing about behaviour, so it lives outside
  // GENES — it wraps around the colour wheel rather than clamping to a range.
  g.lineageHue = rng.range(0, 360);
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
  // Drift the lineage marker a little each generation: a clade stays close to
  // its founder's colour while slowly diverging from cousins, so distinct
  // colour bands trace distinct lineages.
  child.lineageHue = wrapHue(
    genome.lineageHue + rng.normal() * CONFIG.mutation.lineageDrift,
  );
  return child;
}

// Map a genome to a hue so a creature's trophic role is visible at a glance:
// diet drives the base colour from green (herbivore) through to red
// (carnivore), with speed adding subtle within-role variation.
export function genomeHue(genome) {
  const dietN = norm("diet", genome.diet);
  const speedN = norm("speed", genome.speed);
  const base = (1 - dietN) * 120; // 120° green (herbivore) → 0° red (carnivore)
  return Math.round(base + speedN * 20) % 360;
}

function norm(name, value) {
  const [min, max] = GENES[name];
  return (value - min) / (max - min);
}

// Wrap a hue into [0, 360).
function wrapHue(h) {
  return ((h % 360) + 360) % 360;
}
