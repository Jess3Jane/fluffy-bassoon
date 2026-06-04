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

  // Kin recognition: how strongly the creature filters the scent field by
  // *who* laid each plume, told from the emitter's inherited `lineageHue`
  // marker (close hue = close relative). At 0 the creature is kin-blind and
  // heeds every plume by its diet/trust alone (the old behaviour); at 1 it
  // heeds only its own kin's plumes, ignoring strangers'. This is what gives
  // honest *food* signalling an upward path: broadcasting your larder feeds
  // competitors, but if the creatures that answer the call are mostly close
  // relatives (sharing your `foodVoice`), the call pays off through inclusive
  // fitness rather than being pure altruism that erodes to silence.
  kinship: [0.0, 1.0], // how strongly scent response is weighted toward kin

  // Sexual reproduction: how readily the creature reproduces with a partner
  // (recombining two genomes) rather than cloning itself. At 0 it always splits
  // asexually — a mutated copy of itself, the old behaviour; at 1 it always
  // seeks a mate when ready and, if one is in reach, the child is a crossover of
  // both parents. The mode is heritable so selection decides whether mixing
  // genes (which can pull good traits from separate lineages into one body, and
  // shed bad ones, far faster than mutation alone) beats faithful cloning — and
  // because a creature with no partner nearby falls back to cloning, sex never
  // stalls reproduction outright; it only happens where there's someone to mix
  // with, so it co-evolves with the same clustering the scent/kin layers drive.
  mating: [0.0, 1.0], // readiness to reproduce sexually (vs. clone) when able

  // Mate choice: when a creature does breed sexually it no longer simply pairs
  // with whoever is nearest — this gene shapes *whom* it picks, along the same
  // lineage-hue axis kin recognition already reads. It is centred at 0.5, which
  // is exactly the old "nearest wins" behaviour (no preference); above 0.5 the
  // creature mates assortatively (prefers partners whose hue is close to its
  // own — homogamy, which can pull a clade toward reproductive isolation and so
  // gives speciation a lever), and below 0.5 it mates disassortatively (prefers
  // hue-distant partners — outbreeding / inbreeding avoidance, which keeps a
  // lineage mixing with strangers). The preference trades off against distance
  // (`creature.mateChoiceDistWeight`), so it only bends the choice among the
  // partners actually in reach and only bites when there's a real hue spread to
  // choose across; with everyone a stranger (or everyone kin) it collapses back
  // to nearest. This is the sexual-selection counterpart to the `mating` gene:
  // `mating` sets *whether* to mix genes, `mateChoice` sets *with whom*.
  mateChoice: [0.0, 1.0], // assortative (>0.5) ↔ disassortative (<0.5) mate preference
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

// Sexual reproduction: recombine two parent genomes into a child's. Each gene is
// inherited independently from one parent or the other with equal chance (uniform
// crossover), so a child is a fresh shuffle of its parents' traits rather than a
// near-copy of one — recombination that can pull good genes from separate
// lineages into one body (and shed bad ones) far faster than mutation alone. The
// neutral `lineageHue` marker follows the first parent `a` (the one that
// initiated reproduction — a maternal line), so clade colouring stays coherent
// even as genes mix across lineages. The result is unmutated: callers run it
// through `mutate`, exactly as the asexual (clone) path does, to add the per-gene
// mutation and hue drift.
export function crossover(a, b, rng) {
  const child = {};
  for (const name of Object.keys(GENES)) {
    child[name] = rng.chance(0.5) ? a[name] : b[name];
  }
  child.lineageHue = a.lineageHue;
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

// Kin-similarity between two lineage hues, in [0, 1]: 1 when identical, falling
// linearly to 0 once they are `tolerance` degrees apart on the colour wheel (a
// stranger). Used to weight scent response toward kin. A null/undefined hue
// (an untagged plume from an older save, or a caller that doesn't track it)
// counts as fully similar, so kin-weighting degrades to kin-blind there.
export function hueSimilarity(a, b, tolerance) {
  if (a == null || b == null) return 1;
  let d = Math.abs(((a - b) % 360) + 360) % 360;
  if (d > 180) d = 360 - d;
  return Math.max(0, 1 - d / tolerance);
}
