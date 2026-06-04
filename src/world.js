// The world owns all entities and advances the simulation. For this first
// version food and creature queries are linear scans; spatial partitioning is
// on the roadmap (TASKS.md) for when populations get large.

import { CONFIG } from "./config.js";
import { Creature } from "./creature.js";
import { wrapDistSq } from "./math.js";

export class World {
  constructor(rng) {
    this.rng = rng;
    this.width = CONFIG.world.width;
    this.height = CONFIG.world.height;
    this.creatures = [];
    this.food = []; // array of { x, y }
    this.foodSpawnAccumulator = 0;
    this.time = 0;
    this.births = 0;
    this.deaths = 0;
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

  // Nearest food to a point within `radius`, or null. Linear scan.
  nearestFood(x, y, radius) {
    const r2 = radius * radius;
    let best = null;
    let bestD = r2;
    for (const f of this.food) {
      const d = wrapDistSq(x, y, f.x, f.y, this.width, this.height);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  // Remove and count food within `radius` of a point. Returns count eaten.
  consumeFoodNear(x, y, radius) {
    const r2 = radius * radius;
    let eaten = 0;
    // Iterate backwards so splicing is safe.
    for (let i = this.food.length - 1; i >= 0; i--) {
      const f = this.food[i];
      const d = wrapDistSq(x, y, f.x, f.y, this.width, this.height);
      if (d <= r2) {
        // swap-remove for O(1) deletion
        this.food[i] = this.food[this.food.length - 1];
        this.food.pop();
        eaten++;
      }
    }
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

    if (this.creatures.length > this.peakPopulation) {
      this.peakPopulation = this.creatures.length;
    }
  }

  // Aggregate stats for the HUD.
  stats() {
    const n = this.creatures.length;
    const avg = { speed: 0, sense: 0, size: 0, wander: 0 };
    let maxGen = 0;
    let energy = 0;
    for (const c of this.creatures) {
      avg.speed += c.genome.speed;
      avg.sense += c.genome.sense;
      avg.size += c.genome.size;
      avg.wander += c.genome.wander;
      energy += c.energy;
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
      avg,
    };
  }
}
