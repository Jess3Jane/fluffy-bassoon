// Headless smoke test for the simulation core. Runs the world forward and
// asserts the ecosystem stays sane (no NaNs, populations stay in-bounds,
// genomes mutate). The renderer and main entry point need a DOM, so they are
// out of scope here — this exercises the simulation logic only.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { GENES } from "../src/genome.js";
import { CONFIG } from "../src/config.js";

// Brute-force nearest-food distance, the reference the spatial grid must match.
function bruteNearestFoodDistSq(world, x, y, radius) {
  let best = radius * radius;
  for (const f of world.food) {
    if (f.dead) continue;
    const dx = wrapDelta(f.x - x, world.width);
    const dy = wrapDelta(f.y - y, world.height);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return best;
}

function wrapDelta(d, size) {
  const half = size / 2;
  if (d > half) return d - size;
  if (d < -half) return d + size;
  return d;
}

const rng = makeRng(12345);
const world = new World(rng);

assert.equal(world.creatures.length, CONFIG.creature.startCount, "seed pop");
assert.equal(world.food.length, CONFIG.food.startCount, "seed food");

const DT = 1 / 60;
const STEPS = 60 * 120; // simulate two minutes of world time
let maxPop = 0;

for (let i = 0; i < STEPS; i++) {
  world.update(DT);

  maxPop = Math.max(maxPop, world.creatures.length);

  // Invariants checked every so often to keep the test fast.
  if (i % 200 === 0) {
    assert.ok(world.food.length <= CONFIG.food.maxCount, "food cap");
    for (const c of world.creatures) {
      assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), "finite pos");
      assert.ok(c.x >= 0 && c.x <= world.width, "x in bounds");
      assert.ok(c.y >= 0 && c.y <= world.height, "y in bounds");
      assert.ok(c.energy > 0, "alive => energy>0");
      for (const [name, [min, max]] of Object.entries(GENES)) {
        const v = c.genome[name];
        assert.ok(v >= min - 1e-6 && v <= max + 1e-6, `gene ${name} in range`);
      }
    }
  }
}

const stats = world.stats();
console.log("after 2 min:", {
  population: stats.population,
  peak: stats.peak,
  food: stats.food,
  topGen: stats.generation,
  births: world.births,
  deaths: world.deaths,
  kills: world.kills,
  carnivores: stats.carnivores,
  avgSpeed: stats.avg.speed.toFixed(1),
  avgSense: stats.avg.sense.toFixed(0),
  avgDiet: stats.avg.diet.toFixed(2),
});

// The ecosystem should actually be evolving: many births and deaths, and at
// least a few generations deep.
assert.ok(world.births > 50, `expected reproduction, got ${world.births} births`);
assert.ok(world.deaths > 50, `expected mortality, got ${world.deaths} deaths`);
assert.ok(stats.generation >= 2, `expected lineages, top gen ${stats.generation}`);
assert.ok(maxPop > 0, "population existed");

// Predator/prey: a second trophic level should be active — creatures hunting
// each other produces kills, and deaths should outpace pure starvation.
assert.ok(world.kills > 0, `expected predation, got ${world.kills} kills`);
assert.ok(
  stats.avg.diet >= 0 && stats.avg.diet <= 1,
  `avg diet in [0,1], got ${stats.avg.diet}`,
);

// Spatial grid correctness: the grid-backed nearestFood must agree with a
// brute-force scan. Resync the grid to the current food, then sample a lattice
// of query points across the world (including the wrapped edges).
world.foodGrid.rebuild(world.food);
const radius = CONFIG.creature.senseRadius;
let checks = 0;
for (let gx = 0; gx <= world.width; gx += world.width / 13) {
  for (let gy = 0; gy <= world.height; gy += world.height / 11) {
    const expectedSq = bruteNearestFoodDistSq(world, gx, gy, radius);
    const hit = world.nearestFood(gx, gy, radius);
    if (expectedSq < radius * radius) {
      assert.ok(hit, `grid missed food the brute scan found at (${gx},${gy})`);
      const dx = wrapDelta(hit.x - gx, world.width);
      const dy = wrapDelta(hit.y - gy, world.height);
      const gotSq = dx * dx + dy * dy;
      assert.ok(
        Math.abs(gotSq - expectedSq) < 1e-6,
        `grid nearest ${gotSq} != brute ${expectedSq} at (${gx},${gy})`,
      );
    } else {
      assert.ok(!hit, `grid found food the brute scan didn't at (${gx},${gy})`);
    }
    checks++;
  }
}
console.log(`spatial grid matched brute force on ${checks} sample points`);

console.log("\nSMOKE TEST PASSED");
