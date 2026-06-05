// A fixed-capacity ring of ecosystem snapshots, sampled at a regular *sim-time*
// cadence so the charts read the same whether the world is running at 1× or 8×.
// Sampling by sim-time (not frames) means the x-axis is a consistent slice of
// world history regardless of speed, and the buffer never grows without bound.

import { GENES } from "./genome.js";

export class History {
  constructor({ capacity = 240, interval = 1 } = {}) {
    this.capacity = capacity; // max snapshots retained (oldest dropped first)
    this.interval = interval; // sim-seconds between snapshots
    this.samples = []; // oldest → newest
    this._accum = 0; // sim-seconds since the last snapshot
  }

  // Drive from the sim loop. Advances an internal clock by `dt` sim-seconds and,
  // once a full interval has elapsed, records a snapshot. `getStats` is called
  // lazily — only when a sample is actually due — so the per-step cost is just
  // the clock arithmetic. Returns true if a snapshot was taken.
  tick(dt, getStats) {
    this._accum += dt;
    if (this._accum < this.interval) return false;
    // Carry the remainder so cadence doesn't drift; a single dt never spans
    // more than one interval in practice, so one snapshot per crossing is right.
    this._accum -= this.interval;
    this.record(getStats());
    return true;
  }

  // Pull the handful of series we chart out of a full stats() object, so the
  // ring holds compact rows rather than references to whole-world aggregates.
  record(stats) {
    this.samples.push({
      population: stats.population,
      carnivores: stats.carnivores,
      species: stats.species,
      geneSpecies: stats.geneSpecies,
      isolation: stats.isolation,
      food: stats.food,
      diet: stats.avg.diet,
      forage: stats.avg.forage,
      hunt: stats.avg.hunt,
      warmthPref: stats.avg.warmthPref,
      wetnessPref: stats.avg.wetnessPref,
      speed: stats.avg.speed,
      size: stats.avg.size,
      sense: stats.avg.sense,
    });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  clear() {
    this.samples.length = 0;
    this._accum = 0;
  }

  // Largest value of `key` across the ring, never below `floor`, for y-scaling.
  max(key, floor = 1) {
    let m = floor;
    for (const s of this.samples) if (s[key] > m) m = s[key];
    return m;
  }
}

// Normalise a trait value into [0, 1] against its gene's legal range, so traits
// with different units (speed, size, …) can share a 0–1 chart axis.
export function normTrait(name, value) {
  const [min, max] = GENES[name];
  return (value - min) / (max - min);
}
