// Unit test for resource partitioning: two plant kinds and the heritable
// `forage` gene that lets a clade specialise on a sub-resource. Covers the
// yield curve (`forageYield` — convex payoff, the specialism floor that makes a
// creature ignore off-kind plants, and kind symmetry), the forage-aware sense
// (`nearestFood`) and eating (`forageNear`) that keep the two kinds genuinely
// partitioned, and the wiring through World.stats() / save-load. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { Creature } from "../src/creature.js";
import { CONFIG } from "../src/config.js";
import { forageYield, randomGenome } from "../src/genome.js";
import { kindYieldFactor } from "../src/plants.js";

// --- forageYield: a matched specialist gets full value, the opposite specialism
//     gets nothing, and the curve is convex so specialising out-yields hedging.
{
  assert.equal(forageYield(0, 0), 1, "a kind-0 specialist gets full yield on kind 0");
  assert.equal(forageYield(1, 1), 1, "a kind-1 specialist gets full yield on kind 1");
  // Convexity: a specialist out-yields a generalist on its own kind, so two
  // specialists beat one generalist — the disruptive-selection pressure.
  assert.ok(
    forageYield(0, 0) > forageYield(0.5, 0),
    "matched specialist out-yields a generalist on the same plant (convex payoff)",
  );
  // Monotone toward the specialism: the closer the gene to the kind, the more.
  assert.ok(
    forageYield(0.1, 0) > forageYield(0.2, 0),
    "yield rises as the gene moves toward the kind it eats",
  );
}

// --- The specialism floor: below `forageMinEff` the yield is 0 — the creature
//     won't bother with (or consume) a plant too far off its specialism, so the
//     two ecotypes don't strip each other's resource. Derive the crossover match
//     from the config so the test tracks any retuning of the curve.
{
  const mStar = Math.pow(CONFIG.food.forageMinEff, 1 / CONFIG.food.forageExponent);
  // For a kind-1 plant the match equals the forage gene directly.
  assert.ok(
    forageYield(Math.min(1, mStar + 0.02), 1) > 0,
    "just above the floor → the creature forages the kind",
  );
  assert.equal(
    forageYield(Math.max(0, mStar - 0.02), 1),
    0,
    "just below the floor → it leaves the kind uneaten",
  );
  // A central generalist clears the floor on *both* kinds (the generalist niche).
  assert.ok(forageYield(0.5, 0) > 0 && forageYield(0.5, 1) > 0, "a generalist eats either kind");
}

// --- Kind symmetry: specialising on kind 0 mirrors specialising on kind 1.
{
  for (const f of [0, 0.2, 0.4, 0.5, 0.7, 1]) {
    assert.ok(
      Math.abs(forageYield(f, 0) - forageYield(1 - f, 1)) < 1e-12,
      `forage ${f} on kind 0 mirrors ${1 - f} on kind 1`,
    );
  }
}

// --- forage flows through the genome machinery like any adaptive gene.
{
  const g = randomGenome(makeRng(5));
  assert.ok(g.forage >= 0 && g.forage <= 1, "randomGenome includes forage in range");
}

// --- nearestFood is forage-aware: a specialist seeks only its own kind, skipping
//     a nearer off-kind plant; with no forage gene every kind is eligible.
{
  const world = new World(makeRng(1), { seed: false });
  world.food = [
    { x: 100, y: 100, kind: 0 }, // nearer
    { x: 120, y: 100, kind: 1 }, // farther
  ];
  world.foodGrid.rebuild(world.food);

  const spec = world.nearestFood(100, 100, 200, 1); // kind-1 specialist
  assert.equal(spec.kind, 1, "a specialist reaches past the nearer off-kind plant for its own");

  const any = world.nearestFood(100, 100, 200); // no forage → nearest of any kind
  assert.equal(any.kind, 0, "without a forage gene the nearest plant of any kind wins");
}

// --- forageNear consumes only the kinds a creature will eat and returns the
//     efficiency-weighted yield: a specialist eats its own kind and leaves the
//     other for the sister ecotype; a generalist takes both.
{
  const world = new World(makeRng(1), { seed: false });
  const layout = () => [
    { x: 100, y: 100, kind: 0 },
    { x: 101, y: 100, kind: 0 },
    { x: 102, y: 100, kind: 1 },
    { x: 103, y: 100, kind: 1 },
  ];

  world.food = layout();
  world.foodGrid.rebuild(world.food);
  const spec = world.forageNear(100, 100, 10, 0); // kind-0 specialist
  assert.equal(spec.count, 2, "the specialist ate only its two own-kind plants");
  assert.ok(
    Math.abs(spec.gained - 2 * forageYield(0, 0) * kindYieldFactor(0, world.time)) < 1e-9,
    "gained is the sum of per-plant forage yields, scaled by the kind's current yield factor",
  );
  assert.ok(
    world.food.filter((f) => !f.dead).every((f) => f.kind === 1),
    "the off-kind plants are left uneaten for the other ecotype",
  );

  world.food = layout();
  world.foodGrid.rebuild(world.food);
  const gen = world.forageNear(100, 100, 10, 0.5); // generalist
  assert.equal(gen.count, 4, "a generalist ate all four plants, both kinds");
}

// --- World.stats() surfaces the average forage gene and the larder split by kind.
{
  const world = new World(makeRng(2), { seed: false });
  world.food = [
    { x: 1, y: 1, kind: 0 },
    { x: 2, y: 2, kind: 1 },
    { x: 3, y: 3, kind: 1 },
  ];
  const c = Creature.random(world, world.rng);
  c.genome.forage = 0.7;
  world.creatures = [c];
  const s = world.stats();
  assert.deepEqual(s.foodByKind, [1, 2], "food tallied by plant kind");
  assert.ok(Math.abs(s.avg.forage - 0.7) < 1e-9, "average forage gene reported");
}

// --- A seeded world grows both plant kinds (the spatial patchwork), and every
//     pellet carries a valid kind.
{
  const world = new World(makeRng(123));
  assert.ok(
    world.food.some((f) => f.kind === 0) && world.food.some((f) => f.kind === 1),
    "a seeded world grows both plant kinds",
  );
  assert.ok(
    world.food.every((f) => f.kind === 0 || f.kind === 1),
    "every pellet has a valid kind",
  );
}

// --- Plant kind round-trips through save/load (it's part of the v8 snapshot).
{
  const world = new World(makeRng(77));
  for (let i = 0; i < 120; i++) world.update(1 / 60);
  const restored = World.deserialize(JSON.parse(JSON.stringify(world.serialize())), makeRng());
  assert.deepEqual(
    restored.food.map((f) => f.kind),
    world.food.map((f) => f.kind),
    "every pellet's kind survives a save/load round-trip",
  );
}

console.log("FORAGE TEST PASSED");
