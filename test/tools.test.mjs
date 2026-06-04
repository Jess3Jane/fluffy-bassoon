// Headless tests for the interactive-tool spawn primitives on the world core
// (`spawnFood` / `spawnCreature`). The ToolController itself needs a DOM
// (canvas + pointer events), so it's out of scope here — like the renderer and
// main entry point — but the world-level entry points it drives are pure and
// fully testable.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { GENES } from "../src/genome.js";
import { CONFIG } from "../src/config.js";

const rng = makeRng(4242);
// Start from an empty world so counts are exact and uncluttered by seeding.
const world = new World(rng, { seed: false });
assert.equal(world.food.length, 0, "empty world has no food");
assert.equal(world.creatures.length, 0, "empty world has no creatures");

// --- spawnFood places a pellet exactly where asked and returns it. ---
const pellet = world.spawnFood(123, 456);
assert.ok(pellet, "spawnFood returns the pellet");
assert.equal(world.food.length, 1, "food count grows by one");
assert.equal(pellet.x, 123, "pellet x honoured");
assert.equal(pellet.y, 456, "pellet y honoured");

// --- spawnFood respects the carrying capacity and signals refusal with null. ---
while (world.food.length < CONFIG.food.maxCount) world.spawnFood(10, 10);
assert.equal(world.food.length, CONFIG.food.maxCount, "filled to the cap");
const overflow = world.spawnFood(10, 10);
assert.equal(overflow, null, "spawnFood returns null at the cap");
assert.equal(world.food.length, CONFIG.food.maxCount, "cap not exceeded");

// --- spawnCreature drops a live, generation-0 creature with a legal genome. ---
const before = world.creatures.length;
const c = world.spawnCreature(300, 400);
assert.ok(c, "spawnCreature returns the creature");
assert.equal(world.creatures.length, before + 1, "creature count grows by one");
assert.equal(c.x, 300, "creature x honoured");
assert.equal(c.y, 400, "creature y honoured");
assert.equal(c.generation, 0, "spawned creatures are founders");
assert.ok(c.alive, "spawned creature is alive");
assert.ok(c.energy > 0, "spawned creature has energy");
for (const [name, [min, max]] of Object.entries(GENES)) {
  const v = c.genome[name];
  assert.ok(v >= min && v <= max, `spawned gene ${name} in range, got ${v}`);
}
assert.ok(
  Number.isFinite(c.lineageHue) && c.lineageHue >= 0 && c.lineageHue < 360,
  `spawned lineage hue in [0,360), got ${c.lineageHue}`,
);

// --- spawnCreature keeps the peak-population counter honest. ---
const empty = new World(makeRng(7), { seed: false });
assert.equal(empty.peakPopulation, 0, "empty world peak starts at zero");
empty.spawnCreature(1, 1);
empty.spawnCreature(2, 2);
assert.equal(empty.peakPopulation, 2, "peak tracks interactive spawns");

// --- A spawned creature integrates into the sim and steps cleanly. ---
for (let i = 0; i < 120; i++) empty.update(1 / 60);
for (const m of empty.creatures) {
  assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y), "stepped pos finite");
  assert.ok(m.x >= 0 && m.x <= empty.width, "stepped x in bounds");
  assert.ok(m.y >= 0 && m.y <= empty.height, "stepped y in bounds");
}

console.log("TOOLS TEST PASSED");
