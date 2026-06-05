// The microclimate: a *spatial* axis for the climate, layered under the global
// season/weather clock. The season and weather (`src/weather.js`) move the whole
// world up and down the warmth/wetness axes *together over time*; the
// microclimate is the orthogonal half of that — a static, per-region *offset*
// that makes one corner of the map run warmer or drier than another at the very
// same instant. A sun-baked, dry south; a cool, damp north.
//
// It is grown once from a seed using the same wrapping value-noise as the
// terrain (`noiseField` / `sampleField`), so it tiles seamlessly across the
// toroidal world and is reproduced bit-for-bit from that single seed on
// save/load — the field itself never needs to be stored, only the number that
// grows it. Generation runs on its own internal rng, so it never perturbs the
// main simulation stream. Two independent fields give the two axes their own,
// uncorrelated geography (the warm regions aren't the wet ones).
//
// The point is selection across space: a creature's `climateStress`
// (`src/genome.js`) reads the *local* warmth/wetness — the global level plus the
// offset here, clamped onto [0, 1] — so `warmthPref` / `wetnessPref` partition
// creatures across the map, not only across the year. A warm-adapted clade is
// pulled to settle the warm regions while a cold-adapted one holds the cool
// ones, turning the world into a true mosaic of climate niches alongside the
// terrain and plant-kind patchwork already there.

import { CONFIG } from "./config.js";
import { makeRng } from "./rng.js";
import { noiseField, sampleField } from "./terrain.js";

export class Microclimate {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.seed = seed >>> 0;

    const m = CONFIG.microclimate;
    this.warmthAmp = m.warmthAmplitude;
    this.wetnessAmp = m.wetnessAmplitude;

    // Two independent wrapping noise lattices, drawn in order off a private rng
    // seeded from the map seed — so the warmth and wetness geographies are
    // uncorrelated, and the whole field regrows identically from the seed alone.
    const rng = makeRng(this.seed);
    this._warmth = noiseField(rng, m.latticeCols, m.latticeRows);
    this._wetness = noiseField(rng, m.latticeCols, m.latticeRows);
  }

  // Sample a field at a world point, returning a *centred* offset in
  // [-amp, +amp]: the raw [0, 1) value noise folded around its 0.5 midpoint and
  // scaled by the amplitude, so a region reads as warmer/cooler (or wetter/drier)
  // than the global average rather than as an absolute level.
  _offset(field, x, y, amp) {
    const s = sampleField(field, x / this.width, y / this.height);
    return (s - 0.5) * 2 * amp;
  }

  // The local warmth offset at a point, in [-warmthAmp, +warmthAmp]. Added to
  // the global `climateWarmth` before stress is judged.
  warmthOffsetAt(x, y) {
    return this._offset(this._warmth, x, y, this.warmthAmp);
  }

  // The local wetness offset at a point, in [-wetnessAmp, +wetnessAmp]. Added to
  // the global `climateWetness` before stress is judged.
  wetnessOffsetAt(x, y) {
    return this._offset(this._wetness, x, y, this.wetnessAmp);
  }
}
