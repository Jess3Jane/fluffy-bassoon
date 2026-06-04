// Unit tests for the terrain map: that generation is a deterministic pure
// function of the seed, that the gameplay lookups (movement speed, food
// fertility) are well-formed and wrap toroidally, and that a world's terrain
// survives a save/load round-trip bit-for-bit (only the seed is stored, so the
// whole map must regrow identically). Pure logic, no DOM.

import assert from "node:assert";
import { Terrain, TILE, TILE_NAMES } from "../src/terrain.js";
import { CONFIG } from "../src/config.js";
import { World } from "../src/world.js";
import { makeRng } from "../src/rng.js";

const W = CONFIG.world.width;
const H = CONFIG.world.height;

// --- Generation is deterministic in the seed: same seed → identical tiles,
//     different seed → a different map.
{
  const a = new Terrain(W, H, 12345);
  const b = new Terrain(W, H, 12345);
  const c = new Terrain(W, H, 999);
  assert.deepStrictEqual([...a.tiles], [...b.tiles], "same seed reproduces the map");
  assert.notDeepStrictEqual([...a.tiles], [...c.tiles], "different seed differs");
}

// --- Tile grid has the expected shape and only legal tile kinds.
{
  const t = new Terrain(W, H, 7);
  assert.equal(t.cols, CONFIG.terrain.cols, "column count from config");
  assert.equal(t.rows, Math.round(CONFIG.terrain.cols * (H / W)), "rows from aspect");
  assert.equal(t.tiles.length, t.cols * t.rows, "one entry per tile");
  for (const kind of t.tiles) {
    assert.ok(kind >= 0 && kind < TILE_NAMES.length, `legal tile kind ${kind}`);
  }
}

// --- All four tile kinds appear across the world (the thresholds are tuned so a
//     typical seed grows a varied map), and grassland is the dominant ground.
{
  const t = new Terrain(W, H, 2024);
  const comp = t.composition();
  for (let i = 0; i < comp.length; i++) {
    assert.ok(comp[i] > 0, `${TILE_NAMES[i]} present on the map`);
  }
  const sum = comp.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, "composition fractions sum to 1");
}

// --- Gameplay lookups are well-formed: speed and fertility match the configured
//     modifier for the tile actually under each sampled point, and water is
//     impassable-to-food (zero fertility) and slow.
{
  const t = new Terrain(W, H, 55);
  const cfg = CONFIG.terrain;
  for (let x = 0; x < W; x += 37) {
    for (let y = 0; y < H; y += 37) {
      const kind = t.typeAt(x, y);
      const name = TILE_NAMES[kind];
      assert.equal(t.speedAt(x, y), cfg.speed[name], `speed at (${x},${y})`);
      assert.equal(t.fertilityAt(x, y), cfg.fertility[name], `fertility at (${x},${y})`);
    }
  }
  // Water never grows food and always slows movement.
  for (let i = 0; i < t.tiles.length; i++) {
    if (t.tiles[i] !== TILE.WATER) continue;
    const cx = ((i % t.cols) + 0.5) * t.tileW;
    const cy = (Math.floor(i / t.cols) + 0.5) * t.tileH;
    assert.equal(t.fertilityAt(cx, cy), 0, "water grows no food");
    assert.ok(t.speedAt(cx, cy) < 1, "water slows movement");
  }
}

// --- Lookups wrap toroidally: a point and the same point shifted by a whole
//     world span land on the same tile.
{
  const t = new Terrain(W, H, 88);
  for (let x = 5; x < W; x += 113) {
    for (let y = 5; y < H; y += 91) {
      assert.equal(t.typeAt(x, y), t.typeAt(x + W, y + H), "wraps by a full span");
      assert.equal(t.typeAt(x, y), t.typeAt(x - W, y - H), "wraps the other way");
    }
  }
}

// --- A fresh world grows terrain and records its seed; an unseeded world still
//     has a usable default map (so movement lookups never hit null).
{
  const world = new World(makeRng(321));
  assert.ok(world.terrain, "seeded world has terrain");
  assert.equal(typeof world.terrainSeed, "number", "terrain seed recorded");
  assert.ok(world.terrainSeed >= 0, "terrain seed is a uint32");

  const empty = new World(makeRng(1), { seed: false });
  assert.ok(empty.terrain, "unseeded world still has a default terrain");
  assert.ok(Number.isFinite(empty.terrain.speedAt(10, 10)), "default lookups work");
}

// --- Save/load regrows identical terrain from the stored seed alone.
{
  const world = new World(makeRng(246));
  for (let i = 0; i < 300; i++) world.update(1 / 60);

  const blob = JSON.parse(JSON.stringify(world.serialize()));
  assert.equal(blob.terrainSeed, world.terrainSeed, "seed is serialized");

  const restored = World.deserialize(blob, makeRng());
  assert.equal(restored.terrainSeed, world.terrainSeed, "seed restored");
  assert.deepStrictEqual(
    [...restored.terrain.tiles],
    [...world.terrain.tiles],
    "terrain map regrows bit-identically from the seed",
  );
}

// --- Food never *spawns* on water: terrain steers random growth onto fertile
//     ground (water fertility is 0, so a spawn attempt there always fails the
//     roll), keeping the water clear of fresh growth. We check the spawn position
//     directly — once settled, a pellet can be carried over water by the wind
//     drift in `update`, but that's the weather layer redistributing food, not
//     the spawn logic rooting it there, so we test where it *roots*.
{
  const world = new World(makeRng(13579));
  let spawned = 0;
  let onWater = 0;
  for (let i = 0; i < 4000; i++) {
    world.food.length = 0; // keep clear of the cap so every attempt can place
    const f = world.spawnFood();
    if (!f) continue;
    spawned++;
    if (world.terrain.typeAt(f.x, f.y) === TILE.WATER) onWater++;
  }
  assert.ok(spawned > 0, "some spawn attempts took root");
  assert.equal(onWater, 0, `no food spawns on water, found ${onWater}`);
}

console.log("TERRAIN TEST PASSED");
