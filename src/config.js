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

    senseRadius: 140, // how far a creature can perceive food
  },

  // Mutation applied to each genome gene at birth.
  mutation: {
    rate: 0.9, // probability a child mutates at all
    amount: 0.12, // relative magnitude of a mutation step
  },
};
