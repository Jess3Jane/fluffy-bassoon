// Headless tests for the inspector's click-through links — the two world-level
// reads the links resolve to: `World.nearestKin` (the "nearest kin" hop) and the
// transient `Creature.targetId` recorded each step (the "target" hop). The DOM
// buttons and the select-and-follow wiring need a browser (like the renderer and
// main entry point), so they're exercised by hand; the pure resolution logic
// here is fully testable.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

function emptyWorld(seed = 5) {
  return new World(makeRng(seed), { seed: false });
}

// Drop a creature at a point with an explicit lineage hue (the axis kin
// recognition reads), setting both the genome marker and the cached field the
// spatial queries actually consult.
function placeKin(world, x, y, hue) {
  const c = world.spawnCreature(x, y);
  c.genome.lineageHue = hue;
  c.lineageHue = hue;
  return c;
}

// --- nearestKin: the nearest creature within `kinTolerance` on the hue wheel,
//     ignoring strangers, self, and the dead. ---
{
  const world = emptyWorld();
  const tol = CONFIG.scent.kinTolerance; // 40°

  const self = placeKin(world, 500, 500, 100);
  // A stranger sitting right on top of self (hue a half-wheel away) must never win.
  placeKin(world, 502, 500, 100 + 180);
  const near = placeKin(world, 540, 500, 100 + tol / 2); // kin, 40 units off
  const far = placeKin(world, 700, 500, 100 - tol / 2); // kin, 200 units off

  assert.equal(world.nearestKin(self), near, "nearest kin wins over a nearer stranger");

  // Remove the nearer kin and the next-nearest relative takes over.
  near.alive = false;
  assert.equal(world.nearestKin(self), far, "dead kin skipped; next kin found");

  // With no kin left alive (only the stranger), there is nobody to link to.
  far.alive = false;
  assert.equal(world.nearestKin(self), null, "no kin alive → null");

  // A creature is never its own kin.
  const lone = emptyWorld();
  const only = placeKin(lone, 100, 100, 50);
  assert.equal(lone.nearestKin(only), null, "self is not kin");
}

// --- nearestKin respects the kin/stranger threshold exactly (hueSimilarity > 0,
//     i.e. strictly within kinTolerance). ---
{
  const world = emptyWorld();
  const tol = CONFIG.scent.kinTolerance;
  const self = placeKin(world, 400, 400, 200);
  // Just inside the tolerance counts as kin; just outside does not.
  const inside = placeKin(world, 450, 400, 200 + (tol - 1));
  assert.equal(world.nearestKin(self), inside, "a hue just inside tolerance is kin");
  inside.lineageHue = 200 + (tol + 1); // now just outside
  assert.equal(world.nearestKin(self), null, "a hue just outside tolerance is a stranger");
}

// --- targetId: a hunting carnivore records the prey it steers toward; a grazer
//     (or anything not chasing a creature) records null. ---
{
  const world = emptyWorld(11);

  // A big, full carnivore with broad senses, standing still so the step is clean.
  const pred = world.spawnCreature(500, 500);
  pred.genome.diet = 1; // pure carnivore → never targets a plant
  pred.genome.size = 2; // out-sizes the prey, so it can eat it
  pred.genome.sense = 300;
  pred.genome.speed = 0;
  pred.genome.alarmVoice = 0;
  pred.genome.foodVoice = 0;
  delete pred.genome.hunt; // any catchable prey qualifies (no size specialism)

  // Small prey in sense range but well outside contact, so it's a target, not a meal.
  const prey = world.spawnCreature(560, 500);
  prey.genome.size = 0.5;
  prey.genome.speed = 0;

  world.creatureGrid.rebuild(world.creatures);
  pred.update(1 / 60, world, world.rng);
  assert.equal(pred.targetId, prey.id, "a carnivore records the prey it steers toward");

  // Prey gone: with nothing to hunt, the target clears rather than going stale.
  prey.alive = false;
  world.creatureGrid.rebuild(world.creatures);
  pred.update(1 / 60, world, world.rng);
  assert.equal(pred.targetId, null, "no prey in reach → target clears to null");
}

// --- A grazer steering toward food (not a creature) records a null target, so
//     the link stays inert for herbivores. ---
{
  const world = emptyWorld(12);
  const grazer = world.spawnCreature(500, 500);
  grazer.genome.diet = 0; // pure herbivore
  grazer.genome.sense = 300;
  grazer.genome.speed = 0;
  grazer.genome.alarmVoice = 0;
  grazer.genome.foodVoice = 0;
  grazer.targetId = 999; // a stale value the step must overwrite

  world.spawnFood(520, 500); // a plant within reach to steer toward
  world.foodGrid.rebuild(world.food);
  world.creatureGrid.rebuild(world.creatures);
  grazer.update(1 / 60, world, world.rng);
  assert.equal(grazer.targetId, null, "a grazer's food target is not an inspectable creature");
}

console.log("INSPECTOR-LINKS TEST PASSED");
