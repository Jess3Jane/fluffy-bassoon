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

  // Foraging specialism along the plant-kind axis. There are two plant kinds
  // (0 and 1); this gene sets which a herbivore is suited to eat. At 0 it
  // specialises on kind-0 plants, at 1 on kind-1, and at 0.5 it's a generalist
  // taking either at a discount. The yield curve is convex (`forageEff`), so two
  // specialists beat one generalist — disruptive selection that lets a clade
  // split onto separate sub-resources and stop competing head-to-head with its
  // sister ecotype. Because it's a normal adaptive gene it joins `geneVector`,
  // so a forage gap shows up in the ecological species count: the partitioning
  // this gene enables is exactly what that readout was built to surface.
  forage: [0.0, 1.0], // 0 = kind-0 specialist ↔ 1 = kind-1 specialist (0.5 generalist)

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

// Energy efficiency a creature with this `forage` gene extracts from a plant of
// `kind` (0 or 1), in [0, 1]. The match between gene and kind — 1 when perfectly
// specialised on it, 0 for the opposite specialism, 0.5 for a generalist — is
// raised to `forageExponent` (> 1, so the curve is convex and two specialists
// out-yield one generalist: disruptive selection). Below `forageMinEff` it
// returns 0: the creature won't bother with — and won't consume — a plant too
// far off its specialism, so each ecotype leaves the other's resource untouched
// (clean niche partitioning). This is the single source of truth for both
// *whether* a creature forages a kind (yield > 0) and *how much* it gains, used
// by the food-targeting sense and the eating step alike.
export function forageYield(forage, kind) {
  const match = kind === 1 ? forage : 1 - forage;
  const eff = Math.pow(match, CONFIG.food.forageExponent);
  return eff >= CONFIG.food.forageMinEff ? eff : 0;
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

// Count distinct lineage-hue clusters among a set of hues, treating two hues as
// belonging to the same cluster when they sit within `tolerance` degrees on the
// colour wheel (single-linkage along the circle: a clade chains together so long
// as no internal gap exceeds `tolerance`, even as it drifts wider than that
// end-to-end). Only clusters with at least `minSize` members are tallied, so a
// lone mutant or a transient splinter doesn't read as its own species. This is
// the speciation read: as assortative mate choice isolates clades along the
// lineage-hue axis, the population fragments into hue bands separated by gaps
// wider than `tolerance`, and this counts the bands big enough to be real.
export function countHueClusters(hues, tolerance, minSize = 1) {
  const n = hues.length;
  if (n === 0) return 0;
  const sorted = hues.slice().sort((a, b) => a - b);
  // Walk the sorted ring; a gap wider than `tolerance` between cyclic neighbours
  // breaks one cluster from the next. `breaks` holds each index whose gap to its
  // successor is a break (the successor starts a fresh arc).
  const breaks = [];
  for (let i = 0; i < n; i++) {
    const next = i === n - 1 ? sorted[0] + 360 : sorted[i + 1];
    if (next - sorted[i] > tolerance) breaks.push(i);
  }
  // No break anywhere: every hue chains into one ring-spanning cluster.
  if (breaks.length === 0) return n >= minSize ? 1 : 0;
  // Otherwise each break ends an arc; tally the arcs meeting the size floor. Arc
  // sizes are the cyclic spans between consecutive breaks and sum to n.
  let count = 0;
  for (let b = 0; b < breaks.length; b++) {
    const start = breaks[b];
    const end = breaks[(b + 1) % breaks.length];
    let size = (end - start + n) % n;
    if (size === 0) size = n; // a single break → one arc holding all n
    if (size >= minSize) count++;
  }
  return count;
}

// Normalise a genome's *adaptive* genes into a vector in [0, 1]^k — every gene
// in GENES, each scaled against its own legal range. The neutral `lineageHue`
// marker is deliberately excluded: this is the adaptive genome (diet, size,
// speed, …) that the ecological species count clusters on, as opposed to the
// ancestry-only hue the colour count uses.
export function geneVector(genome) {
  const v = [];
  for (const name of Object.keys(GENES)) v.push(norm(name, genome[name]));
  return v;
}

// Count distinct *ecological* species among a set of genomes by clustering their
// adaptive genes — the multi-dimensional counterpart to `countHueClusters`. Each
// genome is mapped to a point in normalised gene space (`geneVector`), and two
// points are *linked* when they sit within `threshold` on *every* gene (max-norm
// / Chebyshev closeness — the multi-D echo of the 1-D hue gap). Species are the
// connected components of that graph (single-linkage: a clade chains together so
// long as a path of close-on-every-gene neighbours connects it, even as it drifts
// wider end-to-end), and only components with at least `minSize` members are
// tallied so a lone mutant doesn't read as its own species.
//
// Because linkage requires closeness on *all* genes, a real gap in any single
// adaptive gene — half a clade turning carnivore, say — severs the link and
// splits the cluster, even while the neutral lineage hue stays one band. That is
// the whole point: it sees an ecological split the hue count is blind to. A mere
// *spread* across a gene (a continuum of intermediates with no gap) still chains
// into one species, exactly as speciation requires a gap rather than variance.
//
// O(n²) in the population (every pair is tested), so callers should guard on
// population size before invoking it on a large world.
export function countGeneClusters(genomes, threshold, minSize = 1) {
  const n = genomes.length;
  if (n === 0) return 0;
  const vecs = genomes.map(geneVector);
  // Union-find over the "close on every gene" graph; each component is a species.
  const parent = new Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip if already in the same component (cheaper than the gene compare).
      if (find(i) === find(j)) continue;
      if (withinThreshold(vecs[i], vecs[j], threshold)) parent[find(i)] = find(j);
    }
  }
  // Tally component sizes; count those meeting the floor.
  const sizes = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    sizes.set(r, (sizes.get(r) || 0) + 1);
  }
  let count = 0;
  for (const size of sizes.values()) if (size >= minSize) count++;
  return count;
}

// Two normalised gene vectors are "close" when no single gene differs by more
// than `threshold` (Chebyshev / max-norm). Returns early on the first gene that
// exceeds it, so distant pairs (the common case) cost only a gene or two.
function withinThreshold(a, b, threshold) {
  for (let k = 0; k < a.length; k++) {
    if (Math.abs(a[k] - b[k]) > threshold) return false;
  }
  return true;
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
