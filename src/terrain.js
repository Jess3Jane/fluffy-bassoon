// The terrain: a static map of tiles laid under the world that shapes where
// life thrives. Most of the world is ordinary grassland, dotted with three kinds
// of patch — water (slow to wade, nothing grows), fertile soil (plants spring up
// thickest here), and barren ground (sparse pickings). It is generated once from
// a seed using wrapping value-noise, so it tiles seamlessly across the toroidal
// world and is reproduced bit-identically from that single seed on save/load —
// the map itself never needs to be stored, only the number that grows it.

import { CONFIG } from "./config.js";
import { makeRng } from "./rng.js";

// Tile kinds. The numeric values index the lookup arrays below and are what the
// tile grid stores, so keep them stable.
export const TILE = { GRASS: 0, WATER: 1, FERTILE: 2, BARREN: 3 };
export const TILE_NAMES = ["grass", "water", "fertile", "barren"];

// Per-tile gameplay modifiers, assembled from CONFIG so all tuning lives in one
// place. `SPEED` multiplies how far a creature travels over a tile (water bogs
// movement down); `FERTILITY` is the chance a random food-spawn attempt landing
// on the tile takes root (0 on water, richest on fertile soil).
function modifiers() {
  const t = CONFIG.terrain;
  return {
    speed: [t.speed.grass, t.speed.water, t.speed.fertile, t.speed.barren],
    fertility: [
      t.fertility.grass,
      t.fertility.water,
      t.fertility.fertile,
      t.fertility.barren,
    ],
  };
}

export class Terrain {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.seed = seed >>> 0;

    const t = CONFIG.terrain;
    // Square-ish tiles: pick the row count so a tile is about as tall as it is
    // wide, given the world's aspect ratio.
    this.cols = t.cols;
    this.rows = Math.max(1, Math.round(t.cols * (height / width)));
    this.tileW = width / this.cols;
    this.tileH = height / this.rows;

    const { speed, fertility } = modifiers();
    this._speed = speed;
    this._fertility = fertility;

    this.tiles = new Uint8Array(this.cols * this.rows);
    this._generate();
  }

  _generate() {
    const t = CONFIG.terrain;
    const rng = makeRng(this.seed);
    // Two independent noise fields: elevation carves out the water; moisture
    // decides fertile vs. barren on the dry land.
    const elev = noiseField(rng, t.latticeCols, t.latticeRows);
    const moist = noiseField(rng, t.latticeCols, t.latticeRows);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const u = (c + 0.5) / this.cols;
        const v = (r + 0.5) / this.rows;
        const e = sampleField(elev, u, v);
        const m = sampleField(moist, u, v);

        let type = TILE.GRASS;
        if (e < t.waterLevel) type = TILE.WATER;
        else if (m > t.fertileLevel) type = TILE.FERTILE;
        else if (m < t.barrenLevel) type = TILE.BARREN;

        this.tiles[r * this.cols + c] = type;
      }
    }
  }

  // Flat tile index for a world point, wrapping toroidally so edge lookups match
  // the seamless noise.
  indexAt(x, y) {
    let c = Math.floor(x / this.tileW);
    let r = Math.floor(y / this.tileH);
    c = ((c % this.cols) + this.cols) % this.cols;
    r = ((r % this.rows) + this.rows) % this.rows;
    return r * this.cols + c;
  }

  typeAt(x, y) {
    return this.tiles[this.indexAt(x, y)];
  }

  // Movement multiplier at a point: 1 on open ground, lower in water.
  speedAt(x, y) {
    return this._speed[this.tiles[this.indexAt(x, y)]];
  }

  // Chance in [0, 1] that food takes root at a point, so plants concentrate on
  // fertile soil and never sprout on water.
  fertilityAt(x, y) {
    return this._fertility[this.tiles[this.indexAt(x, y)]];
  }

  // Fraction of the map that is each tile kind — handy for tests and tuning.
  composition() {
    const counts = [0, 0, 0, 0];
    for (const t of this.tiles) counts[t]++;
    return counts.map((n) => n / this.tiles.length);
  }
}

// Build a wrapping lattice of random values in [0, 1) for value noise. Exported
// so the microclimate field can reuse the same seamless-noise machinery.
export function noiseField(rng, cols, rows) {
  const v = new Float64Array(cols * rows);
  for (let i = 0; i < v.length; i++) v[i] = rng();
  return { cols, rows, v };
}

// Sample a noise field at (u, v) in [0, 1) with smoothstep'd bilinear
// interpolation, wrapping the lattice so the result tiles seamlessly. Exported
// alongside `noiseField` for the microclimate field.
export function sampleField(field, u, v) {
  const { cols, rows, v: data } = field;
  const fx = u * cols;
  const fy = v * rows;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const xa = ((x0 % cols) + cols) % cols;
  const ya = ((y0 % rows) + rows) % rows;
  const xb = (xa + 1) % cols;
  const yb = (ya + 1) % rows;

  const a = data[ya * cols + xa];
  const b = data[ya * cols + xb];
  const c = data[yb * cols + xa];
  const d = data[yb * cols + xb];
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

// Smoothstep: eases the 0→1 ramp so interpolated noise has no hard creases.
function smooth(t) {
  return t * t * (3 - 2 * t);
}
