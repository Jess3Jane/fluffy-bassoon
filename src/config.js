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
