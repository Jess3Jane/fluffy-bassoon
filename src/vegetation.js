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
//
// The feedback's *strength* is no longer a flat per-kind constant: each pellet
// carries a heritable `canopyAmp` gene (in [0, 1], serialized with the larder) for
// how strongly it shapes its understory, and its lean vote is scaled by
// `canopyAmp / neutral` — a neutral plant votes the old ±1, an over-/under-invester
// more/less. The gene passes from a sprout's nearest same-kind parent (single-
// parent inheritance, in `World.parentCanopyAt`, so a mutant's deviation survives
// to be selected on), and `canopyGermination` puts it under two opposing pressures
// — a falling fecundity cost vs. a saturating facilitation benefit — so the
// population evolves the gain toward an interior optimum and defends it against
// drift, rather than the config fixing it. The helpers for that selection live
// here; the field math above only *reads* the resulting per-plant investment.

import { CONFIG } from "./config.js";
import { sampleField } from "./terrain.js";
import { clamp01 } from "./math.js";

// The germination multiplier a sprout gets from its parent's canopy investment
// `c` at a spot of local `harshness` — the selection gradient on the heritable
// trait, and the source of truth for both pressures that shape it. Two opposing
// terms, so an interior optimum emerges from their balance rather than being
// dialled in:
//   • a *fecundity cost*, linear and falling — building canopy diverts from seed,
//     so heavier investers germinate less (`1 − fecundityCost·c`), favouring cheap
//     light-touch seeding; floored at 0 so it can't go negative.
//   • a *facilitation benefit*, saturating and rising — a parent's own canopy
//     shelters its seedlings (`1 + facilitation·tanh(facilitationSlope·c)`), a
//     private return with diminishing marginal value, favouring investment.
// Their product is monotone-up where the ramping shelter outweighs the linear tax
// and monotone-down once the tax wins, so germination peaks at an interior canopy
// the population evolves toward and defends against drift — the feedback's gain is
// now a selected trait, not a constant.
//
// The shelter benefit is *condition-dependent*: `harshness` (in [0, 1], 0 benign →
// 1 harsh) scales the facilitation term about a reference, so the optimum is not a
// single global band but *diverges with the local conditions* — shelter pays its
// fecundity cost on harsh (barren) ground, where the optimum climbs, and doesn't on
// benign (fertile) ground, where cheap seeding wins and the optimum falls. At
// `harshnessRef` the scale is exactly 1, so the default (harshness-omitted) call
// reproduces the old curve, and the world is unchanged where conditions sit at the
// reference. A neutral/absent parent reads as no net effect only to the extent the
// two terms cancel there; the curve is otherwise the whole story (see
// `test/canopy.test.mjs` for its shape and `test/canopy-niche.test.mjs` for the
// harshness-driven shift and the spatial sorting it produces).
export function canopyGermination(c, harshness = CONFIG.vegetation.canopy.harshnessRef) {
  const cfg = CONFIG.vegetation.canopy;
  const fecundity = Math.max(0, 1 - cfg.fecundityCost * c);
  // Local harshness tilts the shelter benefit: harsher than the reference makes
  // canopy worth more (a steeper, higher-peaking curve), benign makes it worth
  // less. Clamped ≥ 0 so an extreme-benign spot zeroes the benefit rather than
  // inverting it into a shelter *penalty*.
  const facScale = Math.max(0, 1 + cfg.harshnessGain * (harshness - cfg.harshnessRef));
  const shelter = 1 + cfg.facilitation * facScale * Math.tanh(cfg.facilitationSlope * c);
  return fecundity * shelter;
}

// A new sprout's canopy gene: its nearest same-kind parent's investment (read off
// the fine canopy lattice) with a small gaussian mutation, clamped to [0, 1]. The
// lattice is fine enough that a cell holds ~one plant, so this copies a near-parent
// and *preserves* a mutant's deviation across generations (real heritability)
// rather than regressing it to a broad regional mean — which is what lets selection
// act on the trait at all.
export function inheritCanopy(parentAmp, rng) {
  return clamp01(parentAmp + rng.normal() * CONFIG.vegetation.canopy.mutationStep);
}

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
    this.canopyNeutral = v.canopy.neutral;

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
      const kind = f.kind === 1 ? 1 : 0;
      const amp = f.canopyAmp ?? this.canopyNeutral;
      let c = Math.floor((f.x / this.width) * cols);
      let r = Math.floor((f.y / this.height) * rows);
      c = ((c % cols) + cols) % cols;
      r = ((r % rows) + rows) % rows;
      // The lean vote is scaled by the plant's *heritable* canopy investment
      // (relative to the neutral reference, so a neutral plant votes the old ±1),
      // so a stand of heavy investers shapes its understory more strongly than a
      // light one — the feedback's strength is now the evolved trait, not a flat ±1.
      data[r * cols + c] += (kind === 1 ? -amp : amp) / this.canopyNeutral;
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
