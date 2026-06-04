// Unit test for heritable scent signalling: the four signalling genes
// (foodVoice / alarmVoice / foodTrust / alarmTrust) now drive how loudly a
// creature emits each plume and how strongly it heeds each, with emission
// costing energy. This is what turns the plume field from a fixed reflex into an
// arena selection acts on — honest signalling, silence, eavesdropping, and
// deceptive "danger" calls all become reachable. Pure logic, no DOM.

import assert from "node:assert";
import { ScentField, SCENT } from "../src/scent.js";
import { World } from "../src/world.js";
import { Creature } from "../src/creature.js";
import { randomGenome } from "../src/genome.js";
import { GENES } from "../src/genome.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const S = CONFIG.scent;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = 1200;
const H = 800;

// --- The signalling genes exist, are random in [0, 1], and clamp on mutation
//     (the generic gene-range checks in smoke/persistence cover this too, but
//     assert here that they're actually present and in-range from randomGenome).
{
  const g = randomGenome(makeRng(1));
  for (const name of ["foodVoice", "alarmVoice", "foodTrust", "alarmTrust"]) {
    assert.ok(name in GENES, `${name} is a real gene`);
    const [min, max] = GENES[name];
    assert.ok(g[name] >= min && g[name] <= max, `${name} starts in range`);
  }
}

// --- steer: foodTrust scales the pull toward food scent linearly, and zero
//     trust makes a creature deaf to it regardless of diet.
{
  const f = new ScentField(W, H);
  f.emit(100, 50, SCENT.FOOD, 1.5);
  f.rebuild();
  const full = f.steer(50, 50, 0, 140, 1, 1); // herbivore, full trust
  const half = f.steer(50, 50, 0, 140, 0.5, 1);
  const deaf = f.steer(50, 50, 0, 140, 0, 1);
  assert.ok(full.dx > 0, "a trusting herbivore is pulled toward food scent");
  assert.ok(close(half.dx, full.dx * 0.5), "foodTrust scales the food pull linearly");
  assert.ok(close(deaf.dx, 0) && close(deaf.dy, 0), "foodTrust 0 → deaf to food scent");
}

// --- steer: alarmTrust scales the danger response, so a creature can keep its
//     diet's instinct yet evolve a deaf ear to the alarm channel — the trait a
//     deceiver needs to cry "danger" without scattering itself.
{
  const f = new ScentField(W, H);
  f.emit(100, 50, SCENT.DANGER, 2);
  f.rebuild();
  const heeds = f.steer(50, 50, 1, 140, 1, 1); // carnivore, full trust → drawn in
  const half = f.steer(50, 50, 1, 140, 1, 0.5);
  const deaf = f.steer(50, 50, 1, 140, 1, 0);
  assert.ok(heeds.dx > 0, "a trusting carnivore is drawn toward danger scent");
  assert.ok(close(half.dx, heeds.dx * 0.5), "alarmTrust scales the danger response linearly");
  assert.ok(close(deaf.dx, 0) && close(deaf.dy, 0), "alarmTrust 0 → deaf to danger scent");
}

// --- signal: emitting a plume lays it on the field and costs energy in
//     proportion to its loudness; a plume too faint to outlast the decay floor
//     is skipped entirely (no plume, no cost), so near-silence is free.
{
  const world = new World(makeRng(7), { seed: false });
  const c = world.spawnCreature(300, 300);
  c.energy = 200;

  const strength = 1.5;
  c.signal(world, SCENT.FOOD, strength);
  assert.equal(world.scent.plumes.length, 1, "a loud-enough signal lays a plume");
  assert.ok(close(c.energy, 200 - S.emitCost * strength), "the signal cost energy");

  const before = c.energy;
  c.signal(world, SCENT.FOOD, S.minStrength); // at the floor → forgotten instantly
  assert.equal(world.scent.plumes.length, 1, "a sub-floor signal lays nothing");
  assert.equal(c.energy, before, "a skipped signal costs nothing");
}

// --- A loud-alarm creature lays voluntary DANGER plumes over time and pays for
//     them; a mute one (alarmVoice 0) never cries. Run each alone in an empty,
//     foodless world so the only possible danger plume is a voluntary cry (no
//     kills, no blood) — isolating the new channel from the rest of the field.
{
  const setup = (alarmVoice) => {
    const world = new World(makeRng(99), { seed: false });
    const c = world.spawnCreature(600, 400);
    // A fully controlled, cheap genome: herbivore (never hunts → no blood), low
    // metabolism so it lives out the run, and — held below the reproduce
    // threshold with a fixed energy — it never breeds, so no mutated offspring
    // can sneak a nonzero alarmVoice into the supposedly-mute world.
    Object.assign(c.genome, {
      speed: 10,
      turnRate: 1,
      sense: 40,
      size: 0.6,
      wander: 0,
      metabolismEff: 0.7,
      diet: 0,
      foodVoice: 0,
      alarmVoice,
      foodTrust: 0,
      alarmTrust: 0, // deaf to its own cry, so it doesn't flee itself
    });
    c.energy = 150; // < reproduceThreshold (200): it stays a population of one
    return { world, c };
  };

  const loud = setup(1);
  let cried = false;
  for (let i = 0; i < 60 * 8; i++) {
    loud.world.update(1 / 60);
    if (loud.world.scent.plumes.some((p) => p.kind === SCENT.DANGER)) cried = true;
  }
  assert.ok(cried, "a loud-voiced creature lays voluntary danger (alarm) plumes");
  assert.ok(loud.c.alive, "precondition: the crier survived the run");

  const mute = setup(0);
  let muteCried = false;
  for (let i = 0; i < 60 * 8; i++) {
    mute.world.update(1 / 60);
    if (mute.world.scent.plumes.some((p) => p.kind === SCENT.DANGER)) muteCried = true;
  }
  assert.ok(!muteCried, "a mute creature (alarmVoice 0) never cries danger");
}

// --- The new genes ride the existing save/load round-trip (they live in the
//     genome, which already serializes), so a restored creature keeps them.
{
  const world = new World(makeRng(123));
  for (let i = 0; i < 60 * 10; i++) world.update(1 / 60);
  const restored = World.deserialize(
    JSON.parse(JSON.stringify(world.serialize())),
    makeRng(),
  );
  assert.equal(restored.creatures.length, world.creatures.length, "population restores");
  for (let i = 0; i < world.creatures.length; i++) {
    for (const name of ["foodVoice", "alarmVoice", "foodTrust", "alarmTrust"]) {
      assert.equal(
        restored.creatures[i].genome[name],
        world.creatures[i].genome[name],
        `${name} survives the round-trip`,
      );
    }
  }
}

console.log("SIGNALLING TEST PASSED");
