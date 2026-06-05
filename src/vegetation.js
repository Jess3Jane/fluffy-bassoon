// The vegetation feedback: the larder's reach back onto the microclimate.
//
// The microclimate (`src/microclimate.js`) is a *static* spatial offset grown
// once from a seed. It shapes which plant kind grows where (`spawnFood`), but
// nothing the plants do shapes it back — the climate map drives the patchwork
// one way only. This module closes that loop: the *standing* larder nudges its
// own local microclimate, so the climate and the plant patchwork become a slow
// two-way coupling instead of one driving the other.
//
// The nudge is *kind-aware*, which is what makes it interesting. Each kind leans
// toward the conditions it already thrives in (sunleaf: warm & wet; moonleaf:
// cool & dry — see `kindClimateScore` in src/plants.js), so a standing stand
// pushes its microclimate *toward its own kind's biome*: a sunleaf thicket warms
// and dampens its understory, a moonleaf stand cools and dries it. That is a
// positive feedback — a patch reinforces the very biome it grows in — so the
// kind boundaries the static seed only *fixed* can now sharpen, drift (as grazing
// thins a stand), and oscillate, rather than sitting forever on the seed's noise.
//
// Two guards keep it from running away (the whole world freezing onto one kind):
//   • bounded — the per-cell lean is squashed through tanh, so even a pure
//     monoculture cell gives a finite nudge, smaller than the static field's own;
//   • mean-respecting — the lean is read *relative to the larder's global mean*,
//     so the globally dominant kind is *penalised* on bare ground (pulling the
//     world back toward an even split) even as each patch sharpens locally. The
//     spatial-average nudge is ~0, so it never globally warms or cools the world.
//
// It is recomputed each step from the live larder (`rebuild`), so it adds **no**
// serialized state: a loaded world rebuilds the identical field from its restored
// food on the next step, and the simulation replays bit-for-bit (`rebuild` and
// sampling draw no rng). At amplitude 0 every offset is 0 and the world behaves
// exactly as it did before the feedback existed.

import { CONFIG } from "./config.js";
import { sampleField } from "./terrain.js";

export class VegetationField {
  constructor(width, height) {
    this.width = width;
    this.height = height;

    const v = CONFIG.vegetation;
    this.cols = v.latticeCols;
    // Square-ish cells: derive the row count from the world's aspect ratio, the
    // way the terrain does, so a cell is about as tall as it is wide.
    this.rows = Math.max(1, Math.round(v.latticeCols * (height / width)));
    this.leanScale = v.leanScale;
    this.warmthAmp = v.warmthAmplitude;
    this.wetnessAmp = v.wetnessAmplitude;

    // The per-cell signed lean of the standing larder (sunleaf +1, moonleaf −1),
    // shaped as a wrapping value-noise lattice so `sampleField` can interpolate it
    // smoothly and seamlessly across the toroidal world. Filled by `rebuild`; a
    // fresh field is all-zero, so it reads as no nudge until the first rebuild.
    this._lean = {
      cols: this.cols,
      rows: this.rows,
      v: new Float64Array(this.cols * this.rows),
    };
    this._meanLean = 0;
  }

  // Recompute the field from the live larder: bin every pellet into its cell as a
  // signed vote (+1 sunleaf, −1 moonleaf) and record the global mean so the field
  // can be read *relative* to it. O(food + cells), draws no rng, so it leaves the
  // deterministic stream untouched and rebuilds identically from a restored save.
  rebuild(food) {
    const data = this._lean.v;
    data.fill(0);
    const { cols, rows } = this;
    for (const f of food) {
      if (f.dead) continue; // defensive: the step-boundary larder carries no corpses
      let c = Math.floor((f.x / this.width) * cols);
      let r = Math.floor((f.y / this.height) * rows);
      c = ((c % cols) + cols) % cols;
      r = ((r % rows) + rows) % rows;
      data[r * cols + c] += f.kind === 1 ? -1 : 1;
    }
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    this._meanLean = sum / data.length;
  }

  // The centred, bounded canopy lean at a world point, in (−1, 1): positive where
  // sunleaf stands dominate (relative to the larder's mean), negative where
  // moonleaf does, ~0 on bare or evenly-mixed ground. The interpolated lean is
  // taken relative to the global mean (mean-respecting) and squashed through tanh
  // (bounded), scaled so a cell a few plants past the mean already reads strongly.
  _signalAt(x, y) {
    const lean =
      sampleField(this._lean, x / this.width, y / this.height) - this._meanLean;
    return Math.tanh(lean / this.leanScale);
  }

  // The vegetation warmth nudge at a point: positive (warmer) where sunleaf
  // stands dominate, negative (cooler) where moonleaf does — each kind pulling its
  // understory toward the warmth it thrives in. Added to the static microclimate
  // offset before a creature's stress (or a new plant's kind) is judged.
  warmthOffsetAt(x, y) {
    return this.warmthAmp * this._signalAt(x, y);
  }

  // The vegetation wetness nudge at a point: positive (damper) under sunleaf,
  // negative (drier) under moonleaf, the same sign as the warmth nudge so a stand
  // pushes both axes toward its own kind's preferred climate at once.
  wetnessOffsetAt(x, y) {
    return this.wetnessAmp * this._signalAt(x, y);
  }
}
