// Headless tests for the kill-site feed (`src/killfeed.js`) and its wiring into
// the world. The minimap wash itself needs a browser, but the feed's ring
// bookkeeping and the recency weight are pure and fully testable here, as is the
// contract that recording a kill is a pure view-only observation — it draws no
// rng and is never serialized, so the deterministic stream is untouched.

import assert from "node:assert";
import { KillFeed, killWeight } from "../src/killfeed.js";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";

const approx = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= (eps ?? 1e-9), `${msg}: ${a} vs ${b}`);

// --- killWeight: 1 at the instant of the kill, fading linearly to 0 at maxAge. ---
{
  const maxAge = 10;
  approx(killWeight({ time: 100 }, 100, maxAge), 1, 1e-9, "fresh kill weighs 1");
  approx(killWeight({ time: 100 }, 105, maxAge), 0.5, 1e-9, "half-aged weighs 0.5");
  approx(killWeight({ time: 100 }, 109, maxAge), 0.1, 1e-9, "near-faded weighs 0.1");
  assert.strictEqual(killWeight({ time: 100 }, 110, maxAge), 0, "exactly maxAge → 0");
  assert.strictEqual(killWeight({ time: 100 }, 200, maxAge), 0, "long past → 0");
  // A site somehow stamped in the future (shouldn't happen, but be robust) is 0.
  assert.strictEqual(killWeight({ time: 100 }, 90, maxAge), 0, "future site → 0");
  // Monotone non-increasing across the window.
  let prev = Infinity;
  for (let t = 100; t <= 110; t += 1) {
    const w = killWeight({ time: 100 }, t, maxAge);
    assert.ok(w <= prev + 1e-12, "weight never rises with age");
    prev = w;
  }
}

// --- record stamps the time and keeps newest-last order. ---
{
  const feed = new KillFeed(10, 100);
  assert.deepStrictEqual(feed.sites, [], "starts empty");
  feed.record(10, 20, 5);
  feed.record(30, 40, 7);
  assert.strictEqual(feed.sites.length, 2, "two sites recorded");
  assert.deepStrictEqual(feed.sites[0], { x: 10, y: 20, time: 5 }, "first site stamped");
  assert.deepStrictEqual(feed.sites[1], { x: 30, y: 40, time: 7 }, "second site stamped, newest last");
}

// --- The ring caps at maxSites, evicting the oldest (front) first. ---
{
  const feed = new KillFeed(100, 3);
  for (let i = 0; i < 5; i++) feed.record(i, i, i);
  assert.strictEqual(feed.sites.length, 3, "ring capped at maxSites");
  // The three newest (times 2,3,4) survive; the two oldest were evicted.
  assert.deepStrictEqual(
    feed.sites.map((s) => s.time),
    [2, 3, 4],
    "oldest evicted, newest kept in order",
  );
}

// --- prune drops fully-faded leading sites and keeps the rest. ---
{
  const feed = new KillFeed(10, 100);
  feed.record(0, 0, 0); // age 12 at now=12 → faded
  feed.record(1, 1, 1); // age 11 → faded
  feed.record(2, 2, 5); // age 7 → still alive
  feed.record(3, 3, 11); // age 1 → fresh
  feed.prune(12);
  assert.deepStrictEqual(
    feed.sites.map((s) => s.time),
    [5, 11],
    "only fully-faded leading sites dropped",
  );
  // Pruning again with the same clock is a no-op (idempotent).
  feed.prune(12);
  assert.deepStrictEqual(feed.sites.map((s) => s.time), [5, 11], "prune is idempotent");
  // Pruning before anything has faded keeps everything.
  const fresh = new KillFeed(10, 100);
  fresh.record(0, 0, 100);
  fresh.prune(100);
  assert.strictEqual(fresh.sites.length, 1, "nothing faded → nothing pruned");
}

// --- clear forgets the whole feed. ---
{
  const feed = new KillFeed(10, 100);
  feed.record(1, 2, 3);
  feed.record(4, 5, 6);
  feed.clear();
  assert.deepStrictEqual(feed.sites, [], "clear empties the ring");
}

// --- World.recordKill stamps the live sim-time and draws no rng. ---
{
  const rng = makeRng(7);
  const world = new World(rng, { seed: false });
  world.time = 42;
  const before = rng.getState();
  world.recordKill(123, 456);
  assert.strictEqual(world.killFeed.sites.length, 1, "kill recorded on the world feed");
  assert.deepStrictEqual(
    world.killFeed.sites[0],
    { x: 123, y: 456, time: 42 },
    "site stamped with the live sim-time",
  );
  assert.strictEqual(rng.getState(), before, "recording a kill draws no rng");
}

// --- The feed is view-only: it serializes nothing and a restored world is empty. ---
{
  const rng = makeRng(11);
  const world = new World(rng, { seed: false });
  world.time = 5;
  world.recordKill(10, 10);
  world.recordKill(20, 20);
  const snapshot = world.serialize();
  // Nothing in the snapshot carries the kill sites.
  const json = JSON.stringify(snapshot);
  assert.ok(!json.includes("killFeed"), "snapshot has no killFeed field");
  // A round-trip starts with a fresh, empty feed (refilled by play, not loaded).
  const restored = World.deserialize(snapshot, makeRng(0));
  assert.strictEqual(restored.killFeed.sites.length, 0, "restored world starts with an empty feed");
}

console.log("KILLFEED TEST PASSED");
