// Unit test for kin-weighted *emission*, the other half of the kin lever.
// Response-side kin recognition lets a creature choose whom to heed; emission
// lets it choose when to bother calling. A creature reads the local kin density
// off the creature grid (`World.kinDensity`) and gates its food call by it,
// scaled by the same `kinship` gene that gates the response — so a kin-blind
// creature calls at full voice as before, while a kin-tuned one hushes among
// strangers (for free) and calls up when relatives are near to benefit.
// Pure logic, no DOM.

import assert from "node:assert";
import { SCENT } from "../src/scent.js";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const TOL = CONFIG.scent.kinTolerance;
const NORM = CONFIG.scent.kinDensityNorm;

// Drop a creature at a point with a fixed lineage hue (and quiet, herbivorous
// genome so neighbours never prey, eat, or signal and confound the read).
function add(world, x, y, hue) {
  const c = world.spawnCreature(x, y);
  c.lineageHue = hue;
  c.genome.lineageHue = hue;
  c.genome.diet = 0;
  c.genome.foodVoice = 0;
  c.genome.alarmVoice = 0;
  return c;
}

// --- World.kinDensity: a saturating, hue-weighted count of nearby kin. ---
{
  const world = new World(makeRng(1), { seed: false });
  const self = add(world, 600, 400, 100);

  // With nobody else around, density is 0.
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(close(world.kinDensity(self, 140), 0), "alone → kin density 0");

  // One clone (same hue) 50 units away contributes a full 1, squashed by NORM.
  add(world, 650, 400, 100);
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(close(world.kinDensity(self, 140), 1 / NORM), "one kin → 1/NORM");

  // A stranger (far hue) adds nothing.
  add(world, 600, 450, 100 + 180);
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(close(world.kinDensity(self, 140), 1 / NORM), "a stranger adds nothing");

  // A half-tolerance-distant relative adds half.
  add(world, 550, 400, 100 + TOL / 2);
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(close(world.kinDensity(self, 140), 1.5 / NORM), "half-kin adds 0.5");

  // Enough kin saturate the read at 1 (and no further).
  for (let i = 0; i < NORM + 2; i++) add(world, 600 + i, 400, 100);
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(close(world.kinDensity(self, 140), 1), "many kin saturate at 1");

  // Kin outside the read radius don't count.
  const far = new World(makeRng(2), { seed: false });
  const fself = add(far, 600, 400, 100);
  add(far, 600, 600, 100); // 200 units away
  far.creatureGrid.rebuild(far.creatures);
  assert.ok(close(far.kinDensity(fself, 140), 0), "kin beyond the radius are ignored");
}

// Run one step on a world holding a single feeding creature (`self`) plus the
// given neighbours, and return the strength of the food plume it lays (0 if it
// stayed silent). Food is heaped on `self` so it always feeds; `self` is added
// first so it takes its turn (and reads kin density) before neighbours move.
function foodCallStrength({ kinship, neighbourHue, neighbours = NORM }) {
  const world = new World(makeRng(42), { seed: false });
  const self = add(world, 600, 400, 100);
  self.genome.foodVoice = 1;
  self.genome.kinship = kinship;
  self.genome.speed = 10; // barely moves, so it stays on the food it's fed
  self.energy = 150;
  for (let i = 0; i < neighbours; i++) add(world, 590 + i * 5, 400, neighbourHue);
  // A cluster of food right under the feeder.
  for (let i = 0; i < 6; i++) world.spawnFood(600 + i, 400);

  world.update(1 / 60);
  const ours = world.scent.plumes.filter(
    (p) => p.kind === SCENT.FOOD && close(p.hue, 100),
  );
  return ours.reduce((m, p) => Math.max(m, p.strength), 0);
}

// --- A kin-blind creature (kinship 0) calls at full voice regardless of who's
//     around — exactly the pre-emission behaviour. ---
{
  const full = CONFIG.scent.foodStrength; // foodVoice 1, kinGain 1
  const amongKin = foodCallStrength({ kinship: 0, neighbourHue: 100 });
  const amongStrangers = foodCallStrength({ kinship: 0, neighbourHue: 280 });
  assert.ok(close(amongKin, full), "kinship 0 calls at full voice among kin");
  assert.ok(close(amongStrangers, full), "kinship 0 calls at full voice among strangers");
}

// --- A kin-tuned creature (kinship 1) calls loudly when surrounded by kin... ---
{
  const amongKin = foodCallStrength({ kinship: 1, neighbourHue: 100 });
  assert.ok(close(amongKin, CONFIG.scent.foodStrength), "full kinship + kin → full call");
}

// --- ...and hushes among strangers — for free: the call falls below the decay
//     floor, so no plume is laid at all (and `signal` spends no energy). ---
{
  const amongStrangers = foodCallStrength({ kinship: 1, neighbourHue: 280 });
  assert.ok(close(amongStrangers, 0), "full kinship + strangers → silent");
}

// --- The gate is graded, not a switch: partial kinship gives a partial call,
//     and the louder-with-kin ordering holds across the board. ---
{
  const blind = foodCallStrength({ kinship: 0, neighbourHue: 280 });
  const partial = foodCallStrength({ kinship: 0.5, neighbourHue: 280 });
  const tuned = foodCallStrength({ kinship: 1, neighbourHue: 280 });
  assert.ok(partial < blind, "more kinship hushes a stranger-surrounded caller");
  assert.ok(tuned < partial, "still more kinship hushes it further");
}

console.log("KIN-EMISSION TEST PASSED");
