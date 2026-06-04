// Scent / pheromone plumes: a drifting chemical field that turns the prevailing
// wind into an information channel. Creatures lay faint markers as they live —
// a "food here" plume while feeding, a "danger" (blood/death) plume where one is
// killed — and others smell them on the air, drawn toward or repelled from them
// by diet. The same wind that already herds bodies and rakes the larder now
// smears these plumes downwind, so a storm streaks scent into directional trails
// and flocking / avoidance can emerge from a field the world was already moving.
//
// Unlike the weather layer, this is *not* a pure function of sim-time: plumes are
// born from creature actions, so the field is real state that must be serialized
// to make a save a true continuation. Emission, drift, and decay are all
// deterministic (no fresh rng draws), so a restored field replays bit-identically
// alongside the rng-driven simulation around it.

import { CONFIG } from "./config.js";
import { SpatialGrid } from "./grid.js";
import { wrapDelta } from "./math.js";

// Plume kinds. Numeric values index nothing critical, but stay stable so saved
// plumes deserialize to the same meaning.
export const SCENT = { FOOD: 0, DANGER: 1 };

export class ScentField {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // Each plume: { x, y, kind, strength }. Strength fades over time; a plume is
    // dropped once it falls below the floor.
    this.plumes = [];
    // Spatial index over the plumes, rebuilt each step so "smell nearby" queries
    // stay cheap as the field grows, exactly like the food and creature grids.
    this.grid = new SpatialGrid(width, height, CONFIG.spatial.cellSize);
  }

  // Lay a plume of `kind` at a point. Caps the field at `maxCount` by evicting
  // the oldest plume, so a busy world can't grow the field without bound.
  emit(x, y, kind, strength) {
    if (this.plumes.length >= CONFIG.scent.maxCount) this.plumes.shift();
    this.plumes.push({ x, y, kind, strength });
  }

  // (Re)build the spatial index from the current plumes. Called once per step
  // before the creature loop, so creatures smell the field as it stood at the
  // top of the step (plumes emitted during the loop join the index next step,
  // just like newborn creatures don't get a turn until the following step).
  rebuild() {
    this.grid.rebuild(this.plumes);
  }

  // Drift every plume by (dx, dy), wrapping toroidally. Driven by the storm wind
  // in `World.update` — scent is airborne, so it rides the wind faster than the
  // heavier food pellets do, smearing into downwind trails when a gale blows.
  drift(dx, dy) {
    for (const p of this.plumes) {
      p.x = wrap(p.x + dx, this.width);
      p.y = wrap(p.y + dy, this.height);
    }
  }

  // Fade the whole field and drop spent plumes. Linear decay keeps it simple and
  // deterministic; a stronger plume (a death) lingers proportionally longer than
  // a feeding mark before it thins below the floor and is forgotten.
  decay(dt) {
    const loss = CONFIG.scent.decayPerSecond * dt;
    let spent = false;
    for (const p of this.plumes) {
      p.strength -= loss;
      if (p.strength <= CONFIG.scent.minStrength) spent = true;
    }
    if (spent) this.plumes = this.plumes.filter((p) => p.strength > CONFIG.scent.minStrength);
  }

  // Accumulate a steering vector for a creature smelling the field around it.
  // The returned (dx, dy) points the way the scent wants to pull the creature —
  // already sign-corrected for its diet — with a magnitude that grows with how
  // strong and close the surrounding plumes are:
  //
  //   * FOOD plumes attract, weighted by herbivory (1 − diet): a plant-eater is
  //     drawn to where others are grazing; a pure carnivore ignores greens.
  //   * DANGER plumes split the world by diet — a herbivore flees the blood
  //     scent while a carnivore is drawn to it, so the same death-marker repels
  //     prey and summons predators, an information asymmetry on one field.
  //
  // Each kind's pull is additionally scaled by the smeller's heritable *trust*
  // in that channel (`foodTrust`, `alarmTrust`), so a creature can evolve to
  // heed or ignore each plume independently of its diet — the deaf ear that lets
  // a deceiver shout "danger" without scattering itself. Trust defaults to 1 so
  // a caller that doesn't pass it (e.g. tests) gets the old full-response field.
  //
  // Each plume contributes a unit vector toward (or away from) it, scaled by a
  // linear distance falloff and its strength, so near/strong plumes dominate and
  // a plume at the edge of `radius` barely registers.
  steer(x, y, diet, radius, foodTrust = 1, alarmTrust = 1) {
    let dx = 0;
    let dy = 0;
    const r2 = radius * radius;
    const foodAttract = CONFIG.scent.foodAttract * foodTrust;
    const dangerResponse = CONFIG.scent.dangerResponse * alarmTrust;
    this.grid.forEachNear(x, y, radius, (p) => {
      const ddx = wrapDelta(p.x - x, this.width);
      const ddy = wrapDelta(p.y - y, this.height);
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 > r2 || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      // Unit vector toward the plume, scaled by linear falloff × strength. (ddx/d
      // normalises; (1 − d/radius) fades it to nothing at the sensing edge.)
      const falloff = ((1 - d / radius) * p.strength) / d;
      let w;
      if (p.kind === SCENT.FOOD) {
        w = falloff * (1 - diet) * foodAttract;
      } else {
        // Herbivore (diet 0) → −1 (flee); carnivore (diet 1) → +1 (investigate).
        w = falloff * (2 * diet - 1) * dangerResponse;
      }
      dx += ddx * w;
      dy += ddy * w;
    });
    return { dx, dy };
  }

  // Compact, JSON-safe snapshot: one [x, y, kind, strength] tuple per plume.
  serialize() {
    return this.plumes.map((p) => [p.x, p.y, p.kind, p.strength]);
  }

  // Rebuild a field from a `serialize()` snapshot. Tolerates a missing array so
  // older saves (or an empty field) load as an empty field rather than throwing.
  static deserialize(data, width, height) {
    const field = new ScentField(width, height);
    if (Array.isArray(data)) {
      field.plumes = data.map(([x, y, kind, strength]) => ({ x, y, kind, strength }));
    }
    return field;
  }
}

// Wrap a coordinate into [0, size) on a toroidal axis.
function wrap(v, size) {
  return ((v % size) + size) % size;
}
