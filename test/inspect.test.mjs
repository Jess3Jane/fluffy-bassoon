// Headless tests for the creature-inspector pick, `World.creatureAt`. The
// inspector's DOM panel and the ToolController click handling need a browser
// (canvas + pointer events), so — like the renderer and main entry point —
// they're out of scope here; but the world-level lookup the Inspect brush
// drives is pure and fully testable.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";

// Build an empty world, then drop creatures at known points with a fixed body
// size so the pick radius is deterministic.
function emptyWorld() {
  return new World(makeRng(99), { seed: false });
}

function placeCreature(world, x, y, size = 1) {
  const c = world.spawnCreature(x, y);
  c.genome.size = size; // deterministic radius via CONFIG.creature.radius * size
  return c;
}

// --- Empty ground returns null (the inspector reads this as "deselect"). ---
{
  const world = emptyWorld();
  assert.equal(world.creatureAt(100, 100), null, "no creatures → null");
  placeCreature(world, 500, 500);
  assert.equal(world.creatureAt(10, 10), null, "far from any body → null");
}

// --- A click on a body finds it; just outside the body+tolerance misses. ---
{
  const world = emptyWorld();
  const c = placeCreature(world, 300, 300, 1);
  const r = c.radius;
  assert.equal(world.creatureAt(300, 300), c, "dead-centre hit");
  assert.equal(world.creatureAt(300 + r - 0.01, 300), c, "edge of body hit");
  // With a tolerance, a click in the slack ring still lands.
  assert.equal(world.creatureAt(300 + r + 4, 300, 8), c, "within tolerance hit");
  // Beyond body + tolerance, nothing.
  assert.equal(world.creatureAt(300 + r + 10, 300, 8), null, "outside tolerance miss");
  assert.equal(world.creatureAt(300 + r + 0.5, 300, 0), null, "no tolerance, just-outside miss");
}

// --- When bodies overlap, the nearest one wins. ---
{
  const world = emptyWorld();
  const a = placeCreature(world, 400, 400, 1.8); // big, so they overlap
  const b = placeCreature(world, 410, 400, 1.8);
  // A point closer to b should return b even though a also covers it.
  const pick = world.creatureAt(409, 400, 6);
  assert.equal(pick, b, "nearest overlapping body picked (b)");
  const pick2 = world.creatureAt(401, 400, 6);
  assert.equal(pick2, a, "nearest overlapping body picked (a)");
}

// --- Dead creatures are never returned. ---
{
  const world = emptyWorld();
  const c = placeCreature(world, 200, 200, 1);
  c.alive = false;
  assert.equal(world.creatureAt(200, 200, 8), null, "dead body not picked");
}

// --- The pick wraps across the toroidal edges. ---
{
  const world = emptyWorld();
  const c = placeCreature(world, world.width - 2, 300, 1);
  // Click at x = +3 (just across the right edge from the body at width-2): the
  // toroidal gap is only 5 units, so the body should be found.
  const pick = world.creatureAt(3, 300, 8);
  assert.equal(pick, c, "body found across the wrapping seam");
}

console.log("INSPECT TEST PASSED");
