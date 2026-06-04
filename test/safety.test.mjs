// Unit test for "safety in numbers" — the predation dilution / confusion effect.
// A victim packed among other prey is harder for a predator to single out, so a
// herd carries an emergent anti-predator payoff beyond scent. The crowd read is
// `World.preyDensity` (a saturating count of the other creatures the predator
// could eat, near the victim, off the creature grid), and `Creature.update`
// rolls the catch against `1 − dilutionStrength·density` — never to zero, so a
// herd is a refuge, not a fortress. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const NORM = CONFIG.creature.dilutionNorm;
const STRENGTH = CONFIG.creature.dilutionStrength;
const RADIUS = CONFIG.creature.dilutionRadius;

// Drop a creature at a point and force its genome to a chosen diet/size so the
// canEat relationship is exactly what each test wants. Returns the creature.
function add(world, x, y, { diet, size }) {
  const c = world.spawnCreature(x, y);
  c.genome.diet = diet;
  c.genome.size = size;
  return c;
}

// A big carnivore that can overpower the small herbivores below it.
const PRED = { diet: 1, size: 1.8 };
// A small herbivore the predator can eat.
const PREY = { diet: 0, size: 0.7 };

// --- World.preyDensity: a saturating count of catchable prey near the victim. ---
{
  const world = new World(makeRng(1), { seed: false });
  const predator = add(world, 600, 400, PRED);
  const victim = add(world, 600, 400, PREY);

  // No other prey around → density 0.
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(close(world.preyDensity(predator, victim, RADIUS), 0), "lone victim → 0");

  // One other catchable prey nearby contributes a full 1, squashed by NORM.
  add(world, 620, 400, PREY);
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(
    close(world.preyDensity(predator, victim, RADIUS), 1 / NORM),
    "one neighbour → 1/NORM",
  );

  // A creature the predator *can't* eat (too big to overpower) doesn't count —
  // only the confusion set of alternative prey shields the victim.
  add(world, 610, 400, { diet: 0, size: 1.8 });
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(
    close(world.preyDensity(predator, victim, RADIUS), 1 / NORM),
    "an un-catchable neighbour adds nothing",
  );

  // Enough neighbours saturate the read at 1 (and no further).
  for (let i = 0; i < NORM + 2; i++) add(world, 600 + i, 400, PREY);
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(close(world.preyDensity(predator, victim, RADIUS), 1), "many prey saturate at 1");

  // Prey outside the dilution radius don't count.
  const far = new World(makeRng(2), { seed: false });
  const fpred = add(far, 600, 400, PRED);
  const fvict = add(far, 600, 400, PREY);
  add(far, 600 + RADIUS + 20, 400, PREY); // beyond the radius
  far.creatureGrid.rebuild(far.creatures);
  assert.ok(close(far.preyDensity(fpred, fvict, RADIUS), 0), "prey beyond the radius ignored");

  // The victim and predator themselves are never counted.
  const self = new World(makeRng(3), { seed: false });
  const spred = add(self, 600, 400, PRED);
  const svict = add(self, 600, 400, PREY);
  self.creatureGrid.rebuild(self.creatures);
  assert.ok(close(self.preyDensity(spred, svict, RADIUS), 0), "victim/predator excluded");
}

// Run one predation step in a fresh world seeded with `seed`: a stationary
// carnivore overlapping `crowdSize` small herbivores, all packed tight. Returns
// true if a kill happened this step. Speed 0 keeps everyone in contact so the
// only variable is the catch roll. The predator is added first so it takes its
// turn (and rolls the catch) while the prey are still in place.
function killedThisStep(seed, crowdSize) {
  const world = new World(makeRng(seed), { seed: false });
  const predator = add(world, 600, 400, PRED);
  predator.genome.speed = 0; // stay on the victim
  predator.genome.alarmVoice = 0; // don't perturb with cries (keeps the test clean)
  predator.energy = 200;
  for (let i = 0; i < crowdSize; i++) {
    const p = add(world, 600 + (i % 5), 400 + Math.floor(i / 5), PREY);
    p.genome.speed = 0;
    p.genome.foodVoice = 0;
    p.genome.alarmVoice = 0;
  }
  const before = world.kills;
  world.update(1 / 60);
  return world.kills > before;
}

// --- A lone victim (crowd 0 → catch chance 1) is always caught. ---
{
  let kills = 0;
  for (let s = 0; s < 200; s++) if (killedThisStep(s, 1)) kills++;
  assert.strictEqual(kills, 200, "a lone victim is caught every time");
}

// --- A victim buried in a saturating crowd is caught only at the floored
//     chance (1 − dilutionStrength), so the herd dilutes but never blocks
//     predation. Statistical: assert the kill rate lands near the expectation. ---
{
  const trials = 1500;
  let kills = 0;
  for (let s = 0; s < trials; s++) if (killedThisStep(s, NORM + 5)) kills++;
  const rate = kills / trials;
  const expected = 1 - STRENGTH; // saturated crowd → floor chance
  assert.ok(rate > 0, "a herded victim can still be caught (predation isn't blocked)");
  assert.ok(
    Math.abs(rate - expected) < 0.06,
    `crowded kill rate ${rate.toFixed(3)} ≈ floor ${expected.toFixed(3)}`,
  );
}

// --- More crowd means fewer catches: the effect is monotone, not a switch. ---
{
  const trials = 1500;
  const rateAt = (crowd) => {
    let kills = 0;
    for (let s = 0; s < trials; s++) if (killedThisStep(s, crowd)) kills++;
    return kills / trials;
  };
  const lone = rateAt(1);
  const small = rateAt(2); // one neighbour → density 1/NORM
  const big = rateAt(NORM + 5); // saturated
  assert.ok(lone >= small, "a small crowd lowers the catch rate from lone");
  assert.ok(small > big, "a bigger crowd lowers it further");
}

console.log("SAFETY TEST PASSED");
