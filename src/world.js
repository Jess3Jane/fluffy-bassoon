// The world owns all entities and advances the simulation. Neighbour queries
// (nearest food, nearest prey, contact) go through uniform spatial grids
// (`src/grid.js`) so they stay cheap as populations grow, instead of scanning
// every entity on every lookup.

import { CONFIG } from "./config.js";
import { Creature } from "./creature.js";
import { SpatialGrid } from "./grid.js";
import { GENES } from "./genome.js";
import { wrapDistSq } from "./math.js";

// Largest a creature's body can get, used to size contact-query windows.
const MAX_CREATURE_RADIUS = CONFIG.creature.radius * GENES.size[1];

export class World {
  constructor(rng) {
    this.rng = rng;
    this.width = CONFIG.world.width;
    this.height = CONFIG.world.height;
    this.creatures = [];
    this.food = []; // array of { x, y, dead? }

    // Spatial indices, rebuilt each step before the creature loop runs.
    this.foodGrid = new SpatialGrid(this.width, this.height, CONFIG.spatial.cellSize);
    this.creatureGrid = new SpatialGrid(this.width, this.height, CONFIG.spatial.cellSize);

    this.foodSpawnAccumulator = 0;
    this.time = 0;
    this.births = 0;
    this.deaths = 0;
    this.kills = 0;
    this.peakPopulation = 0;

    this.seed();
  }

  seed() {
    for (let i = 0; i < CONFIG.food.startCount; i++) this.spawnFood();
    for (let i = 0; i < CONFIG.creature.startCount; i++) {
      this.creatures.push(Creature.random(this, this.rng));
    }
    this.peakPopulation = this.creatures.length;
  }

  spawnFood(x, y) {
    if (this.food.length >= CONFIG.food.maxCount) return;
    this.food.push({
      x: x ?? this.rng.range(0, this.width),
      y: y ?? this.rng.range(0, this.height),
    });
  }

  // Nearest food to a point within `radius`, or null. Uses the food grid.
  nearestFood(x, y, radius) {
    let best = null;
    let bestD = radius * radius;
    this.foodGrid.forEachNear(x, y, radius, (f) => {
      if (f.dead) return;
      const d = wrapDistSq(x, y, f.x, f.y, this.width, this.height);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    });
    return best;
  }

  // Nearest creature `predator` is able to eat, within `radius`, or null.
  // Relies on Creature.canEat for the size/diet rules.
  nearestPrey(predator, radius) {
    let best = null;
    let bestD = radius * radius;
    this.creatureGrid.forEachNear(predator.x, predator.y, radius, (c) => {
      if (c === predator || !c.alive || !predator.canEat(c)) return;
      const d = wrapDistSq(predator.x, predator.y, c.x, c.y, this.width, this.height);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    return best;
  }

  // Nearest catchable creature actually in contact with `predator`, or null.
  // Contact means the two bodies overlap (sum of radii). The query window is
  // padded by the largest possible prey radius so no contact is missed.
  preyInReach(predator) {
    const window = predator.radius + MAX_CREATURE_RADIUS;
    let best = null;
    let bestD = Infinity;
    this.creatureGrid.forEachNear(predator.x, predator.y, window, (c) => {
      if (c === predator || !c.alive || !predator.canEat(c)) return;
      const reach = predator.radius + c.radius;
      const d = wrapDistSq(predator.x, predator.y, c.x, c.y, this.width, this.height);
      if (d <= reach * reach && d < bestD) {
        bestD = d;
        best = c;
      }
    });
    return best;
  }

  // Mark food within `radius` of a point as eaten and return the count. The
  // food is flagged rather than spliced out immediately so the grid we're
  // iterating stays stable; eaten food is skipped by subsequent queries this
  // step and compacted out at the end of `update`.
  consumeFoodNear(x, y, radius) {
    const r2 = radius * radius;
    let eaten = 0;
    this.foodGrid.forEachNear(x, y, radius, (f) => {
      if (f.dead) return;
      const d = wrapDistSq(x, y, f.x, f.y, this.width, this.height);
      if (d <= r2) {
        f.dead = true;
        eaten++;
      }
    });
    return eaten;
  }

  update(dt) {
    this.time += dt;

    // Grow food over time.
    this.foodSpawnAccumulator += CONFIG.food.spawnPerSecond * dt;
    while (this.foodSpawnAccumulator >= 1) {
      this.spawnFood();
      this.foodSpawnAccumulator -= 1;
    }

    // (Re)build the spatial indices from the current entities so this step's
    // neighbour queries are cheap. Creatures move during the loop below, but
    // queries read each creature's live position — only its *cell* is fixed at
    // build time, and per-step movement is tiny next to a cell, so it stays
    // within the queried window.
    this.foodGrid.rebuild(this.food);
    this.creatureGrid.rebuild(this.creatures);

    // Advance creatures. New children are collected and added after the loop
    // so they don't get a turn until next step.
    const newborns = [];
    const survivors = [];
    for (const c of this.creatures) {
      const child = c.update(dt, this, this.rng);
      if (child) {
        newborns.push(child);
        this.births++;
      }
      if (c.alive) survivors.push(c);
      else this.deaths++;
    }
    this.creatures = survivors.concat(newborns);

    // Drop food eaten this step (flagged by consumeFoodNear).
    let eaten = false;
    for (const f of this.food) {
      if (f.dead) {
        eaten = true;
        break;
      }
    }
    if (eaten) this.food = this.food.filter((f) => !f.dead);

    if (this.creatures.length > this.peakPopulation) {
      this.peakPopulation = this.creatures.length;
    }
  }

  // Aggregate stats for the HUD.
  stats() {
    const n = this.creatures.length;
    const avg = { speed: 0, sense: 0, size: 0, wander: 0, diet: 0 };
    let maxGen = 0;
    let energy = 0;
    let carnivores = 0;
    for (const c of this.creatures) {
      avg.speed += c.genome.speed;
      avg.sense += c.genome.sense;
      avg.size += c.genome.size;
      avg.wander += c.genome.wander;
      avg.diet += c.genome.diet;
      energy += c.energy;
      if (c.genome.diet > CONFIG.creature.carnivoreThreshold) carnivores++;
      if (c.generation > maxGen) maxGen = c.generation;
    }
    if (n > 0) {
      for (const k of Object.keys(avg)) avg[k] /= n;
      energy /= n;
    }
    return {
      population: n,
      food: this.food.length,
      time: this.time,
      generation: maxGen,
      peak: this.peakPopulation,
      avgEnergy: energy,
      carnivores,
      kills: this.kills,
      avg,
    };
  }
}
