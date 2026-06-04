// Unit test for the ecological species readout: clustering live genomes into a
// "species" count by single-linkage in normalised *adaptive*-gene space (the
// multi-D mirror of the lineage-hue count), the size floor that drops lone
// mutants, the population guard, and the wiring through World.stats() — including
// the headline case where it disagrees with the hue count: one hue band split
// ecologically into two. Pure logic, no DOM.

import assert from "node:assert";
import {
  GENES,
  randomGenome,
  countGeneClusters,
  geneVector,
} from "../src/genome.js";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { Creature } from "../src/creature.js";
import { CONFIG } from "../src/config.js";

const rng = makeRng(7);

// A genome sitting at the midpoint of every gene's range — a neutral baseline we
// can perturb one gene at a time. lineageHue is irrelevant to the adaptive count.
function midGenome() {
  const g = { lineageHue: 0 };
  for (const [name, [min, max]] of Object.entries(GENES)) g[name] = (min + max) / 2;
  return g;
}

// Set one gene to a fraction of its [min, max] range.
function withGene(base, name, frac) {
  const [min, max] = GENES[name];
  return { ...base, [name]: min + frac * (max - min) };
}

// --- geneVector excludes the neutral hue and normalises every adaptive gene.
{
  const v = geneVector(midGenome());
  assert.equal(v.length, Object.keys(GENES).length, "one entry per adaptive gene");
  for (const x of v) assert.ok(Math.abs(x - 0.5) < 1e-9, "midpoint genome → all 0.5");
}

// --- Empty / singleton / size-floor edges, mirroring countHueClusters.
{
  assert.equal(countGeneClusters([], 0.4, 1), 0, "no creatures → no species");
  assert.equal(countGeneClusters([midGenome()], 0.4, 1), 1, "a lone genome is one cluster");
  assert.equal(countGeneClusters([midGenome()], 0.4, 3), 0, "below the size floor it doesn't count");
}

// --- Identical genomes collapse to one cluster sized by membership.
{
  const g = midGenome();
  assert.equal(countGeneClusters([g, g, g, g], 0.4, 3), 1, "identical genomes → one species");
  assert.equal(countGeneClusters([g, g], 0.4, 3), 0, "but only if it meets the floor");
}

// --- A real gap in a *single* gene (diet) splits the population in two, even
// though every other gene is identical — the ecological split the hue count is
// blind to. Two diet bands at 0.1 and 0.9 are 0.8 apart > tolerance.
{
  const herb = withGene(midGenome(), "diet", 0.1);
  const carn = withGene(midGenome(), "diet", 0.9);
  const pop = [herb, herb, herb, carn, carn, carn];
  assert.equal(countGeneClusters(pop, 0.4, 1), 2, "a single-gene gap → two ecological species");
}

// --- A mere *spread* with no gap chains into one species: diets stepped 0.0 →
// 0.8 in 0.2 increments never gap by more than the 0.4 tolerance, so single-
// linkage keeps them one cluster (variance is not speciation; a gap is).
{
  const pop = [0.0, 0.2, 0.4, 0.6, 0.8].map((f) => withGene(midGenome(), "diet", f));
  assert.equal(countGeneClusters(pop, 0.4, 1), 1, "a continuous spread chains into one species");
}

// --- Linkage requires closeness on *every* gene (max-norm): two genomes within
// tolerance on all genes link; a gap in any one severs them.
{
  const a = midGenome();
  const bClose = withGene(withGene(a, "diet", 0.5 + 0.3), "speed", 0.5 + 0.3); // each gap 0.3 < 0.4
  const bFar = withGene(a, "size", 0.5 + 0.5); // one gap 0.5 > 0.4
  assert.equal(countGeneClusters([a, bClose], 0.4, 1), 1, "all genes within tolerance → linked");
  assert.equal(countGeneClusters([a, bFar], 0.4, 1), 2, "one gene beyond tolerance → split");
}

// --- The size floor counts only clusters meeting it: a big ecotype plus a 2-
// member splinter reads as one species under floor 3, two under floor 1.
{
  const main = withGene(midGenome(), "diet", 0.1);
  const splinter = withGene(midGenome(), "diet", 0.95);
  const pop = [main, main, main, main, splinter, splinter];
  assert.equal(countGeneClusters(pop, 0.4, 1), 2, "floor 1: both ecotypes count");
  assert.equal(countGeneClusters(pop, 0.4, 3), 1, "floor 3: the 2-member splinter is dropped");
}

// --- Within-clade drift stays one species: a parent and many mutated descendants
// chain together rather than fragmenting (the tolerance sits above the per-
// generation drift by construction). Build a drift chain off one founder.
{
  let g = randomGenome(rng);
  const pop = [g];
  for (let i = 0; i < 40; i++) {
    // a small per-gene nudge, the scale of one generation's mutation
    const child = { lineageHue: g.lineageHue };
    for (const [name, [min, max]] of Object.entries(GENES)) {
      const span = max - min;
      child[name] = Math.min(max, Math.max(min, g[name] + rng.normal() * 0.12 * span));
    }
    pop.push(child);
    g = child;
  }
  assert.equal(
    countGeneClusters(pop, CONFIG.speciation.geneTolerance, 1),
    1,
    "a drifting clade chains into one ecological species",
  );
}

// --- Wired through World.stats(): hand-place creatures sharing ONE lineage hue
// but split into two diet ecotypes. The hue count sees one species; the gene
// count sees two — the disagreement the readout exists to surface.
{
  const world = new World(makeRng(2));
  world.creatures.length = 0;
  const floor = CONFIG.speciation.minClusterSize;
  const make = (dietFrac) => {
    const c = Creature.random(world, world.rng);
    c.lineageHue = 123; // one shared hue band for the whole population
    c.genome.lineageHue = 123;
    // pin every adaptive gene to the midpoint, then set diet, so the only spread
    // is along diet and the two ecotypes are cleanly separated.
    for (const [name, [min, max]] of Object.entries(GENES)) c.genome[name] = (min + max) / 2;
    const [dmin, dmax] = GENES.diet;
    c.genome.diet = dmin + dietFrac * (dmax - dmin);
    return c;
  };
  for (let i = 0; i < floor; i++) world.creatures.push(make(0.05)); // herbivore ecotype
  for (let i = 0; i < floor; i++) world.creatures.push(make(0.95)); // carnivore ecotype
  const s = world.stats();
  assert.equal(s.species, 1, "one hue band → one species by the neutral count");
  assert.equal(s.geneSpecies, 2, "two diet ecotypes → two ecological species");
}

// --- The population guard: above maxClusterPop the ecological count is null
// (the O(n²) clustering is skipped) while the cheap hue count still reports.
{
  const world = new World(makeRng(3));
  world.creatures.length = 0;
  const over = CONFIG.speciation.maxClusterPop + 1;
  for (let i = 0; i < over; i++) {
    const c = Creature.random(world, world.rng);
    c.lineageHue = 50;
    c.genome.lineageHue = 50;
    world.creatures.push(c);
  }
  const s = world.stats();
  assert.equal(s.geneSpecies, null, "over the guard → ecological count is null");
  assert.ok(typeof s.species === "number", "the hue count is still computed");
}

console.log("GENE SPECIES TEST PASSED");
