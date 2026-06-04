// A creature: a point in the world with energy, a heading, and a genome that
// drives how it senses, moves, and metabolises. Behaviour is intentionally
// simple — steer toward the nearest sensed food, with a wander bias — because
// the interesting structure is meant to emerge from selection over genomes,
// not from cleverness in any single individual.

import { CONFIG } from "./config.js";
import { randomGenome, mutate, crossover, genomeHue, hueSimilarity } from "./genome.js";
import { wrapDelta, wrapDistSq } from "./math.js";
import { weatherSenseFactor, windStrength, windDirection } from "./weather.js";
import { SCENT } from "./scent.js";

let NEXT_ID = 1;

// After restoring a saved world, advance the id counter past every id that was
// loaded so creatures born afterwards still get fresh, unique ids.
export function reserveIds(throughId) {
  if (throughId >= NEXT_ID) NEXT_ID = throughId + 1;
}

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

  // Like `random`, but dropped at a specific point rather than anywhere in the
  // world — used by the interactive "spawn creature" tool, which supplies the
  // location the user clicked or dragged over.
  static randomAt(world, x, y, rng) {
    return new Creature(x, y, randomGenome(rng), rng);
  }

  // A plain, JSON-safe snapshot of everything needed to recreate this creature.
  // Derived fields (hue, lineageHue, radius) are recomputed from the genome on
  // restore rather than stored. `alive` is omitted: only live creatures are
  // ever serialized.
  serialize() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      genome: { ...this.genome },
      heading: this.heading,
      energy: this.energy,
      age: this.age,
      generation: this.generation,
    };
  }

  // Rebuild a creature from a `serialize()` snapshot. The constructor consumes
  // `rng` (for its default heading); that draw is harmless here because every
  // saved field is then overwritten — and the world restores the rng to its
  // saved state after all creatures are built, so the resumed stream is exact.
  static fromState(state, rng) {
    const c = new Creature(state.x, state.y, { ...state.genome }, rng);
    c.id = state.id;
    c.heading = state.heading;
    c.energy = state.energy;
    c.age = state.age;
    c.generation = state.generation;
    c.alive = true;
    return c;
  }

  get radius() {
    return CONFIG.creature.radius * this.genome.size;
  }

  // Add energy, clamped to the species cap.
  gain(amount) {
    this.energy = Math.min(CONFIG.creature.maxEnergy, this.energy + amount);
  }

  // Lay a plume on the scent field and pay for it. Emission costs energy in
  // proportion to how loud the plume is, so signalling is never free. A plume
  // too faint to outlast the field's decay floor is skipped — it would be
  // forgotten before anyone smelled it, so there's no sense paying for it (and a
  // gene tuned near-silent ends up effectively, and freely, mute).
  signal(world, kind, strength) {
    if (strength <= CONFIG.scent.minStrength) return;
    // Tag the plume with our lineage hue so kin can tell our call from a
    // stranger's and weight their response to it accordingly.
    world.scent.emit(this.x, this.y, kind, strength, this.lineageHue);
    this.energy -= CONFIG.scent.emitCost * strength;
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
    // one hunts prey it can overpower. Rain dims sight, so the reach shrinks in a
    // downpour — food that grows in the wet is harder to actually find. Carry the
    // chosen target's position. ---
    const sense = g.sense * weatherSenseFactor(world.time);
    const plant = g.diet < 1 ? world.nearestFood(this.x, this.y, sense) : null;
    const prey = wantsMeat ? world.nearestPrey(this, sense) : null;
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

    // --- Storm winds: a gust both pushes and jostles. The prevailing wind has a
    // *direction*, so every creature is steered toward the same downwind bearing
    // — a coherent push that herds the population one way rather than only
    // scattering it — while random gusts knock the heading around on top, so even
    // a creature locked onto food gets jostled off its line. Both scale with the
    // wind, so they're nothing in fair weather and fiercest at a storm's peak.
    // (Drought is calm: its dry air leaves both sight and steering untouched.) ---
    const wind = windStrength(world.time);
    if (wind > 0) {
      const toward = wrapAngle(windDirection(world.time) - this.heading);
      this.heading += toward * Math.min(1, wind * CONFIG.weather.windPush * dt);
      this.heading += rng.normal() * wind * CONFIG.weather.windBuffet * dt;
    }

    // --- Smell the air. Nearby plumes nudge the heading: a herbivore is drawn to
    // "food here" scent and recoils from the blood-scent of a kill, while a
    // carnivore is instead drawn toward that blood (the field owns the diet
    // logic). Scent reads at the creature's full `sense` reach *undimmed* by rain
    // — smell carries when sight fails — so it complements the weather-fogged eye.
    // The nudge scales with the local scent gradient, so a strong, close trail
    // turns a creature firmly while a faint whiff barely deflects it. ---
    const steer = world.scent.steer(
      this.x,
      this.y,
      g.diet,
      g.sense,
      g.foodTrust,
      g.alarmTrust,
      this.lineageHue,
      g.kinship,
    );
    if (steer.dx !== 0 || steer.dy !== 0) {
      const desiredScent = Math.atan2(steer.dy, steer.dx);
      const towardScent = wrapAngle(desiredScent - this.heading);
      const mag = Math.hypot(steer.dx, steer.dy);
      this.heading += towardScent * Math.min(1, mag * dt);
    }

    // --- Move. Terrain underfoot scales travel: open ground is free, but water
    // bogs a creature down, so it crawls across (and burns base metabolism the
    // whole time), making water a natural barrier and refuge. ---
    const speed = g.speed;
    const dist = speed * dt * world.terrain.speedAt(this.x, this.y);
    this.x = wrap(this.x + Math.cos(this.heading) * dist, world.width);
    this.y = wrap(this.y + Math.sin(this.heading) * dist, world.height);

    // --- Eat any plants we're now touching. Yield scales with how herbivorous
    // we are, so committing to meat means getting little from greens. ---
    if (g.diet < 1) {
      const reach = this.radius + CONFIG.food.radius;
      const eaten = world.consumeFoodNear(this.x, this.y, reach);
      if (eaten > 0) {
        this.gain(eaten * CONFIG.food.energy * (1 - g.diet));
        // Leave a "food here" plume on the air for others to follow — but only as
        // loudly as the `foodVoice` gene dictates, and at an energy price. A
        // silent grazer keeps its larder secret for free; a loud one pays to
        // advertise it (a cost only worth bearing if being heard ever helps).
        //
        // Kin-weighted emission: the same `kinship` gene that decides whom to
        // heed (`ScentField.steer`) also decides when to bother calling. We read
        // the local kin density off the creature grid and gate the call by it —
        // `1 − kinship·(1 − density)`, the exact mirror of the response weight —
        // so a kin-blind creature (kinship 0) calls at full voice as before,
        // while a kin-tuned one hushes among strangers (where advertising only
        // feeds competitors) and calls up when relatives are near to benefit.
        // The hush is *free*: a faint-enough plume falls below the decay floor
        // and `signal` skips it without spending energy.
        const density = world.kinDensity(this, g.sense);
        const kinGain = 1 - g.kinship * (1 - density);
        this.signal(world, SCENT.FOOD, CONFIG.scent.foodStrength * g.foodVoice * kinGain);
      }
    }

    // --- Hunt: if a creature we can overpower is in contact, kill and eat it.
    // The payoff scales with our diet, so carnivory only pays if committed. ---
    if (wantsMeat) {
      const victim = world.preyInReach(this);
      if (victim) {
        // Safety in numbers: a victim packed among other prey is harder to single
        // out — the strike is diluted and the eye confused by the press of similar
        // bodies. Roll the catch against a chance that falls with the local prey
        // crowd (read off the creature grid like kinDensity), down to a floor so a
        // herd is a refuge, not a fortress. A lone victim (crowd 0 → chance 1) is
        // caught outright and draws no rng, so a solitary hunt is unchanged. The
        // roll is on the main rng, so it replays bit-identically across save/load.
        const crowd = world.preyDensity(this, victim, c.dilutionRadius);
        const catchChance = 1 - c.dilutionStrength * crowd;
        if (catchChance < 1 && !rng.chance(catchChance)) {
          // The victim slips away in the confusion of the crowd; no kill this step.
        } else {
          victim.alive = false;
          world.kills++;
          this.gain(
            g.diet * (victim.energy * c.meatEnergyEff + victim.radius * c.meatBodyEnergy),
          );
          // A kill spills a strong "danger" plume where the prey fell — blood on
          // the wind that sends other prey fleeing and draws other predators in.
          // The blood carries the victim's lineage hue, so its own kin read the
          // warning loudest (their alarm response, weighted by their kinship gene,
          // keys off how close the dead one's hue is to theirs).
          world.scent.emit(
            victim.x,
            victim.y,
            SCENT.DANGER,
            CONFIG.scent.dangerStrength,
            victim.lineageHue,
          );
        }
      }
    }

    // --- Cry wolf. Beyond the involuntary blood a kill spills, a creature can
    // *choose* to lay a danger plume — a voluntary alarm, indistinguishable on
    // the air from real blood. How often it cries scales with the `alarmVoice`
    // gene (capped at `alarmRate`/sec), and each cry costs energy. An honest
    // crier warns neighbours of a hunt; a deceiver pairs a loud voice with a deaf
    // ear (low `alarmTrust`, set above) to scatter rival grazers off contested
    // food while standing its own ground. The draw is on the main rng, so the
    // cry replays bit-identically across save/load. ---
    if (g.alarmVoice > 0 && rng.chance(g.alarmVoice * CONFIG.scent.alarmRate * dt)) {
      this.signal(world, SCENT.DANGER, CONFIG.scent.alarmStrength);
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

    // Sexual vs. asexual reproduction is itself heritable, through the `mating`
    // gene. With probability `mating` the creature seeks a partner; if one is in
    // reach the child's genome is a crossover of both parents, so traits from two
    // lineages recombine in one body. Otherwise — a low `mating`, or simply
    // nobody nearby to pair with — it falls back to the asexual path: a mutated
    // copy of its own genome, exactly as before. So sex never stalls reproduction
    // for want of a mate; it only happens where there's someone to mix with. Only
    // the initiator pays the energy cost (it's the one that hit the threshold);
    // the partner just contributes genes.
    let mate = null;
    if (rng.chance(this.genome.mating)) {
      mate = world.findMate(this, c.mateRadius);
    }

    // Courtship costs energy in proportion to how far the chosen mate is, so
    // mate *choice* is no longer free: a picky breeder that reached past the
    // nearest body for a better-hue-matched partner pays for the extra ground it
    // courted across, while a neutral breeder (nearest mate) pays a pittance.
    // Charged here — before the child's share is carved off below — so it
    // genuinely shrinks what the pair invests in the offspring, and computed
    // from positions alone (no rng), so a restored world replays bit-identically.
    // The asexual / no-mate path pays nothing, exactly as before.
    if (mate) {
      const dist = Math.sqrt(
        wrapDistSq(this.x, this.y, mate.x, mate.y, world.width, world.height),
      );
      this.energy -= c.courtshipCost * (dist / c.mateRadius);

      // Log this cross for the reproductive-isolation readout. A mating counts as
      // *cross-lineage* when the partners sit more than `kinTolerance` apart on
      // the hue wheel (hueSimilarity falls to 0 there) — the same threshold the
      // kin/scent layers and the hue species count use to tell kin from stranger.
      // So as assortative `mateChoice` keeps breeding within a clade, the logged
      // cross-rate falls and realised isolation rises. Pure bookkeeping (no rng).
      const cross =
        hueSimilarity(this.lineageHue, mate.lineageHue, CONFIG.scent.kinTolerance) <= 0;
      world.recordMating(cross);
    }

    const childEnergy = this.energy * 0.5;
    this.energy -= childEnergy;

    const blended = mate ? crossover(this.genome, mate.genome, rng) : this.genome;
    const childGenome = mutate(blended, rng);

    const angle = rng.range(0, Math.PI * 2);
    const offset = this.radius * 2;
    const child = new Creature(
      wrap(this.x + Math.cos(angle) * offset, world.width),
      wrap(this.y + Math.sin(angle) * offset, world.height),
      childGenome,
      rng,
    );
    child.energy = childEnergy;
    child.generation =
      (mate ? Math.max(this.generation, mate.generation) : this.generation) + 1;
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
