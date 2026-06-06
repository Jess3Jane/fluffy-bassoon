// Kill-site feed: a bounded, view-only record of where creatures have recently
// been killed, so predation hotspots read on the minimap heatmap alongside the
// population / food / scent layers. Those three each bin a quantity the live
// world already standing-exposes (bodies, pellets, plumes); a kill, by contrast,
// is an *event* — it leaves a danger plume on the scent field, but the kill
// *position itself* isn't carried anywhere the heatmap could read. So this
// accumulates recent kill positions, each fading out over a short window, into a
// transient ring the heat overlay can bin.
//
// Purely a view aid: it draws no rng, feeds nothing back into the dynamics, and
// is never serialized (a loaded world simply starts with an empty feed and
// refills as predation resumes), so it never perturbs the deterministic stream —
// the same contract the inspector trail and the heatmap itself keep.

// Recency weight of a kill site at sim-time `now`: 1 the instant it happens,
// fading linearly to 0 at `maxAge` and 0 thereafter (and for a site somehow
// stamped in the future). So a fresh kill glows on the heatmap and an old one
// dims out, making the wash read as "where predation is happening *now*".
export function killWeight(site, now, maxAge) {
  const age = now - site.time;
  if (age < 0 || age >= maxAge) return 0;
  return 1 - age / maxAge;
}

export class KillFeed {
  // `maxAge` (sim-seconds) is how long a kill lingers before it has fully faded
  // from the feed; `maxSites` caps the ring so a predation burst stays bounded
  // regardless of how many kills land within the window.
  constructor(maxAge, maxSites) {
    this.maxAge = maxAge;
    this.maxSites = maxSites;
    // Oldest first, newest last (sim-time is monotonic, so pushes stay ordered),
    // so both the cap eviction and age pruning drop from the front.
    this.sites = [];
  }

  // Forget every recorded kill (called when the world is swapped on reset/load,
  // so a new world never shows the previous one's predation).
  clear() {
    this.sites.length = 0;
  }

  // Note a kill at a world point, stamped with the sim-time it happened so its
  // heat weight can fade with age. Evicts the oldest if the ring is full.
  record(x, y, time) {
    this.sites.push({ x, y, time });
    if (this.sites.length > this.maxSites) this.sites.shift();
  }

  // Drop sites that have fully faded (age ≥ `maxAge`), so the ring doesn't carry
  // stale entries between kills. Cheap: the oldest sit at the front, so this just
  // trims a leading run. Idempotent — the weight read below already zeroes a
  // faded site, so this is purely a memory tidy.
  prune(now) {
    const cutoff = now - this.maxAge;
    const sites = this.sites;
    let i = 0;
    while (i < sites.length && sites[i].time <= cutoff) i++;
    if (i > 0) sites.splice(0, i);
  }
}
