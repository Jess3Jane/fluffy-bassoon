// Unit test for the speciation readout: clustering live lineage hues into a
// "species" count by single-linkage along the colour wheel, plus the size floor
// that keeps lone mutants from inflating the tally, and the wiring through
// World.stats(). Pure logic, no DOM.

import assert from "node:assert";
import { countHueClusters } from "../src/genome.js";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { Creature } from "../src/creature.js";
import { CONFIG } from "../src/config.js";

// --- Empty / singleton edges.
{
  assert.equal(countHueClusters([], 40, 1), 0, "no creatures → no species");
  assert.equal(countHueClusters([100], 40, 1), 1, "a lone hue is one cluster");
  assert.equal(countHueClusters([100], 40, 3), 0, "below the size floor it doesn't count");
}

// --- A tight clump is a single cluster, however many members.
{
  const hues = [10, 12, 15, 18, 20, 25];
  assert.equal(countHueClusters(hues, 40, 1), 1, "all within tolerance → one species");
}

// --- Single-linkage chains a clade wider than the tolerance end-to-end, so long
// as no internal gap exceeds it: 0..80 in 20° steps spans 80° but never gaps >40.
{
  const hues = [0, 20, 40, 60, 80];
  assert.equal(countHueClusters(hues, 40, 1), 1, "a chained clade is still one species");
}

// --- Two clumps separated by a gap wider than the tolerance read as two.
{
  const hues = [10, 15, 20, 200, 205, 210];
  assert.equal(countHueClusters(hues, 40, 1), 2, "two well-separated bands → two species");
}

// --- Three clumps around the wheel, including across the 0/360 seam.
{
  const hues = [10, 20, 130, 140, 250, 260];
  assert.equal(countHueClusters(hues, 40, 1), 3, "three bands → three species");
}

// --- The wrap-around gap is measured circularly: a clump straddling 0/360 stays
// one cluster, not two split by the seam.
{
  const hues = [350, 355, 5, 10];
  assert.equal(countHueClusters(hues, 40, 1), 1, "a clump across the seam is one species");
}

// --- A single ring-spanning cluster (every cyclic gap within tolerance) is one,
// not zero — the no-break case.
{
  const hues = [];
  for (let h = 0; h < 360; h += 30) hues.push(h); // even 30° spacing, all gaps ≤ 40
  assert.equal(countHueClusters(hues, 40, 1), 1, "a full ring with no break is one species");
}

// --- The size floor counts only clusters meeting it. A big band plus a 2-member
// splinter: with floor 3 only the big band counts.
{
  const hues = [10, 12, 14, 16, 200, 205]; // band of 4, splinter of 2
  assert.equal(countHueClusters(hues, 40, 1), 2, "floor 1: both bands count");
  assert.equal(countHueClusters(hues, 40, 3), 1, "floor 3: the 2-member splinter is dropped");
}

// --- Identical hues collapse to one cluster sized by membership.
{
  assert.equal(countHueClusters([42, 42, 42, 42], 40, 3), 1, "identical hues → one species");
  assert.equal(countHueClusters([42, 42], 40, 3), 0, "but only if it meets the floor");
}

// --- Wired through World.stats(): hand-place creatures into two separated hue
// bands and assert the reported species count clusters them by kinTolerance.
{
  const world = new World(makeRng(1));
  world.creatures.length = 0; // clear the founder population
  const tol = CONFIG.scent.kinTolerance;
  const floor = CONFIG.speciation.minClusterSize;
  // Two bands far apart on the wheel, each with `floor` members so both count.
  const make = (hue) => {
    const c = Creature.random(world, world.rng);
    c.lineageHue = hue;
    c.genome.lineageHue = hue;
    return c;
  };
  for (let i = 0; i < floor; i++) world.creatures.push(make(20 + i)); // band A
  for (let i = 0; i < floor; i++) world.creatures.push(make(200 + i)); // band B
  const s = world.stats();
  assert.equal(s.species, 2, "stats() reports the two clustered bands as two species");
  assert.ok(tol < 180, "sanity: the bands are separated by more than the tolerance");
}

console.log("SPECIATION TEST PASSED");
