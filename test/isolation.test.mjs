// Unit test for the realised reproductive-isolation readout. The hue species
// count says how many clades exist by *ancestry*; this measures whether they
// still actually interbreed. The world keeps a rolling ring of the last
// `matingWindow` *sexual* matings (1 if the pairing bridged two lineages — the
// parents more than `kinTolerance` apart on the hue wheel — else 0), and
// `stats()` reports `isolation = 1 − crossShare`: the within-lineage share of
// recent matings, which rises as assortative `mateChoice` keeps breeding inward.
// Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { GENES } from "../src/genome.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const TOL = CONFIG.scent.kinTolerance;
const WINDOW = CONFIG.speciation.matingWindow;

// --- recordMating bookkeeping: the ring fills, caps at the window, and the
//     derived isolation share is exact. ---
{
  const world = new World(makeRng(1), { seed: false });

  // Empty: no matings on record → isolation is null (not a misleading 0).
  assert.strictEqual(world.stats().isolation, null, "no matings → isolation null");
  assert.strictEqual(world.stats().matings, 0, "no matings counted");

  // Three within-lineage, one cross → 1 of 4 crossed → isolation 0.75.
  world.recordMating(false);
  world.recordMating(false);
  world.recordMating(true);
  world.recordMating(false);
  let s = world.stats();
  assert.strictEqual(s.matings, 4, "four matings on record");
  assert.strictEqual(s.crossMatings, 1, "one of them crossed lineages");
  assert.ok(Math.abs(s.isolation - 0.75) < 1e-9, "isolation = 1 − 1/4");

  // The ring is bounded: push well past the window and it caps, keeping only the
  // most recent events. Fill the rest of the window with crosses, then overflow
  // with within-lineage matings until the ring is all within-lineage.
  for (let i = 0; i < WINDOW * 2; i++) world.recordMating(false);
  s = world.stats();
  assert.strictEqual(s.matings, WINDOW, "ring caps at the window size");
  assert.strictEqual(s.crossMatings, 0, "old cross aged out of the window");
  assert.strictEqual(s.isolation, 1, "a window of within-lineage matings → fully isolated");
}

// --- An all-cross window reads as zero isolation. ---
{
  const world = new World(makeRng(2), { seed: false });
  for (let i = 0; i < 10; i++) world.recordMating(true);
  const s = world.stats();
  assert.strictEqual(s.crossMatings, 10, "all ten crossed");
  assert.strictEqual(s.isolation, 0, "all-cross window → zero isolation");
}

// --- Wired through reproduce: a sexual cross logs the right bit by the partners'
//     hue distance, and the asexual (clone) path logs nothing. ---
{
  const savedRate = CONFIG.mutation.rate;
  CONFIG.mutation.rate = 0; // keep hues exact so the cross classification is crisp

  const KIN = 100;
  const STRANGER = (100 + 3 * TOL) % 360; // well past kinTolerance → sim 0

  // A within-lineage cross: breeder + a same-hue partner in reach.
  {
    const world = new World(makeRng(3), { seed: false });
    const self = world.spawnCreature(600, 400);
    self.lineageHue = KIN;
    self.genome.lineageHue = KIN;
    self.genome.mating = 1.0; // always seek a partner
    self.genome.mateChoice = 0.5; // neutral: just take the one in reach
    self.energy = 1000;
    const partner = world.spawnCreature(615, 400);
    partner.lineageHue = KIN;
    partner.genome.lineageHue = KIN;
    world.creatureGrid.rebuild(world.creatures);

    const child = self.reproduce(world, world.rng);
    assert.ok(child, "a child was produced");
    assert.strictEqual(world.stats().matings, 1, "the sexual mating was recorded");
    assert.strictEqual(world.stats().crossMatings, 0, "a same-hue pairing is within-lineage");
  }

  // A cross-lineage mating: breeder + a stranger-hue partner in reach.
  {
    const world = new World(makeRng(4), { seed: false });
    const self = world.spawnCreature(600, 400);
    self.lineageHue = KIN;
    self.genome.lineageHue = KIN;
    self.genome.mating = 1.0;
    self.genome.mateChoice = 0.5;
    self.energy = 1000;
    const partner = world.spawnCreature(615, 400);
    partner.lineageHue = STRANGER;
    partner.genome.lineageHue = STRANGER;
    world.creatureGrid.rebuild(world.creatures);

    self.reproduce(world, world.rng);
    assert.strictEqual(world.stats().matings, 1, "the sexual mating was recorded");
    assert.strictEqual(world.stats().crossMatings, 1, "a stranger-hue pairing crossed lineages");
  }

  // The asexual path (no partner in reach) records nothing — only true crosses
  // are matings in this sense.
  {
    const world = new World(makeRng(5), { seed: false });
    const self = world.spawnCreature(600, 400);
    self.genome.mating = 1.0; // wants a mate, but there's nobody nearby
    self.energy = 1000;
    world.creatureGrid.rebuild(world.creatures);

    const child = self.reproduce(world, world.rng);
    assert.ok(child, "the solo breeder still cloned");
    assert.strictEqual(world.stats().matings, 0, "asexual reproduction logs no mating");
    assert.strictEqual(world.stats().isolation, null, "and isolation stays null");
  }

  CONFIG.mutation.rate = savedRate;
}

// --- The ring serializes for a true continuation, and an older save lacking it
//     loads with an empty ring (graceful, no version bump). ---
{
  const world = new World(makeRng(6), { seed: false });
  world.recordMating(true);
  world.recordMating(false);
  world.recordMating(false);

  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.deepStrictEqual(blob.matingRing, [1, 0, 0], "the ring is in the snapshot");

  const restored = World.deserialize(blob, makeRng());
  assert.deepStrictEqual(restored.matingRing, [1, 0, 0], "the ring round-trips exactly");
  assert.strictEqual(restored.stats().matings, 3, "and the readout continues");

  // An older save with no matingRing field loads empty rather than throwing.
  delete blob.matingRing;
  const legacy = World.deserialize(blob, makeRng());
  assert.deepStrictEqual(legacy.matingRing, [], "a pre-isolation save loads with an empty ring");
  assert.strictEqual(legacy.stats().isolation, null, "and its readout starts blank");
}

// --- Guard the assumptions the wiring leans on. ---
{
  assert.ok(WINDOW > 0, "the mating window is a positive size");
  assert.ok("mating" in GENES, "the mating gene that gates sexual reproduction exists");
}

console.log("ISOLATION TEST PASSED");
