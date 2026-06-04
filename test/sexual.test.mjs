// Unit test for sexual reproduction with genome crossover. A new heritable
// `mating` gene sets how readily a creature breeds with a partner (recombining
// two genomes) rather than cloning itself. At mating 0 it always splits asexually
// — a mutated copy of itself, the old behaviour; at mating 1 it seeks a mate when
// ready and, if one is in reach, the child is a uniform crossover of both parents.
// With no partner nearby it falls back to cloning, so sex never stalls breeding.
// Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { GENES, randomGenome, crossover } from "../src/genome.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const RADIUS = CONFIG.creature.mateRadius;

// --- The mating gene exists, is random in [0, 1], and is a real gene (so the
//     generic mutation/clamp machinery covers it like any other). ---
{
  const g = randomGenome(makeRng(1));
  assert.ok("mating" in GENES, "mating is a real gene");
  const [min, max] = GENES.mating;
  assert.ok(g.mating >= min && g.mating <= max, "mating starts in range");
}

// --- crossover: every child gene comes from one parent or the other, the result
//     mixes both (not a clone of either), and lineageHue follows the first parent. ---
{
  // Two parents with a *distinct* value for every gene, so each child gene's
  // origin is unambiguous. Use the two ends of each gene's legal range.
  const a = {};
  const b = {};
  for (const [name, [min, max]] of Object.entries(GENES)) {
    a[name] = min;
    b[name] = max;
  }
  a.lineageHue = 30;
  b.lineageHue = 200;

  const rng = makeRng(42);
  let sawFromA = false;
  let sawFromB = false;
  // Sample many crossovers to exercise the per-gene coin flips.
  for (let i = 0; i < 50; i++) {
    const child = crossover(a, b, rng);
    for (const name of Object.keys(GENES)) {
      assert.ok(
        child[name] === a[name] || child[name] === b[name],
        `${name} is inherited verbatim from one parent`,
      );
      if (child[name] === a[name]) sawFromA = true;
      if (child[name] === b[name]) sawFromB = true;
    }
    assert.strictEqual(child.lineageHue, a.lineageHue, "lineageHue follows parent a");
  }
  assert.ok(sawFromA && sawFromB, "crossover draws from both parents, not just one");
}

// --- World.findMate: at a neutral mateChoice (0.5) the preference term drops
//     out and it reduces to the old "nearest live other creature within radius,
//     or null" behaviour. (Mate *choice* — a non-neutral preference — has its
//     own test/mate-choice.test.mjs.) ---
{
  const world = new World(makeRng(2), { seed: false });
  const self = world.spawnCreature(600, 400);
  self.genome.mateChoice = 0.5; // no preference → pure nearest

  // Alone → no mate.
  world.creatureGrid.rebuild(world.creatures);
  assert.strictEqual(world.findMate(self, RADIUS), null, "a lone creature has no mate");

  // Two candidates: the nearer one wins.
  const far = world.spawnCreature(600 + RADIUS - 5, 400);
  const near = world.spawnCreature(620, 400);
  world.creatureGrid.rebuild(world.creatures);
  assert.strictEqual(world.findMate(self, RADIUS), near, "findMate returns the nearest");

  // A candidate just beyond the radius is ignored.
  const lonely = world.spawnCreature(800, 400);
  lonely.genome.mateChoice = 0.5;
  world.creatureGrid.rebuild(world.creatures);
  const m = world.findMate(lonely, RADIUS);
  assert.ok(m !== lonely, "findMate never returns self");
  // The only creatures within RADIUS of `lonely` (at 800): none of the cluster
  // around 600 is in reach, so it has no mate either.
  assert.strictEqual(m, null, "creatures beyond the radius are not mates");

  // A dead candidate is skipped.
  near.alive = false;
  world.creatureGrid.rebuild(world.creatures);
  assert.strictEqual(world.findMate(self, RADIUS), far, "a dead creature is not a mate");
}

// To make reproduction's *wiring* exactly checkable, silence mutation so the
// child genome equals its recombined (or cloned) source verbatim. Each test file
// runs in its own node process, so poking CONFIG here can't leak into others.
const savedRate = CONFIG.mutation.rate;
CONFIG.mutation.rate = 0;

// Build a ready-to-breed creature at (x, y) with a fully specified genome.
function breeder(world, x, y, genome, { mating }) {
  const c = world.spawnCreature(x, y);
  for (const name of Object.keys(GENES)) c.genome[name] = genome[name];
  c.genome.mating = mating;
  c.energy = 1000; // well over the reproduce threshold
  return c;
}

// Genomes at opposite ends of every gene range, so a child's gene origin is clear.
const LOW = {};
const HIGH = {};
for (const [name, [min, max]] of Object.entries(GENES)) {
  LOW[name] = min;
  HIGH[name] = max;
}

// --- mating 0 clones: the child's genes match the parent even with a mate next
//     to it (the mating gate never consults findMate). ---
{
  const world = new World(makeRng(3), { seed: false });
  const self = breeder(world, 600, 400, LOW, { mating: 0 });
  breeder(world, 605, 400, HIGH, { mating: 0 }); // a tempting partner, ignored
  world.creatureGrid.rebuild(world.creatures);

  const child = self.reproduce(world, world.rng);
  for (const name of Object.keys(GENES)) {
    assert.strictEqual(child.genome[name], self.genome[name], `${name} cloned at mating 0`);
  }
  assert.strictEqual(child.generation, self.generation + 1, "clone bumps generation by 1");
}

// --- mating 1 with a partner in reach crosses: every child gene comes from one
//     of the two parents, and the result mixes both (so it isn't a clone). ---
{
  const world = new World(makeRng(5), { seed: false });
  const self = breeder(world, 600, 400, LOW, { mating: 1 });
  const mate = breeder(world, 610, 400, HIGH, { mating: 1 });
  self.generation = 4;
  mate.generation = 9;
  world.creatureGrid.rebuild(world.creatures);

  const child = self.reproduce(world, world.rng);
  let fromMate = false;
  for (const name of Object.keys(GENES)) {
    assert.ok(
      child.genome[name] === self.genome[name] || child.genome[name] === mate.genome[name],
      `${name} comes from one of the two parents`,
    );
    if (child.genome[name] === mate.genome[name] && mate.genome[name] !== self.genome[name]) {
      fromMate = true;
    }
  }
  assert.ok(fromMate, "the child inherited at least one gene from the mate (a real cross)");
  // Generation is one past the *older* of the two parents.
  assert.strictEqual(child.generation, 10, "cross bumps past the older parent's generation");
}

// --- mating 1 but alone falls back to cloning, so sex never stalls breeding. ---
{
  const world = new World(makeRng(8), { seed: false });
  const self = breeder(world, 600, 400, LOW, { mating: 1 });
  world.creatureGrid.rebuild(world.creatures);

  const child = self.reproduce(world, world.rng);
  for (const name of Object.keys(GENES)) {
    assert.strictEqual(child.genome[name], self.genome[name], `${name} cloned with no mate around`);
  }
  assert.strictEqual(child.generation, self.generation + 1, "solo fallback bumps generation by 1");
}

CONFIG.mutation.rate = savedRate;

console.log("SEXUAL TEST PASSED");
