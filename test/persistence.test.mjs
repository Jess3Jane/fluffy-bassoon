// Tests for save/load: that a serialized world round-trips through JSON exactly,
// and — crucially — that a restored world is *bit-identical* to the original as
// both run forward, because the rng state is part of the snapshot. Also covers
// the localStorage wrapper's version-rejection and missing/disabled-store paths
// via a tiny in-memory store shim. Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { GENES } from "../src/genome.js";

// Behaviour-relevant fingerprint of a world: everything the simulation reads,
// excluding ids (purely informational labels that can legitimately differ after
// a restore, since dead creatures' ids aren't replayed).
function fingerprint(world) {
  return {
    time: world.time,
    births: world.births,
    deaths: world.deaths,
    kills: world.kills,
    peak: world.peakPopulation,
    rngState: world.rng.getState(),
    food: world.food.map((f) => [f.x, f.y, f.kind]),
    creatures: world.creatures.map((c) => ({
      x: c.x,
      y: c.y,
      energy: c.energy,
      age: c.age,
      heading: c.heading,
      generation: c.generation,
      genome: { ...c.genome },
    })),
  };
}

// --- Round-trip: serialize → JSON → parse → deserialize reproduces the world.
{
  const rng = makeRng(424242);
  const world = new World(rng);
  for (let i = 0; i < 60 * 30; i++) world.update(1 / 60); // 30s of evolution

  assert.ok(world.creatures.length > 0, "precondition: world has creatures");

  const blob = JSON.parse(JSON.stringify(world.serialize()));
  const restored = World.deserialize(blob, makeRng());

  assert.deepStrictEqual(
    fingerprint(restored),
    fingerprint(world),
    "restored world matches the original snapshot",
  );

  // Restored creatures must carry usable derived fields the snapshot omits.
  for (const c of restored.creatures) {
    assert.ok(Number.isFinite(c.radius) && c.radius > 0, "radius recomputed");
    assert.equal(c.lineageHue, c.genome.lineageHue, "lineage hue recomputed");
    assert.ok(c.alive, "restored creatures are alive");
    for (const [name, [min, max]] of Object.entries(GENES)) {
      const v = c.genome[name];
      assert.ok(v >= min - 1e-6 && v <= max + 1e-6, `gene ${name} preserved in range`);
    }
  }
}

// --- Determinism: because the rng state is restored, a loaded world and the
// original advance in lock-step. This is the property that makes a resumed save
// a true continuation rather than a fresh divergent run.
{
  const rng = makeRng(7);
  const world = new World(rng);
  for (let i = 0; i < 60 * 20; i++) world.update(1 / 60);

  const restored = World.deserialize(
    JSON.parse(JSON.stringify(world.serialize())),
    makeRng(),
  );

  // Run both forward the same amount and compare each step's outcome.
  for (let i = 0; i < 60 * 20; i++) {
    world.update(1 / 60);
    restored.update(1 / 60);
  }

  assert.deepStrictEqual(
    fingerprint(restored),
    fingerprint(world),
    "original and restored worlds stay identical when run forward",
  );
}

// --- Empty world round-trips (no creatures/food) without error.
{
  const empty = new World(makeRng(1), { seed: false });
  const restored = World.deserialize(
    JSON.parse(JSON.stringify(empty.serialize())),
    makeRng(),
  );
  assert.equal(restored.creatures.length, 0, "no creatures restored");
  assert.equal(restored.food.length, 0, "no food restored");
}

// --- Version mismatch is rejected so stale saves never load into a new format.
{
  const blob = new World(makeRng(1)).serialize();
  blob.version = blob.version + 999;
  assert.throws(
    () => World.deserialize(blob, makeRng()),
    /unsupported save version/,
    "an unknown save version is refused",
  );
}

// --- The localStorage wrapper survives a missing/disabled store and reads back
// what it wrote. Exercised with a minimal in-memory shim.
{
  const shim = (() => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
  })();

  const original = globalThis.localStorage;
  try {
    // No store available: every call degrades gracefully.
    delete globalThis.localStorage;
    const { saveWorld, loadWorld, hasSavedWorld } = await import("../src/persistence.js");
    assert.equal(hasSavedWorld(), false, "no store → nothing saved");
    assert.equal(loadWorld(makeRng()), null, "no store → load returns null");
    assert.equal(saveWorld(new World(makeRng(1))), false, "no store → save fails softly");

    // With a store: a saved world loads back and is run-forward identical.
    globalThis.localStorage = shim;
    const world = new World(makeRng(99));
    for (let i = 0; i < 600; i++) world.update(1 / 60);

    assert.equal(hasSavedWorld(), false, "empty store before any save");
    assert.equal(saveWorld(world), true, "save succeeds with a store");
    assert.equal(hasSavedWorld(), true, "save is now present");

    const loaded = loadWorld(makeRng());
    assert.ok(loaded, "a saved world loads back");
    assert.deepStrictEqual(
      fingerprint(loaded),
      fingerprint(world),
      "loaded-from-storage world matches the saved one",
    );
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
}

console.log("PERSISTENCE TEST PASSED");
