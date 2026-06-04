// The world owns all entities and advances the simulation. Neighbour queries
// (nearest food, nearest prey, contact) go through uniform spatial grids
// (`src/grid.js`) so they stay cheap as populations grow, instead of scanning
// every entity on every lookup.

import { CONFIG } from "./config.js";
import { Creature, reserveIds } from "./creature.js";
import { SpatialGrid } from "./grid.js";
import { GENES, hueSimilarity } from "./genome.js";
import { wrapDistSq } from "./math.js";
import { daylight, foodGrowthFactor } from "./daycycle.js";
import {
  seasonLevel,
  weatherNoise,
  climateFoodFactor,
  windStrength,
  windDirection,
} from "./weather.js";
import { Terrain } from "./terrain.js";
import { ScentField } from "./scent.js";

// Largest a creature's body can get, used to size contact-query windows.
const MAX_CREATURE_RADIUS = CONFIG.creature.radius * GENES.size[1];

// Bump when the serialized shape changes in a way old saves can't satisfy, so
// stale data is rejected rather than loaded into a mismatched world. v2 added
// the terrain seed; v3 added the scent / pheromone field; v4 added the heritable
// scent-signalling genes (a pre-v4 genome lacks them, so its behaviour would be
// undefined — better to reject the save than load a NaN-steered creature); v5
// added the `kinship` gene and a per-plume emitter hue (a pre-v5 genome lacks
// kinship, and its plumes carry no hue to weight by); v6 added the `mating` gene
// for sexual reproduction (a pre-v6 genome lacks it, so its reproduction mode
// would be undefined — better to reject the save than breed off a NaN); v7
// added the `mateChoice` gene for assortative/disassortative mate choice (a
// pre-v7 genome lacks it, so its preference would be undefined).
const SAVE_VERSION = 7;

export class World {
  // `seed: false` builds an empty world (no starting food/creatures, rng
  // untouched) — used when the contents are about to be loaded from a save.
  constructor(rng, { seed = true } = {}) {
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

    // The terrain map. A seeded world grows its own in `seed()`; an unseeded one
    // (about to be loaded, or used empty in tests) gets a default map so lookups
    // never hit null, which `deserialize` then replaces with the saved seed's.
    this.terrainSeed = 0;
    this.terrain = new Terrain(this.width, this.height, this.terrainSeed);

    // The scent / pheromone field: drifting plumes creatures lay as they feed
    // and die, smelled by others. Starts empty in every world (it's grown by
    // play, not seeded), and is restored from a save on load.
    this.scent = new ScentField(this.width, this.height);

    if (seed) this.seed();
  }

  seed() {
    // Grow the terrain from a seed drawn off the main rng, so each fresh world
    // gets a different map. Terrain generation uses its own internal rng, so it
    // never perturbs the main simulation stream.
    this.terrainSeed = (this.rng() * 0x100000000) >>> 0;
    this.terrain = new Terrain(this.width, this.height, this.terrainSeed);

    // Seed the starting larder. Because spawnFood now turns down infertile
    // ground (and water outright), keep trying until the world is stocked to
    // startCount, with a generous guard so a pathological map can't loop forever.
    let guard = 0;
    while (this.food.length < CONFIG.food.startCount && guard < CONFIG.food.startCount * 50) {
      this.spawnFood();
      guard++;
    }
    for (let i = 0; i < CONFIG.creature.startCount; i++) {
      this.creatures.push(Creature.random(this, this.rng));
    }
    this.peakPopulation = this.creatures.length;
  }

  // Add a food pellet and return it, or null if the world is at its food
  // carrying capacity (or — for a random spawn — no fertile ground turned up).
  //
  // An explicit (x, y) is placed verbatim: the food brush plants exactly where
  // asked, terrain or not. A random spawn instead samples the terrain — it makes
  // a few attempts, keeping the first spot whose tile fertility wins a roll, so
  // plants cluster on fertile soil and never sprout on water.
  spawnFood(x, y) {
    if (this.food.length >= CONFIG.food.maxCount) return null;

    let fx = x;
    let fy = y;
    if (fx === undefined) {
      let found = false;
      for (let i = 0; i < CONFIG.terrain.foodAttempts; i++) {
        const px = this.rng.range(0, this.width);
        const py = this.rng.range(0, this.height);
        if (this.rng.chance(this.terrain.fertilityAt(px, py))) {
          fx = px;
          fy = py;
          found = true;
          break;
        }
      }
      if (!found) return null;
    }

    const f = { x: fx, y: fy };
    this.food.push(f);
    return f;
  }

  // Add a fresh, random-genome creature at (x, y) — the interactive "spawn
  // creature" tool's entry point. Returns the new creature. There is no
  // population cap (unlike food), so this always succeeds.
  spawnCreature(x, y) {
    const c = Creature.randomAt(this, x, y, this.rng);
    this.creatures.push(c);
    if (this.creatures.length > this.peakPopulation) {
      this.peakPopulation = this.creatures.length;
    }
    return c;
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

  // Local prey crowd around `victim`, squashed to [0, 1] — the "safety in
  // numbers" read behind predation dilution. Counts the *other* live creatures
  // this `predator` could also eat (the confusion set: alternative targets it
  // might mistake the victim for) within `radius` of the victim, excluding the
  // victim and the predator itself, saturated against `dilutionNorm`. The catch
  // chance in `Creature.update` falls with this, so a victim buried in a herd is
  // harder to single out than a lone one. Uses the same creature grid and the
  // same `canEat` rule as the predation queries.
  preyDensity(predator, victim, radius) {
    const r2 = radius * radius;
    let crowd = 0;
    this.creatureGrid.forEachNear(victim.x, victim.y, radius, (c) => {
      if (c === victim || c === predator || !c.alive || !predator.canEat(c)) return;
      const d = wrapDistSq(victim.x, victim.y, c.x, c.y, this.width, this.height);
      if (d > r2) return;
      crowd++;
    });
    return Math.min(1, crowd / CONFIG.creature.dilutionNorm);
  }

  // Local kin density around `self` within `radius`, squashed to [0, 1]. Each
  // live neighbour contributes its lineage-hue similarity to `self` (1 for a
  // clone, fading to 0 for a stranger past `kinTolerance`), and the sum is
  // saturated against `kinDensityNorm` — the hue-weighted kin count at which the
  // read tops out. This is the cheap "are my relatives around?" read behind
  // kin-weighted *emission*: a creature calls louder when kin are near to
  // benefit and hushes among strangers, mirroring the kin-weighted *response*
  // in `ScentField.steer`. Uses the same creature grid as the predation queries.
  kinDensity(self, radius) {
    const tol = CONFIG.scent.kinTolerance;
    const r2 = radius * radius;
    let kin = 0;
    this.creatureGrid.forEachNear(self.x, self.y, radius, (c) => {
      if (c === self || !c.alive) return;
      const d = wrapDistSq(self.x, self.y, c.x, c.y, this.width, this.height);
      if (d > r2) return;
      kin += hueSimilarity(self.lineageHue, c.lineageHue, tol);
    });
    return Math.min(1, kin / CONFIG.scent.kinDensityNorm);
  }

  // Best partner for sexual reproduction within `radius` of `self`, or null (→
  // asexual cloning) when alone. This is where mate *choice* lives: rather than
  // always taking the nearest body, `self` scores each candidate by its
  // `mateChoice` gene and picks the highest. The preference runs along the same
  // lineage-hue axis kin recognition reads — `pref = 2·mateChoice − 1` in
  // [-1, 1] — and the score trades that hue match off against distance:
  //
  //   score = pref · (2·hueSim − 1) − distWeight · (dist / radius)
  //
  // `2·hueSim − 1` is +1 for a clone-hue partner and −1 for a stranger, so a
  // positive `pref` (mateChoice > 0.5) rewards similar partners (assortative /
  // homogamy → speciation lever) and a negative one rewards distant partners
  // (disassortative / inbreeding avoidance). At a neutral `mateChoice` (0.5)
  // `pref` is 0, the hue term drops out, and the score is pure −distance — so it
  // reduces *exactly* to "nearest wins", the old behaviour, and a missing gene
  // defaults to neutral too. The hue spread has to be real for choice to bite:
  // if every candidate is a stranger (or every one kin) the hue term is constant
  // across them and distance breaks the tie, again falling back to nearest. Uses
  // the same creature grid as the predation queries.
  findMate(self, radius) {
    const pref = ((self.genome.mateChoice ?? 0.5) - 0.5) * 2;
    const tol = CONFIG.scent.kinTolerance;
    const w = CONFIG.creature.mateChoiceDistWeight;
    const r2 = radius * radius;
    let best = null;
    let bestScore = -Infinity;
    this.creatureGrid.forEachNear(self.x, self.y, radius, (c) => {
      if (c === self || !c.alive) return;
      const d2 = wrapDistSq(self.x, self.y, c.x, c.y, this.width, this.height);
      if (d2 > r2) return;
      const sim = hueSimilarity(self.lineageHue, c.lineageHue, tol);
      const dn = Math.sqrt(d2) / radius; // normalised distance in [0, 1]
      const score = pref * (2 * sim - 1) - w * dn;
      if (score > bestScore) {
        bestScore = score;
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

    // Grow food over time, scaled by two rhythms: the day-night cycle (fast by
    // day, slow at night) and the slower season × weather climate (rich summers
    // and rain spells boost it, lean winters and droughts thin it). Their product
    // makes the larder — and the population that lives off it — breathe on both a
    // daily and a longer boom/bust timescale.
    this.foodSpawnAccumulator +=
      CONFIG.food.spawnPerSecond *
      foodGrowthFactor(this.time) *
      climateFoodFactor(this.time) *
      dt;
    while (this.foodSpawnAccumulator >= 1) {
      this.spawnFood();
      this.foodSpawnAccumulator -= 1;
    }

    // Storm winds carry loose food/spores — and the scent on the air — downwind:
    // while a gale blows, every pellet drifts a little along the prevailing
    // bearing (and every plume drifts further, being airborne), so a storm slowly
    // rakes the larder across the world and smears scent into downwind trails, in
    // the same direction it herds the creatures. Deterministic in sim-time + the
    // entity's own position, so it replays bit-identically across save/load.
    const wind = windStrength(this.time);
    if (wind > 0) {
      const dir = windDirection(this.time);
      const cos = Math.cos(dir);
      const sin = Math.sin(dir);
      const step = wind * CONFIG.weather.windFoodDrift * dt;
      const dx = cos * step;
      const dy = sin * step;
      for (const f of this.food) {
        f.x = wrap(f.x + dx, this.width);
        f.y = wrap(f.y + dy, this.height);
      }
      const scentStep = wind * CONFIG.scent.drift * dt;
      this.scent.drift(cos * scentStep, sin * scentStep);
    }

    // Fade the scent field and forget spent plumes, then index it so this step's
    // creatures can smell the field as it stands now. Plumes laid during the loop
    // below join the index next step.
    this.scent.decay(dt);
    this.scent.rebuild();

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
    // A creature can be killed by a predator *after* it has already taken its
    // own turn (so it was pushed alive above, then died later in the loop). Sweep
    // those out now rather than carrying an inert corpse into the next step: a
    // dead creature draws no rng and is skipped by every query, so removing it a
    // step early changes nothing about the dynamics — but it keeps the live list
    // free of dead entries at the step boundary, so a save taken there (which
    // filters them) is a true, divergence-free continuation.
    const living = [];
    for (const c of survivors) {
      if (c.alive) living.push(c);
      else this.deaths++;
    }
    this.creatures = living.concat(newborns);

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
    const avg = {
      speed: 0,
      sense: 0,
      size: 0,
      wander: 0,
      diet: 0,
      foodVoice: 0,
      alarmVoice: 0,
      foodTrust: 0,
      alarmTrust: 0,
      kinship: 0,
      mating: 0,
      mateChoice: 0,
    };
    let maxGen = 0;
    let energy = 0;
    let carnivores = 0;
    for (const c of this.creatures) {
      avg.speed += c.genome.speed;
      avg.sense += c.genome.sense;
      avg.size += c.genome.size;
      avg.wander += c.genome.wander;
      avg.diet += c.genome.diet;
      avg.foodVoice += c.genome.foodVoice;
      avg.alarmVoice += c.genome.alarmVoice;
      avg.foodTrust += c.genome.foodTrust;
      avg.alarmTrust += c.genome.alarmTrust;
      avg.kinship += c.genome.kinship;
      avg.mating += c.genome.mating;
      avg.mateChoice += c.genome.mateChoice;
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
      scent: this.scent.plumes.length,
      time: this.time,
      daylight: daylight(this.time),
      season: seasonLevel(this.time),
      weather: weatherNoise(this.time),
      climateFood: climateFoodFactor(this.time),
      wind: windStrength(this.time),
      windDir: windDirection(this.time),
      generation: maxGen,
      peak: this.peakPopulation,
      avgEnergy: energy,
      carnivores,
      kills: this.kills,
      avg,
    };
  }

  // A plain, JSON-safe snapshot of the whole world: the running counters, the
  // rng state (so the resumed stream is identical), and every live entity.
  // Food is stored as compact [x, y] pairs; the spatial grids are derived and
  // rebuilt on the next update, so they aren't saved. Dead-but-not-yet-compacted
  // entities are filtered out defensively.
  serialize() {
    return {
      version: SAVE_VERSION,
      width: this.width,
      height: this.height,
      time: this.time,
      births: this.births,
      deaths: this.deaths,
      kills: this.kills,
      peakPopulation: this.peakPopulation,
      foodSpawnAccumulator: this.foodSpawnAccumulator,
      terrainSeed: this.terrainSeed,
      rngState: this.rng.getState(),
      food: this.food.filter((f) => !f.dead).map((f) => [f.x, f.y]),
      creatures: this.creatures.filter((c) => c.alive).map((c) => c.serialize()),
      scent: this.scent.serialize(),
    };
  }

  // Rebuild a world from a `serialize()` snapshot, driven by `rng`. The rng's
  // state is restored *last* — after creature construction has churned it — so
  // the resumed simulation continues the exact saved random sequence. Throws on
  // a version mismatch so the caller can fall back to a fresh world.
  static deserialize(data, rng) {
    if (data.version !== SAVE_VERSION) {
      throw new Error(`unsupported save version ${data.version}`);
    }
    const world = new World(rng, { seed: false });
    world.time = data.time;
    world.births = data.births;
    world.deaths = data.deaths;
    world.kills = data.kills;
    world.peakPopulation = data.peakPopulation;
    world.foodSpawnAccumulator = data.foodSpawnAccumulator;

    // Regrow the exact same terrain from its saved seed (the map itself isn't
    // stored — the seed reproduces it bit-for-bit).
    world.terrainSeed = data.terrainSeed >>> 0;
    world.terrain = new Terrain(world.width, world.height, world.terrainSeed);

    world.food = data.food.map(([x, y]) => ({ x, y }));
    world.scent = ScentField.deserialize(data.scent, world.width, world.height);

    let maxId = 0;
    world.creatures = data.creatures.map((s) => {
      if (s.id > maxId) maxId = s.id;
      return Creature.fromState(s, rng);
    });
    reserveIds(maxId);

    rng.setState(data.rngState);
    return world;
  }
}

// Wrap a coordinate into [0, size) on a toroidal axis.
function wrap(v, size) {
  return ((v % size) + size) % size;
}
