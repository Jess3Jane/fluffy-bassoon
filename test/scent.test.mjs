// Unit test for the scent / pheromone field: that plumes are laid by living
// creatures, fade and are forgotten, drift downwind on a storm, steer smellers
// by diet (food attracts grazers, blood repels prey but draws predators), and —
// because the field is real state with deterministic emission/drift/decay —
// round-trip through save/load bit-identically alongside the rng-driven world.
// Pure logic, no DOM.

import assert from "node:assert";
import { ScentField, SCENT } from "../src/scent.js";
import { World } from "../src/world.js";
import { Creature } from "../src/creature.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const S = CONFIG.scent;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = 1200;
const H = 800;

// --- emit appends plumes and caps the field at maxCount, evicting the oldest.
{
  const f = new ScentField(W, H);
  f.emit(10, 10, SCENT.FOOD, 1);
  f.emit(20, 20, SCENT.DANGER, 2);
  assert.equal(f.plumes.length, 2, "emit grows the field");
  assert.equal(f.plumes[1].kind, SCENT.DANGER, "kinds are recorded");

  const g = new ScentField(W, H);
  for (let i = 0; i < S.maxCount + 50; i++) g.emit(i, i, SCENT.FOOD, 1);
  assert.equal(g.plumes.length, S.maxCount, "field never exceeds the cap");
  // The oldest (x=0..49) were evicted, so the front is now the 50th emission.
  assert.equal(g.plumes[0].x, 50, "the oldest plumes are evicted first");
}

// --- decay fades every plume linearly and drops those past the floor.
{
  const f = new ScentField(W, H);
  f.emit(0, 0, SCENT.FOOD, 1);
  f.emit(0, 0, SCENT.DANGER, S.minStrength + S.decayPerSecond * 0.5); // dies in 0.5s
  f.decay(0.5);
  assert.equal(f.plumes.length, 1, "a plume thinned past the floor is forgotten");
  assert.ok(close(f.plumes[0].strength, 1 - S.decayPerSecond * 0.5), "survivor faded linearly");
}

// --- drift moves every plume and wraps toroidally.
{
  const f = new ScentField(W, H);
  f.emit(5, 5, SCENT.FOOD, 1);
  f.emit(W - 5, H - 5, SCENT.DANGER, 1);
  f.drift(10, 10);
  assert.ok(close(f.plumes[0].x, 15) && close(f.plumes[0].y, 15), "interior plume drifts");
  // The corner plume wraps around the far edge.
  assert.ok(close(f.plumes[1].x, 5) && close(f.plumes[1].y, 5), "edge plume wraps toroidally");
}

// --- steer: food scent attracts a herbivore toward the plume.
{
  const f = new ScentField(W, H);
  f.emit(100, 50, SCENT.FOOD, 1.5);
  f.rebuild();
  // Smeller at the origin, pure herbivore (diet 0), generous sense radius.
  const v = f.steer(50, 50, 0, 140);
  assert.ok(v.dx > 0, "herbivore is pulled toward food scent (rightward)");
  assert.ok(close(v.dy, 0, 1e-9), "no vertical pull when the plume is due east");
}

// --- steer: a pure herbivore ignores food scent it can't use only when diet=1.
{
  const f = new ScentField(W, H);
  f.emit(100, 50, SCENT.FOOD, 1.5);
  f.rebuild();
  const carn = f.steer(50, 50, 1, 140); // diet 1 → (1 - diet) = 0 weight
  assert.ok(close(carn.dx, 0) && close(carn.dy, 0), "a pure carnivore is unmoved by food scent");
}

// --- steer: blood scent repels a herbivore but draws a carnivore — opposite
//     signs on the very same plume, the predator/prey information asymmetry.
{
  const f = new ScentField(W, H);
  f.emit(100, 50, SCENT.DANGER, 2);
  f.rebuild();
  const prey = f.steer(50, 50, 0, 140); // herbivore flees
  const pred = f.steer(50, 50, 1, 140); // carnivore investigates
  assert.ok(prey.dx < 0, "a herbivore flees blood scent (away, leftward)");
  assert.ok(pred.dx > 0, "a carnivore is drawn toward blood scent (rightward)");
  assert.ok(close(prey.dx, -pred.dx, 1e-9), "the responses are equal and opposite at diet 0 vs 1");
}

// --- steer: plumes beyond the sensing radius contribute nothing.
{
  const f = new ScentField(W, H);
  f.emit(400, 50, SCENT.FOOD, 5); // far away
  f.rebuild();
  const v = f.steer(50, 50, 0, 140);
  assert.ok(close(v.dx, 0) && close(v.dy, 0), "scent past the sense radius is not smelled");
}

// --- In a live world, feeding and kills actually lay plumes of each kind.
{
  const world = new World(makeRng(31415));
  let sawFood = false;
  for (let i = 0; i < 60 * 30 && !sawFood; i++) {
    world.update(1 / 60);
    if (world.scent.plumes.some((p) => p.kind === SCENT.FOOD)) sawFood = true;
  }
  assert.ok(sawFood, "grazing creatures lay food-scent plumes");

  // Force a kill: a big carnivore dropped on top of a small herbivore. Pin its
  // prey-size preference to the small end so the `hunt` specialism doesn't gate
  // out the victim (this test is about the danger plume, not the niche).
  const big = world.spawnCreature(600, 400);
  big.genome.diet = 1;
  big.genome.size = 1.8;
  big.genome.hunt = 0;
  const small = world.spawnCreature(600, 400);
  small.genome.diet = 0;
  small.genome.size = 0.6;
  const killsBefore = world.kills;
  let sawDanger = false;
  for (let i = 0; i < 120 && !sawDanger; i++) {
    world.update(1 / 60);
    if (world.scent.plumes.some((p) => p.kind === SCENT.DANGER)) sawDanger = true;
  }
  assert.ok(world.kills > killsBefore, "the carnivore made a kill");
  assert.ok(sawDanger, "a kill lays a danger-scent plume");
}

// --- The field is serialized state, so a save/load round-trip preserves it and
//     keeps the whole world (creatures, food, AND scent) running in lock-step.
{
  const world = new World(makeRng(27182));
  for (let i = 0; i < 60 * 40; i++) world.update(1 / 60); // 40s in
  assert.ok(world.scent.plumes.length > 0, "precondition: the world has grown a scent field");

  const restored = World.deserialize(
    JSON.parse(JSON.stringify(world.serialize())),
    makeRng(),
  );
  assert.equal(
    restored.scent.plumes.length,
    world.scent.plumes.length,
    "the scent field restores at the same size",
  );

  // Checksum over every plume's position, kind, and strength on top of the
  // creature/food motion: if emission, drift, or decay diverged by a hair after
  // the restore, this drifts apart.
  const checksum = (w) => {
    let h = 0;
    for (const c of w.creatures) h += c.x * 1.0007 + c.y * 1.013 + c.heading * 7.7;
    for (const f of w.food) h += f.x * 1.917 + f.y * 2.013;
    for (const p of w.scent.plumes) h += p.x * 3.11 + p.y * 4.07 + p.kind * 9 + p.strength * 13.3;
    return h;
  };

  for (let i = 0; i < 60 * 60; i++) {
    world.update(1 / 60);
    restored.update(1 / 60);
  }
  assert.equal(restored.scent.plumes.length, world.scent.plumes.length, "scent stays in lock-step");
  assert.ok(close(checksum(restored), checksum(world), 1e-6), "the whole world replays identically");
}

// --- deserialize tolerates a missing field (older saves) as an empty field.
{
  const f = ScentField.deserialize(undefined, W, H);
  assert.equal(f.plumes.length, 0, "a save with no scent loads as an empty field");
}

console.log("SCENT TEST PASSED");
