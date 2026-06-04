// Unit test for courtship cost: mate *choice* is no longer free. When a creature
// reproduces sexually it pays an energy toll scaled by how far the chosen partner
// is (`courtshipCost · distance / mateRadius`), charged before the child's share
// is carved off. So a picky breeder that reaches past the nearest body for a
// better-matched mate pays for the extra ground it courts across, while a neutral
// breeder (nearest mate) pays a pittance and the asexual / no-mate path pays
// nothing — exactly as before. The toll draws no rng, so worlds stay
// bit-identical across save/load. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const C = CONFIG.creature;
const RADIUS = C.mateRadius;

// --- The cost knob exists and is a real, positive tax kept under reproduceCost. ---
{
  assert.ok(
    typeof C.courtshipCost === "number" && C.courtshipCost > 0,
    "courtshipCost is a positive number",
  );
  assert.ok(
    C.courtshipCost < C.reproduceCost,
    "courtship is a tax on choice, not the dominant cost of breeding",
  );
}

// Drop a breeder at (600, 400) that always seeks a mate, plus a single partner at
// a chosen x along the same row so distance is exactly |x - 600| (no wrap). With
// one candidate, mate choice is moot — `findMate` returns it — so we isolate the
// distance-scaled toll. The flow in `reproduce` (energy, no rng touching it):
//   e1 = E - reproduceCost - courtshipCost·(dist/radius)
//   child.energy = parent.energy = e1 / 2
function breedAtDistance(seedN, dist) {
  const world = new World(makeRng(seedN), { seed: false });
  const self = world.spawnCreature(600, 400);
  self.genome.mating = 1.0; // always reproduce sexually
  self.genome.mateChoice = 0.5; // neutral — single candidate anyway
  self.energy = 1000;
  world.spawnCreature(600 + dist, 400); // the only partner, `dist` away
  world.creatureGrid.rebuild(world.creatures);
  const child = self.reproduce(world, world.rng);
  return { self, child };
}

// --- The toll matches the formula and scales linearly with distance. ---
{
  const E = 1000;
  for (const dist of [0, 22.5, 45, 90]) {
    const { self, child } = breedAtDistance(20 + dist, dist);
    const afterCosts = E - C.reproduceCost - C.courtshipCost * (dist / RADIUS);
    const expected = afterCosts / 2;
    assert.ok(
      Math.abs(self.energy - expected) < 1e-9,
      `parent energy reflects the distance-scaled courtship toll at dist=${dist}`,
    );
    assert.ok(
      Math.abs(child.energy - expected) < 1e-9,
      `child gets the matching half-share at dist=${dist}`,
    );
  }
}

// --- A nearer mate is cheaper than a farther one (monotone in distance). ---
{
  const near = breedAtDistance(101, 20);
  const far = breedAtDistance(101, 80);
  assert.ok(
    near.self.energy > far.self.energy,
    "courting a nearer mate leaves the breeder with more energy than a far one",
  );
}

// --- A picky breeder that reaches past a near stranger for a far kin pays the
//     far mate's toll — choice now costs energy. ---
{
  const TOL = CONFIG.scent.kinTolerance;
  const KIN = 100;
  const STRANGER = (100 + 3 * TOL) % 360;

  // Assortative breeder: prefers its own hue. Near stranger at 15, far kin at 80.
  const picky = new World(makeRng(7), { seed: false });
  const pSelf = picky.spawnCreature(600, 400);
  pSelf.lineageHue = KIN;
  pSelf.genome.mating = 1.0;
  pSelf.genome.mateChoice = 1.0; // assortative → reaches for the far kin
  pSelf.energy = 1000;
  picky.spawnCreature(615, 400).lineageHue = STRANGER; // near, 15 away
  const farKin = picky.spawnCreature(680, 400); // far, 80 away
  farKin.lineageHue = KIN;
  picky.creatureGrid.rebuild(picky.creatures);
  const pickyChild = pSelf.reproduce(picky, picky.rng);

  // A neutral breeder in the same layout takes the near stranger (15 away).
  const calm = new World(makeRng(7), { seed: false });
  const cSelf = calm.spawnCreature(600, 400);
  cSelf.lineageHue = KIN;
  cSelf.genome.mating = 1.0;
  cSelf.genome.mateChoice = 0.5; // neutral → nearest
  cSelf.energy = 1000;
  calm.spawnCreature(615, 400).lineageHue = STRANGER; // near, 15 away
  const calmFarKin = calm.spawnCreature(680, 400);
  calmFarKin.lineageHue = KIN;
  calm.creatureGrid.rebuild(calm.creatures);
  cSelf.reproduce(calm, calm.rng);

  assert.ok(
    pSelf.energy < cSelf.energy,
    "the picky breeder paid more courtship than the neutral one for the same partners",
  );
  // And it really crossed with the far kin (so the extra toll bought the choice).
  const farTollEnergy = (1000 - C.reproduceCost - C.courtshipCost * (80 / RADIUS)) / 2;
  assert.ok(
    Math.abs(pSelf.energy - farTollEnergy) < 1e-9,
    "the picky breeder paid exactly the far-kin distance toll",
  );
}

// --- The asexual / no-mate path pays no courtship at all. ---
{
  // mating = 0 → never seeks a partner, even with one underfoot.
  const world = new World(makeRng(3), { seed: false });
  const self = world.spawnCreature(600, 400);
  self.genome.mating = 0.0;
  self.energy = 1000;
  world.spawnCreature(610, 400); // a body right there, but it won't court
  world.creatureGrid.rebuild(world.creatures);
  const child = self.reproduce(world, world.rng);
  const expected = (1000 - C.reproduceCost) / 2; // no courtship term
  assert.ok(
    Math.abs(self.energy - expected) < 1e-9 && Math.abs(child.energy - expected) < 1e-9,
    "asexual reproduction pays reproduceCost only — no courtship toll",
  );
}

console.log("COURTSHIP-COST TEST PASSED");
