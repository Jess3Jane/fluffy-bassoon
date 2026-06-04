// Central tuning knobs for the ecosystem. Tweaking these is the main lever for
// shaping what emergent behaviour appears, so they live in one place.

export const CONFIG = {
  world: {
    width: 1200,
    height: 800,
  },

  food: {
    startCount: 320,
    maxCount: 900,
    spawnPerSecond: 70, // new plants seeded into the world each second
    energy: 26, // energy a creature gains from eating one plant
    radius: 3,
  },

  creature: {
    startCount: 90,
    radius: 5,

    startEnergy: 120,
    maxEnergy: 260,

    // Metabolism: a base cost just for being alive, plus a movement cost that
    // scales with speed. Faster, bigger creatures burn more.
    baseMetabolism: 4, // energy/second at rest
    moveMetabolism: 0.018, // energy per unit of distance travelled

    // Reproduction: once a creature is over this energy it can split, paying
    // the cost and passing half its remaining energy to the child.
    reproduceThreshold: 200,
    reproduceCost: 90,

    maxAgeSeconds: 90, // soft cap; older creatures get a metabolism penalty

    senseRadius: 140, // how far a creature can perceive food or prey

    // Predation: a creature hunts only if its diet exceeds this threshold, and
    // can catch prey only if it is at least `predationSizeRatio` times the
    // prey's radius — so predators must out-size what they eat.
    carnivoreThreshold: 0.2,
    predationSizeRatio: 1.05,
    // Energy extracted from a kill: a fraction of the prey's current energy
    // plus a bonus for its body mass, all scaled by the predator's diet.
    meatEnergyEff: 0.6,
    meatBodyEnergy: 5,
  },

  // Day-night cycle: a raised-cosine daylight level on a fixed sim-time period
  // that modulates how fast food regrows (and tints the world). Food grows at
  // the full `food.spawnPerSecond` at noon and tapers toward `nightFoodGrowth`
  // of that at midnight, so the population breathes with the cycle — plenty by
  // day, leaner by night — without the larder ever stopping entirely.
  dayNight: {
    periodSeconds: 90, // length of one full day→night→day cycle, in sim-time
    nightFoodGrowth: 0.2, // food growth at midnight, as a fraction of noon's
  },

  // Weather & seasons: two slower rhythms layered over the day-night cycle, both
  // pure functions of sim-time (so, like the day-night cycle, they add no saved
  // state and read identically across save/load and playback speed). Together
  // they scale food growth on top of the day-night modulation, driving the
  // longer-period booms and busts the population rides.
  weather: {
    // Seasons: a slow raised-cosine swing many day-night periods long. Peak
    // summer grows food richly; deep winter thins it. `amplitude` is the swing
    // in the food multiplier (summer ×(1 + a), winter ×(1 − a)).
    seasonSeconds: 360, // one full year (summer→winter→summer), in sim-time
    seasonAmplitude: 0.45,

    // Weather: short-lived rain/drought spells drawn from smooth 1-D value-noise
    // over sim-time. `periodSeconds` is the characteristic length of a spell;
    // `amplitude` is how hard rain boosts (and drought thins) the food multiplier.
    periodSeconds: 22,
    amplitude: 0.55,

    // The combined season × weather multiplier never drops below this, so even a
    // winter drought only slows the larder rather than stopping it dead.
    foodFloor: 0.05,

    // Behavioural reach: beyond the larder, a spell shapes how creatures move
    // and sense. Only the *wet* side of the weather signal bites here — rain and
    // storms — so a rain spell is a double-edged gift: it grows more food but
    // makes that food harder to find and a steady course harder to hold, while a
    // drought leaves clear, calm air (you see far and steer true, but go hungry).
    senseFloor: 0.45, // sense range in the heaviest downpour, as a fraction of clear
    windOnset: 0.15, // rain milder than this is calm; gusts build past it into storms
    windBuffet: 2.6, // peak heading jitter (radians/sec, std-dev) in a full storm

    // Wind direction: the prevailing wind isn't only a strength but a *bearing*
    // that turns slowly around the compass (one full turn per `windTurnSeconds`),
    // wobbled by smooth noise so it meanders rather than sweeping evenly. While a
    // storm blows, this bearing gives the buffet a *coherent* push — every
    // creature is nudged the same way, so a gale herds the population downwind
    // instead of only scattering it — and loose food/spores drift along it too.
    // All pure in sim-time, so it adds no saved state and replays identically.
    windTurnSeconds: 200, // sim-time for the prevailing wind to turn full circle
    windWobble: 1.1, // radians of noise wobble layered on the steady turn
    windPush: 1.6, // how hard a full gale steers a heading downwind (per second)
    windFoodDrift: 18, // how fast a full gale drifts loose food downwind (units/sec)
  },

  // Scent / pheromone plumes: a drifting chemical field laid down by living
  // creatures that turns the prevailing wind into an information channel. A
  // feeding creature drops a "food here" plume; a creature killed drops a strong
  // "danger" (blood) plume. Others smell the field within their `sense` gene's
  // reach and are nudged toward or away by diet — herbivores chase food scent and
  // flee blood, carnivores home in on the blood — so flocking and avoidance can
  // emerge from the same field the wind already drifts. Plumes ride the storm
  // wind downwind (faster than heavy food, since scent is airborne) and fade
  // linearly until forgotten. This is real, serialized state (it depends on what
  // creatures did, not just the clock), but emission/drift/decay draw no fresh
  // rng, so a restored field replays bit-identically.
  scent: {
    maxCount: 800, // hard cap on live plumes; oldest is evicted past it
    foodStrength: 1.2, // strength of a plume dropped on feeding
    dangerStrength: 2.6, // strength of a plume dropped where a creature is killed
    decayPerSecond: 0.4, // strength lost per second (a death lingers ~6s, a feed ~3s)
    minStrength: 0.05, // a plume below this is dropped from the field
    drift: 30, // downwind drift speed (units/sec) at a full gale — beats food's
    foodAttract: 2.4, // how strongly food scent pulls a herbivore toward it
    dangerResponse: 3.4, // how strongly blood scent repels prey / draws predators

    // Heritable signalling. A creature's `foodVoice`/`alarmVoice` genes scale how
    // loudly it emits each plume, and each emission spends `emitCost` energy per
    // unit of strength laid — so a chatterbox pays for its noise, and silence is
    // a viable (free) strategy. A real kill's blood plume is involuntary and
    // stays at `dangerStrength`; an *alarm* cry is a voluntary danger plume a
    // creature can choose to lay (up to `alarmRate` times/sec at full voice) at
    // `alarmStrength` — indistinguishable on the air from real blood, which is
    // exactly what makes a deceptive "danger" call able to scatter rivals.
    emitCost: 0.7, // energy spent per unit of plume strength emitted
    alarmRate: 1.4, // voluntary alarm cries per second at full alarmVoice
    alarmStrength: 2.2, // strength of a voluntary alarm cry (≈ a real kill's)

    // Kin recognition: every plume carries the lineage hue of the creature that
    // laid it, and a smeller weights each plume's pull by how close that hue is
    // to its own (scaled by its `kinship` gene). `kinTolerance` is the hue
    // distance (degrees) at which an emitter counts as a total stranger — wide
    // enough to span a clade (lineageHue drifts ~`mutation.lineageDrift`°/gen)
    // but narrow enough that long-diverged lineages read as strangers.
    kinTolerance: 40,

    // Kin-weighted *emission*. Beyond choosing whom to heed, a creature also
    // tunes how loudly it calls by how many close kin are within earshot — read
    // off the creature grid as a hue-weighted count, saturating at this many
    // kin. The `kinship` gene gates the modulation exactly as it gates the
    // response: at kinship 0 the call is unmodulated (old behaviour); as kinship
    // rises a creature with no kin around hushes (its call costs nothing and is
    // forgotten before anyone smells it) and one among relatives calls at full
    // voice — so the energy of advertising is spent only when kin are there to
    // benefit, sharpening the inclusive-fitness payoff that food signalling lives
    // or dies by.
    kinDensityNorm: 3, // hue-weighted kin count at which the emission read saturates
  },

  // Terrain: a static, seed-generated map of tiles under the world. Most of it
  // is ordinary grassland; wrapping value-noise carves out patches of water,
  // fertile soil, and barren ground that shape where food grows (`fertility`,
  // the chance a food-spawn attempt on the tile takes root) and how freely
  // creatures move across it (`speed`, a multiplier on travel distance). The
  // whole map is reproduced from `terrainSeed`, so only that seed is saved.
  terrain: {
    cols: 48, // horizontal tile resolution; rows derived from world aspect
    latticeCols: 7, // control-point grid for the noise (wraps toroidally)
    latticeRows: 5,
    // Thresholds on the two noise fields. Elevation below `waterLevel` is water;
    // on dry land, moisture above `fertileLevel` is fertile and below
    // `barrenLevel` is barren, with grassland in between.
    waterLevel: 0.3,
    fertileLevel: 0.66,
    barrenLevel: 0.36,
    foodAttempts: 6, // tries to find a fertile spot per random food spawn
    speed: { grass: 1.0, water: 0.45, fertile: 1.0, barren: 0.92 },
    fertility: { grass: 0.85, water: 0.0, fertile: 1.0, barren: 0.3 },
  },

  // Spatial hashing: the cell size used to bucket entities for neighbour
  // queries. Roughly the typical query radius — small enough that few entities
  // share a cell, large enough that a sense-radius query spans only a handful
  // of cells.
  spatial: {
    cellSize: 70,
  },

  // Mutation applied to each genome gene at birth.
  mutation: {
    rate: 0.9, // probability a child mutates at all
    amount: 0.12, // relative magnitude of a mutation step
    // Per-reproduction drift (degrees, std-dev) of the neutral lineage-hue
    // marker. Small enough that a clade stays roughly one colour, large enough
    // that long-diverged lineages drift visibly apart.
    lineageDrift: 5,
  },
};
