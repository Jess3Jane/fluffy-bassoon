// A creature: a point in the world with energy, a heading, and a genome that
// drives how it senses, moves, and metabolises. Behaviour is intentionally
// simple — steer toward the nearest sensed food, with a wander bias — because
// the interesting structure is meant to emerge from selection over genomes,
// not from cleverness in any single individual.

import { CONFIG } from "./config.js";
import { randomGenome, mutate, genomeHue } from "./genome.js";
import { wrapDelta } from "./math.js";

let NEXT_ID = 1;

export class Creature {
  constructor(x, y, genome, rng) {
    this.id = NEXT_ID++;
    this.x = x;
    this.y = y;
    this.genome = genome;
    this.heading = rng.range(0, Math.PI * 2);
    this.energy = CONFIG.creature.startEnergy;
    this.age = 0;
    this.hue = genomeHue(genome); // trophic colour (diet → green/red)
    this.lineageHue = genome.lineageHue; // neutral clade colour
    this.alive = true;
    this.generation = 0;
  }

  static random(world, rng) {
    const c = new Creature(
      rng.range(0, world.width),
      rng.range(0, world.height),
      randomGenome(rng),
      rng,
    );
    return c;
  }

  get radius() {
    return CONFIG.creature.radius * this.genome.size;
  }

  // Add energy, clamped to the species cap.
  gain(amount) {
    this.energy = Math.min(CONFIG.creature.maxEnergy, this.energy + amount);
  }

  // Whether this creature is physically able to prey on `other`: it must be
  // carnivorous enough to bother and large enough to overpower it.
  canEat(other) {
    const c = CONFIG.creature;
    return (
      this.genome.diet > c.carnivoreThreshold &&
      this.radius >= other.radius * c.predationSizeRatio
    );
  }

  // Advance one step. `dt` is in seconds. Returns a child Creature if the
  // creature reproduced this step, otherwise null.
  update(dt, world, rng) {
    // A creature eaten earlier this step is dead but still in the list; skip it.
    if (!this.alive) return null;

    const g = this.genome;
    const c = CONFIG.creature;
    const wantsMeat = g.diet > c.carnivoreThreshold;

    // --- Sense: look for the food source that best matches our diet. A
    // herbivore-leaning creature still benefits from plants; a carnivore-leaning
    // one hunts prey it can overpower. Carry the chosen target's position. ---
    const plant = g.diet < 1 ? world.nearestFood(this.x, this.y, g.sense) : null;
    const prey = wantsMeat ? world.nearestPrey(this, g.sense) : null;
    let target = null;
    if (prey && plant) target = g.diet >= 0.5 ? prey : plant;
    else target = prey || plant;

    // --- Decide heading. ---
    let desired = this.heading;
    if (target) {
      const dx = wrapDelta(target.x - this.x, world.width);
      const dy = wrapDelta(target.y - this.y, world.height);
      desired = Math.atan2(dy, dx);
    } else {
      // No food in range: wander by drifting the heading randomly.
      desired = this.heading + rng.normal() * 0.6 * g.wander;
    }

    // Blend toward desired heading, limited by turn rate.
    let turn = wrapAngle(desired - this.heading);
    const maxTurn = g.turnRate * dt;
    turn = Math.max(-maxTurn, Math.min(maxTurn, turn));
    // Wanderers don't commit fully even when they see food.
    this.heading += turn * (target ? 1 : 1 - 0.3 * g.wander);

    // --- Move. ---
    const speed = g.speed;
    const dist = speed * dt;
    this.x = wrap(this.x + Math.cos(this.heading) * dist, world.width);
    this.y = wrap(this.y + Math.sin(this.heading) * dist, world.height);

    // --- Eat any plants we're now touching. Yield scales with how herbivorous
    // we are, so committing to meat means getting little from greens. ---
    if (g.diet < 1) {
      const reach = this.radius + CONFIG.food.radius;
      const eaten = world.consumeFoodNear(this.x, this.y, reach);
      if (eaten > 0) {
        this.gain(eaten * CONFIG.food.energy * (1 - g.diet));
      }
    }

    // --- Hunt: if a creature we can overpower is in contact, kill and eat it.
    // The payoff scales with our diet, so carnivory only pays if committed. ---
    if (wantsMeat) {
      const victim = world.preyInReach(this);
      if (victim) {
        victim.alive = false;
        world.kills++;
        this.gain(
          g.diet * (victim.energy * c.meatEnergyEff + victim.radius * c.meatBodyEnergy),
        );
      }
    }

    // --- Metabolise. ---
    this.age += dt;
    const sizeCost = g.size * g.size; // bigger bodies cost more to run
    let cost = c.baseMetabolism * g.metabolismEff * sizeCost;
    cost += dist * c.moveMetabolism * sizeCost;
    if (this.age > c.maxAgeSeconds) cost *= 1.5; // senescence
    this.energy -= cost * dt;

    if (this.energy <= 0) {
      this.alive = false;
      return null;
    }

    // --- Reproduce. ---
    if (this.energy >= c.reproduceThreshold) {
      return this.reproduce(world, rng);
    }
    return null;
  }

  reproduce(world, rng) {
    const c = CONFIG.creature;
    this.energy -= c.reproduceCost;
    const childEnergy = this.energy * 0.5;
    this.energy -= childEnergy;

    const childGenome = mutate(this.genome, rng);
    const angle = rng.range(0, Math.PI * 2);
    const offset = this.radius * 2;
    const child = new Creature(
      wrap(this.x + Math.cos(angle) * offset, world.width),
      wrap(this.y + Math.sin(angle) * offset, world.height),
      childGenome,
      rng,
    );
    child.energy = childEnergy;
    child.generation = this.generation + 1;
    return child;
  }
}

// Wrap a coordinate into [0, size).
function wrap(v, size) {
  return ((v % size) + size) % size;
}

// Normalise an angle into [-PI, PI].
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
