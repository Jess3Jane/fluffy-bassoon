// Unit test for the History ring buffer: sampling cadence, capacity eviction,
// lazy stats, and trait normalisation. Pure logic, no DOM.

import assert from "node:assert";
import { History, normTrait } from "../src/history.js";
import { GENES } from "../src/genome.js";

// A minimal stats() stand-in; bumps a counter so we can assert how often the
// (lazy) getStats callback actually runs.
let calls = 0;
function fakeStats(population = 1) {
  calls++;
  return {
    population,
    carnivores: 0,
    food: 10,
    avg: { diet: 0.5, speed: 50, size: 1, sense: 100 },
  };
}

// --- Cadence: a snapshot only lands once a full interval of sim-time elapses.
{
  const h = new History({ capacity: 100, interval: 1 });
  assert.equal(h.tick(0.5, () => fakeStats()), false, "half an interval: no sample");
  assert.equal(h.samples.length, 0, "nothing recorded yet");
  assert.equal(h.tick(0.5, () => fakeStats()), true, "crossing the interval samples");
  assert.equal(h.samples.length, 1, "exactly one sample recorded");
}

// --- Lazy stats: getStats runs once per recorded sample, not per tick.
{
  calls = 0;
  const h = new History({ interval: 1 });
  for (let i = 0; i < 10; i++) h.tick(0.25, () => fakeStats()); // 2.5 intervals
  assert.equal(h.samples.length, 2, "2.5 intervals → 2 samples");
  assert.equal(calls, 2, "getStats called only when a sample is due");
}

// --- Cadence doesn't drift: leftover sim-time carries to the next interval.
// With dt=0.7 the carry is what lets the *second* interval land early: tick 2
// records (1.4, carrying 0.4) and tick 3 reaches 1.1 to record again. Reset-to-
// zero behaviour would instead need a full interval after each sample and yield
// just one snapshot here.
{
  const h = new History({ interval: 1 });
  for (let i = 0; i < 3; i++) h.tick(0.7, () => fakeStats());
  assert.equal(h.samples.length, 2, "remainder carries into the next interval");
}

// --- Capacity: the ring evicts oldest first and keeps the newest `capacity`.
{
  const h = new History({ capacity: 3, interval: 1 });
  for (let i = 1; i <= 5; i++) h.tick(1, () => fakeStats(i));
  assert.equal(h.samples.length, 3, "never exceeds capacity");
  assert.deepEqual(
    h.samples.map((s) => s.population),
    [3, 4, 5],
    "keeps the three most recent samples in order",
  );
}

// --- max(): floors low, tracks the peak across the ring.
{
  const h = new History({ interval: 1 });
  assert.equal(h.max("population", 10), 10, "empty ring falls back to the floor");
  h.tick(1, () => fakeStats(4));
  h.tick(1, () => fakeStats(25));
  h.tick(1, () => fakeStats(9));
  assert.equal(h.max("population", 10), 25, "tracks the peak above the floor");
}

// --- clear(): empties the ring and resets the clock.
{
  const h = new History({ interval: 1 });
  h.tick(0.7, () => fakeStats());
  h.tick(1, () => fakeStats());
  h.clear();
  assert.equal(h.samples.length, 0, "samples emptied");
  assert.equal(h.tick(0.5, () => fakeStats()), false, "clock reset, no early sample");
}

// --- normTrait(): maps a gene value to [0,1] against its range.
{
  const [min, max] = GENES.speed;
  assert.ok(Math.abs(normTrait("speed", min) - 0) < 1e-9, "min → 0");
  assert.ok(Math.abs(normTrait("speed", max) - 1) < 1e-9, "max → 1");
  assert.ok(Math.abs(normTrait("speed", (min + max) / 2) - 0.5) < 1e-9, "mid → 0.5");
}

console.log("HISTORY TEST PASSED");
