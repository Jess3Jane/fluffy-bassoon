// Unit test for predator-niche partitioning: the heritable `hunt` gene that lets
// a carnivore clade specialise on a prey-size band — the second trophic level's
// answer to plant-kind `forage`. Covers the yield curve (`huntYield` — convex
// payoff around the preferred prey size, the specialism floor that makes a
// predator ignore off-size bodies, and symmetry), the hunt-aware predation
// queries (`nearestPrey` / `preyInReach` / `preyDensity`) that keep the prey
// pool genuinely partitioned, the meat-yield scaling through a real kill, and
// the wiring through World.stats() / save-load. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { Creature } from "../src/creature.js";
import { CONFIG } from "../src/config.js";
import { GENES, huntYield, randomGenome } from "../src/genome.js";

// Map a point on the normalised [0, 1] prey-size axis to an actual `size` gene.
const [SMIN, SMAX] = GENES.size;
const sizeAt = (n) => SMIN + n * (SMAX - SMIN);

// Drop a creature at a point with chosen diet/size (and, for a predator, prey-
// size preference and a fixed metabolism so energy comparisons are clean).
function add(world, x, y, { diet, size, hunt, metabolismEff }) {
  const c = world.spawnCreature(x, y);
  c.genome.diet = diet;
  c.genome.size = size;
  if (hunt !== undefined) c.genome.hunt = hunt;
  if (metabolismEff !== undefined) c.genome.metabolismEff = metabolismEff;
  c.genome.speed = 0; // stay put so contact is the only variable
  c.genome.alarmVoice = 0; // no cries to perturb the step
  c.genome.foodVoice = 0;
  return c;
}

// --- huntYield: a predator tuned to a prey's exact size gets full value, the
//     opposite end gets nothing, and the curve is convex so honing in beats
//     hunting across sizes.
{
  assert.equal(huntYield(0, sizeAt(0)), 1, "a small-prey specialist gets full yield on the smallest prey");
  assert.equal(huntYield(1, sizeAt(1)), 1, "a large-prey specialist gets full yield on the largest prey");
  assert.ok(
    Math.abs(huntYield(0.5, sizeAt(0.5)) - 1) < 1e-12,
    "a mid-preference predator gets full yield on a mid-size prey",
  );
  // Convexity: a matched specialist out-yields a predator whose preference sits
  // half an axis off the same prey — two specialists beat one jack-of-all-sizes.
  assert.ok(
    huntYield(0, sizeAt(0)) > huntYield(0.5, sizeAt(0)),
    "matched specialist out-yields an off-preference predator on the same prey (convex payoff)",
  );
  // Monotone toward the preference: the closer the gene to the prey's size, more.
  assert.ok(
    huntYield(0.1, sizeAt(0)) > huntYield(0.2, sizeAt(0)),
    "yield rises as the preference moves toward the prey's size",
  );
}

// --- The specialism floor: below `huntMinEff` the yield is 0 — the predator
//     won't strike at a body too far off its preferred size, so size-tuned
//     ecotypes don't strip each other's prey. Derive the crossover match from
//     config so the test tracks any retuning of the curve.
{
  const mStar = Math.pow(CONFIG.creature.huntMinEff, 1 / CONFIG.creature.huntExponent);
  // For the smallest prey (axis 0) the match equals 1 − hunt, so the floor is at
  // hunt = 1 − mStar.
  const edge = 1 - mStar;
  assert.ok(
    huntYield(Math.max(0, edge - 0.02), sizeAt(0)) > 0,
    "just inside the band → the predator hunts the prey",
  );
  assert.equal(
    huntYield(Math.min(1, edge + 0.02), sizeAt(0)),
    0,
    "just outside the band → it leaves that prey size alone",
  );
}

// --- Size symmetry: preferring small prey mirrors preferring large prey.
{
  for (const n of [0, 0.2, 0.4, 0.5, 0.7, 1]) {
    assert.ok(
      Math.abs(huntYield(n, sizeAt(n)) - huntYield(1 - n, sizeAt(1 - n))) < 1e-12,
      `hunt ${n} on its matched prey mirrors ${1 - n} on the opposite end`,
    );
  }
}

// --- hunt flows through the genome machinery like any adaptive gene.
{
  const g = randomGenome(makeRng(5));
  assert.ok(g.hunt >= 0 && g.hunt <= 1, "randomGenome includes hunt in range");
}

// --- nearestPrey is hunt-aware: a small-prey specialist reaches past a nearer
//     large body for a farther small one; with no hunt gene the nearest
//     catchable prey wins (the old behaviour the grid relies on).
{
  const world = new World(makeRng(1), { seed: false });
  const pred = add(world, 600, 400, { diet: 1, size: 1.8, hunt: 0 });
  add(world, 605, 400, { diet: 0, size: sizeAt(0.75) }); // nearer, large → off-band
  const small = add(world, 640, 400, { diet: 0, size: sizeAt(0) }); // farther, small
  world.creatureGrid.rebuild(world.creatures);

  const seek = world.nearestPrey(pred, 200);
  assert.strictEqual(seek, small, "a small-prey specialist reaches past the nearer large body for its own");

  delete pred.genome.hunt; // no preference → nearest catchable of any size
  const any = world.nearestPrey(pred, 200);
  assert.equal(any.genome.size, sizeAt(0.75), "without a hunt gene the nearest catchable prey wins");
}

// --- preyInReach is hunt-aware: a predator in contact with a too-large body
//     leaves it (clean partitioning, the mirror of forageNear skipping off-kind
//     plants), but strikes one in its band.
{
  const world = new World(makeRng(2), { seed: false });
  const pred = add(world, 600, 400, { diet: 1, size: 1.8, hunt: 0 });
  const big = add(world, 600, 400, { diet: 0, size: sizeAt(0.75) }); // catchable by size, off-band
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(pred.canEat(big), "the large body is catchable on size grounds alone");
  assert.strictEqual(world.preyInReach(pred), null, "but the small-prey specialist leaves it (off its size band)");

  add(world, 600, 400, { diet: 0, size: sizeAt(0) }); // a small body in its band
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(world.preyInReach(pred), "and strikes a small body in its band");
}

// --- The kill's meat yield scales by huntYield: a predator matched to its prey's
//     size gains strictly more from the same kill than a marginally-matched one.
//     Run one identical predation step in two worlds differing only in `hunt`.
function meatGain(huntGene, preySizeN) {
  const world = new World(makeRng(7), { seed: false });
  const pred = add(world, 600, 400, {
    diet: 1, size: 1.8, hunt: huntGene, metabolismEff: 1,
  });
  pred.energy = 100; // low enough that the meat gain won't trip reproduction
  add(world, 600, 400, { diet: 0, size: sizeAt(preySizeN) });
  world.creatureGrid.rebuild(world.creatures);
  const before = pred.energy;
  const killsBefore = world.kills;
  world.update(1 / 60);
  assert.ok(world.kills === killsBefore + 1, "the lone victim was caught");
  // Both predators share genome (diet/size/speed/metabolism) bar `hunt`, so the
  // metabolism cost is identical; the energy-delta gap is purely the meat gap.
  return pred.energy - before;
}
{
  const matched = meatGain(0, 0); // preference dead-on the smallest prey
  const marginal = meatGain(0.6, 0); // same prey, preference near the band edge
  assert.ok(
    matched > marginal,
    `a size-matched kill yields more meat than a marginal one (${matched.toFixed(2)} > ${marginal.toFixed(2)})`,
  );
}

// --- preyDensity is hunt-aware: a herd of too-large bodies doesn't shield a
//     small victim from a small-prey specialist, but a herd of same-size prey does.
{
  const world = new World(makeRng(3), { seed: false });
  const pred = add(world, 600, 400, { diet: 1, size: 1.8, hunt: 0 });
  const victim = add(world, 600, 400, { diet: 0, size: sizeAt(0) });
  for (let i = 0; i < 3; i++) add(world, 602 + i, 400, { diet: 0, size: sizeAt(0.75) }); // large neighbours
  world.creatureGrid.rebuild(world.creatures);
  assert.equal(
    world.preyDensity(pred, victim, CONFIG.creature.dilutionRadius),
    0,
    "off-band large neighbours don't confuse a small-prey specialist",
  );

  for (let i = 0; i < 3; i++) add(world, 604 + i, 400, { diet: 0, size: sizeAt(0) }); // small neighbours
  world.creatureGrid.rebuild(world.creatures);
  assert.ok(
    world.preyDensity(pred, victim, CONFIG.creature.dilutionRadius) > 0,
    "same-size neighbours do shield the victim",
  );
}

// --- World.stats() surfaces the average hunt gene.
{
  const world = new World(makeRng(2), { seed: false });
  const c = Creature.random(world, world.rng);
  c.genome.hunt = 0.3;
  world.creatures = [c];
  const s = world.stats();
  assert.ok(Math.abs(s.avg.hunt - 0.3) < 1e-9, "average hunt gene reported");
}

// --- hunt round-trips through save/load (part of the v9 genome snapshot), and a
//     pre-v9 save is rejected rather than bred off a NaN-scaled predation.
{
  const world = new World(makeRng(77));
  for (let i = 0; i < 120; i++) world.update(1 / 60);
  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.equal(blob.version, 10, "snapshot carries the current SAVE_VERSION");
  const restored = World.deserialize(blob, makeRng());
  assert.deepEqual(
    restored.creatures.map((c) => c.genome.hunt),
    world.creatures.map((c) => c.genome.hunt),
    "every creature's hunt gene survives a save/load round-trip",
  );

  const stale = JSON.parse(JSON.stringify(world.serialize()));
  stale.version = 8;
  assert.throws(() => World.deserialize(stale, makeRng()), /unsupported save version/, "a pre-v9 save is rejected");
}

console.log("HUNT TEST PASSED");
