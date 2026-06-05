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
// 1 harsh) tilts the facilitation term about a reference, so the optimum is not a
// single global band but *diverges with the local conditions* — shelter pays its
// fecundity cost on harsh (barren) ground, where the optimum climbs, and doesn't on
// benign (fertile) ground, where cheap seeding wins and the optimum falls. At
// `harshnessRef` the tilt vanishes, so the default (harshness-omitted) call
// reproduces the old curve, and the world is unchanged where conditions sit at the
// reference.
//
// Harshness tilts the shelter through two terms — the original level tilt plus a new
// *non-saturating* one, the lesson of the spatial-canopy-sort work:
//   • `facScale` — the original level tilt on the saturating `tanh` shelter (up on
//     harsh, down on benign). It moves the curve's *height* (and its optimum) but,
//     because `tanh` saturates, barely its *steepness*: high canopy on barren ground
//     was only ~0.94× as fit as low, so the spatial selection *differential* — what
//     dispersal and drift have to concentrate to realise a standing sort — was tiny.
//   • `harshShelterLinear` — a *non-saturating* (linear-in-canopy) shelter bonus that
//     switches on only above the reference (`harshExcess`), so on barren soil high
//     canopy keeps gaining shelter past where the `tanh` flattens. This lifts the
//     barren optimum and, crucially, keeps the harsh curve *steep* (not a tall
//     plateau), so high canopy is meaningfully fitter than low there — the precondition
//     the realised sort needed (the task's lever (a)).
// Both vanish at `harshnessRef`, so the default (harshness-omitted) call reproduces the
// old curve exactly (see `test/canopy.test.mjs` for its shape and `test/canopy-niche.test.mjs`
// for the harshness-driven shift). (A companion benign-side fecundity tilt was tried —
// steepening the cost on fertile ground to also un-clamp the benign end of the spawn
// probability — but it starved the food-rich majority of the map and tipped populations
// into extinction, so the realisation instead leans on direct viability selection,
// `canopyViability` below, which doesn't depend on the saturating spawn channel.)
export function canopyGermination(c, harshness = CONFIG.vegetation.canopy.harshnessRef) {
  const cfg = CONFIG.vegetation.canopy;
  const fecundity = Math.max(0, 1 - cfg.fecundityCost * c);
  // How much harsher than the reference this ground is (0 at/below it), gating the
  // non-saturating harsh-side bonus so benign and reference ground are untouched.
  const harshExcess = Math.max(0, harshness - cfg.harshnessRef);
  // Level tilt: harsher than the reference makes canopy worth more (a higher-peaking
  // curve), benign makes it worth less. Clamped ≥ 0 so an extreme-benign spot zeroes
  // the benefit rather than inverting it into a shelter *penalty*.
  const facScale = Math.max(0, 1 + cfg.harshnessGain * (harshness - cfg.harshnessRef));
  const shelter =
    1 +
    cfg.facilitation * facScale * Math.tanh(cfg.facilitationSlope * c) +
    // Non-saturating harsh-side bonus: keeps high canopy gaining shelter on barren
    // soil past where the tanh flattens, so the harsh curve is steep (not just tall).
    cfg.harshShelterLinear * harshExcess * c;
  return fecundity * shelter;
}

// The peak germination achievable at a given harshness (the value at the local
// optimum), memoised per harshness keyed on the curve's tuning so it stays correct
// if the config is changed between calls (as a test may do). Harshness is effectively
// a handful of terrain-driven values, so the cache stays tiny and every call after
// warmup is a map lookup. Used only to *normalise* viability below; it never changes
// the germination curve itself.
const _germMaxCache = new Map();
function canopyGermMax(harshness) {
  const cfg = CONFIG.vegetation.canopy;
  const key = `${Math.round(harshness * 1e4)}|${cfg.fecundityCost}|${cfg.facilitation}|${cfg.facilitationSlope}|${cfg.harshnessGain}|${cfg.harshnessRef}|${cfg.harshShelterLinear}`;
  let m = _germMaxCache.get(key);
  if (m === undefined) {
    m = 0;
    for (let c = 0; c <= 1.00001; c += 0.01) {
      const g = canopyGermination(c, harshness);
      if (g > m) m = g;
    }
    _germMaxCache.set(key, m);
  }
  return m;
}

// A standing plant's *viability* at its location, in (0, 1]: its germination value
// for the local harshness divided by the best achievable there, so it is 1 exactly
// at the local canopy optimum and falls off as the plant's `canopyAmp` mismatches
// what that ground rewards. This is the lever that finally *realises* the spatial
// canopy sort: the differential-seeding channel (germination shaping which random
// spot gets a sprout) turned out far too weak — swamped by mutation and the fine-
// grained terrain mosaic, the standing larder just sat at the mutation-centred 0.5.
// `World.update` instead withers a plant each step with a chance proportional to
// `1 − viability`, so a plant badly matched to its ground is *culled directly* and
// the standing distribution is pulled onto the local optimum (strong, local viability
// selection) rather than nudged through the noisy seeding rate. A plant sitting at its
// local optimum never withers from mismatch; the further off, the faster it goes.
export function canopyViability(c, harshness) {
  const max = canopyGermMax(harshness);
  return max > 0 ? canopyGermination(c, harshness) / max : 1;
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
