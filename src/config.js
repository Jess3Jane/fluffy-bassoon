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

    // Two plant kinds (0 and 1) — a sub-resource axis creatures can partition
    // along. A pellet's kind is a pure function of where it sprouts (a smooth
    // sine patchwork, `plantKindAt` in src/plants.js), so the two species grow
    // in distinct regions of the map: a *spatial* niche, and one that adds no
    // rng draw, so plant kinds don't perturb the deterministic stream.
    kinds: 2,

    // Per-kind traits — what makes the two kinds *more than a symmetric
    // coin-flip*. Each kind has its own energy `richness`, its own daily rhythm,
    // *and* its own climate (season + weather) lean, so which forage specialism
    // pays shifts on three nested timescales at once (`kindYieldFactor` in
    // src/plants.js): a clade must track all of them, or hedge as a generalist,
    // instead of settling on either band for good.
    //   • `energy`     — static richness multiplier on `food.energy` for this
    //                    kind (lean vs. rich).
    //   • `dayLit`     — true if the kind grows richest by day, false by night;
    //                    its yield peaks in that half of the cycle and dips in
    //                    the other.
    //   • `rhythmDepth`— how deeply the out-of-phase *daily* yield dips (0 = no
    //                    daily swing, dependable; 1 = nearly worthless at the
    //                    wrong hour, feast-or-famine).
    //   • `seasonLit`  — true if the kind thrives in summer (warmth), false if in
    //                    winter (cold); `seasonTilt` is how hard the seasonal
    //                    swing boosts it in its own season and thins it in the
    //                    other (0 = season-blind).
    //   • `wetLit`     — true if the kind thrives in rain, false in drought;
    //                    `wetTilt` is how hard the weather swing boosts/thins it
    //                    (0 = weather-blind).
    // The result is an asymmetric pair pulling opposite ways on every axis: kind
    // 0 a steady, day-leaning "sunleaf" that thrives in *summer rain*, and kind 1
    // a feast-or-famine "moonleaf" that thrives in *winter drought*. The daily
    // energies are picked so each kind's yield *averaged over a full day* lands
    // near 1; the season/weather tilts are centred swings (they average to ~1
    // over a year, since warmth and the weather noise are mean-symmetric), so
    // they redistribute *when* each kind pays without making the world globally
    // leaner long-run — a slow boom/bust stacked on the daily one, opposite for
    // the two kinds, so the dominant specialism crosses over with the seasons and
    // the weather as well as the hour.
    kindTraits: [
      // kind 0 — sunleaf: steady, day-leaning; thrives in summer rain.
      { energy: 1.2, dayLit: true, rhythmDepth: 0.35, seasonLit: true, seasonTilt: 0.4, wetLit: true, wetTilt: 0.25 },
      // kind 1 — moonleaf: rich but night-only; thrives in winter drought.
      { energy: 1.5, dayLit: false, rhythmDepth: 0.7, seasonLit: false, seasonTilt: 0.4, wetLit: false, wetTilt: 0.25 },
    ],

    // Foraging specialism. A creature's heritable `forage` gene (0 → kind 0,
    // 1 → kind 1, 0.5 → generalist) meets a plant's kind to set how much energy
    // it extracts: `eff = match^forageExponent`, where `match` is how well the
    // gene aligns with the kind (1 = perfectly specialised on it, 0 = the
    // opposite specialism, 0.5 = a generalist on either). The exponent is > 1 so
    // the curve is *convex* — two specialists out-yield one generalist, the
    // disruptive-selection pressure that drives a clade to split onto separate
    // resources. A creature won't consume a plant whose `eff` is below
    // `forageMinEff`, so a specialist leaves the other kind untouched (clean
    // niche partitioning rather than wastefully eating what it can barely use,
    // which would be interference competition that opposes the split). The band
    // of `forage` values clearing the floor on *both* kinds is the generalist
    // niche; outside it a creature eats only one kind. A matched specialist
    // still gets full yield (match 1 → eff 1), so the absolute food economy is
    // roughly unchanged — generalism is the discount, specialism the payoff.
    forageExponent: 1.4,
    forageMinEff: 0.25,

    // Microclimate feedback onto the larder. The microclimate already partitions
    // the *animals* across space (warm-adapted clades settle the warm regions);
    // these two knobs let the same spatial warmth/wetness mosaic also shape the
    // *plants*, so the climate map and the plant-kind patchwork reinforce each
    // other into one coherent biome instead of two independent overlays. Both
    // pull along the kinds' own climate leans — sunleaf (kind 0) thrives in warm,
    // wet ground, moonleaf (kind 1) in cool, dry — so each kind grows where it
    // pays. Both fall back to the old position-only behaviour at 0.
    //   • `microclimateKindBias` nudges *which* kind sprouts at a spot: a warm-wet
    //     region tilts the `plantKindAt` patchwork toward sunleaf, a cool-dry one
    //     toward moonleaf, so a region settles predominantly onto the kind its
    //     climate favours rather than a fixed ~50/50 sine split.
    //   • `microclimateFertilityBias` then tilts *how richly* that kind takes
    //     root there (a centred multiplier on the terrain fertility roll, like
    //     terrain's own spatial fertility): boosted for a kind in the climate it
    //     thrives in, thinned for one out of place — so an out-of-biome sprout is
    //     suppressed and each region's favoured kind grows the more densely.
    microclimateKindBias: 1.2,
    microclimateFertilityBias: 0.5,
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

    // Climate tolerance: each creature carries a preferred warmth and wetness
    // (the `warmthPref` / `wetnessPref` genes), and its *base* metabolism rises
    // with how far the current climate has drifted from that point —
    // `1 + climateStressCost · climateStress`, where the stress is the squared
    // drift on the two [0, 1] climate axes (warmth = season, wetness = weather),
    // up to 2 for a creature perfectly anti-adapted to the present climate. This
    // makes the season/weather swings select on the animals directly (winters
    // cull the summer-adapted, droughts the rain-adapted), not only through the
    // food they grow — and pairs with the plant kinds' own climate leans, so a
    // clade is pulled to match its tolerance to where its forage pays. Kept
    // modest so a typical seasonal mismatch is a real but survivable tax (a
    // half-axis mismatch ≈ +12% base cost) rather than an outright cull each
    // winter — selection nudges the prefs to track the climate.
    climateStressCost: 0.5,

    // Reproduction: once a creature is over this energy it can split, paying
    // the cost and passing half its remaining energy to the child.
    reproduceThreshold: 200,
    reproduceCost: 90,
    // Sexual reproduction: when a creature ready to breed rolls (by its `mating`
    // gene) to reproduce sexually, it looks for a partner within this radius to
    // recombine genomes with; finding none, it falls back to cloning. Generous
    // enough that the clustering the scent/kin/herding layers already drive
    // usually puts a partner in reach, without needing dedicated mate-seeking.
    mateRadius: 90,
    // Mate choice: among the partners within `mateRadius`, a breeder scores each
    // by `mateChoice·hue-match − mateChoiceDistWeight·(distance/mateRadius)` and
    // picks the best. This weight sets how dearly distance is paid against a
    // better-matched mate: at 1.0, a full-strength hue preference can exactly
    // offset a partner sitting a full radius further away, so preference and
    // proximity carry equal pull. Lower it to let choice reach further for the
    // right hue; raise it to keep mating local. At a neutral `mateChoice` (0.5)
    // the hue term vanishes and the score is pure distance — i.e. nearest wins,
    // the old behaviour — regardless of this weight.
    mateChoiceDistWeight: 1.0,
    // Courtship cost: sexual reproduction is no longer free to be *choosy*. When
    // a breeder pairs with a partner, it pays this much energy scaled by how far
    // that partner is (`courtshipCost · distance / mateRadius`) — full price for
    // courting across the whole radius, almost nothing for a mate underfoot. A
    // neutral breeder takes the nearest body and pays a pittance; a picky one
    // that reaches past it for a better-hue-matched partner pays for the extra
    // ground it courted across, so `mateChoice` now carries a real tension
    // instead of a free preference. The asexual / no-mate path pays nothing,
    // exactly as before. Kept well under `reproduceCost` so courtship taxes
    // choice without making sex itself uneconomical.
    courtshipCost: 30,

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

    // Prey-size specialism — the predator-niche mirror of plant-kind `forage`.
    // A creature's heritable `hunt` gene is its preferred prey size (on the
    // normalised `size` axis); `huntYield` meets it with a victim's actual size
    // to set how much meat the kill yields: `eff = match^huntExponent`, where
    // `match` is how close the preference lands on the prey (1 dead-on, 0 a full
    // axis away). The exponent is > 1 so the curve is *convex* — a predator that
    // hones onto one prey-size band out-yields one hunting across all sizes, the
    // disruptive-selection pressure that lets carnivores split the prey pool by
    // body size (fast-small vs. slow-large) the way grazers split the plants. A
    // predator won't strike at prey whose `eff` is below `huntMinEff`, so a
    // small-prey hunter leaves the big bodies for a large-prey ecotype (clean
    // partitioning, not interference that strips a shared prey pool). Mirrors the
    // forage constants so the two trophic levels partition on the same terms.
    huntExponent: 1.4,
    huntMinEff: 0.25,

    // Safety in numbers. A victim packed among other prey is harder to single
    // out — the strike is diluted and the predator confused by the press of
    // similar bodies. When a predator has a victim in reach, the catch is rolled
    // against a chance that falls with the local prey crowd (the other creatures
    // this predator could eat, within `dilutionRadius` of the victim, read off
    // the creature grid like `kinDensity`). The crowd's effect saturates at
    // `dilutionNorm` neighbours and cuts the catch chance by at most
    // `dilutionStrength` — kept below 1 so even a dense herd leaves a catch floor
    // (a herd is a refuge, not a fortress: predators must work to cut an animal
    // out of one, but a stable herd can never starve its hunters into collapse).
    // This gives flocking an emergent anti-predator payoff beyond scent.
    dilutionRadius: 50, // how close other prey must be to the victim to shield it
    dilutionNorm: 4, // nearby-prey count at which the dilution effect saturates
    dilutionStrength: 0.7, // max cut to catch chance in a full crowd (<1 = floor)
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

  // Microclimate: a *spatial* axis for the climate, layered under the global
  // season/weather clock. Where season and weather move the whole map up and
  // down the warmth/wetness axes together over time, the microclimate is a
  // static, per-region offset — a sun-baked, dry south and a cool, damp north,
  // say — grown once from a seed with the same wrapping value-noise as the
  // terrain (so it tiles seamlessly and reproduces bit-for-bit from the seed,
  // never needing to be stored). The warmth/wetness a creature actually feels
  // (and so its `climateStress`) is the global level *plus* the offset at its
  // position, clamped back onto [0, 1]. So `warmthPref` / `wetnessPref` now
  // partition creatures across *space* as well as time: a warm-adapted clade
  // settles the south while a cold-adapted one holds the north, even at the same
  // instant. A coarse lattice (few control points) makes broad regional patches
  // rather than fine speckle; the amplitudes set how strong the regional pull is
  // relative to the seasonal swing.
  microclimate: {
    latticeCols: 3, // control-point grid for the offset noise (wraps toroidally)
    latticeRows: 3,
    warmthAmplitude: 0.4, // peak warmth offset (±) a region adds to the season
    wetnessAmplitude: 0.35, // peak wetness offset (±) a region adds to the weather
  },

  // Vegetation feedback: the standing larder's reach back onto the microclimate
  // (`src/vegetation.js`). The microclimate above is a *static* field grown from
  // the seed — it shapes which plant kind grows where, but the plants never shape
  // it back. This closes that loop: a stand of plants nudges its own local climate
  // *toward the conditions its kind thrives in* (sunleaf warm-wet, moonleaf
  // cool-dry), so a patch reinforces the very biome it grows in. The kind
  // boundaries the seed only *fixed* can then sharpen, drift (as grazing thins a
  // stand), and oscillate. It's recomputed each step from the live food, so it
  // adds no serialized state. Two guards keep it from running away: the per-cell
  // lean is squashed through tanh (bounded), and read relative to the larder's
  // global mean (mean-respecting — the globally dominant kind is penalised on bare
  // ground, pulling the world back toward an even split). At amplitude 0 every
  // offset is 0 and the world behaves exactly as it did before the feedback.
  vegetation: {
    latticeCols: 12, // density-lattice columns (rows derived from the aspect ratio)
    leanScale: 8, // net same-kind plants past the mean for a ~saturating nudge
    // Kept gentle (~20% of the static microclimate's amplitude): enough to sharpen
    // each kind's biome and rebalance a lopsided larder toward an even split, but
    // small next to the static gradient so it perturbs the spatial sorting without
    // washing it out. Larger values only erode that sorting for little extra gain.
    warmthAmplitude: 0.08, // peak warmth nudge (±) a dense single-kind stand adds
    wetnessAmplitude: 0.07, // peak wetness nudge (±) a dense single-kind stand adds

    // The feedback's *strength* is no longer a flat per-kind constant — each
    // pellet carries a heritable `canopyAmp` gene (in [0, 1]) for how strongly it
    // shapes its understory climate, so a plant lineage can *invest* in niche
    // construction (entrench its biome harder) or coast, and selection tunes the
    // loop's own gain rather than the config fixing it. A stand's lean vote is
    // scaled by `canopyAmp / neutral` — so a plant at `neutral` votes the old ±1
    // (the established feedback strength is unchanged where the trait sits at its
    // reference) and over- / under-investers shape the field more / less strongly.
    //
    // The trait is genuinely heritable: a new sprout inherits the *nearest* same-
    // kind plant's investment (the parent, found within `inheritRadius` off a grid
    // rebuilt at the step boundary), mutated by `mutationStep` — so a mutant's
    // deviation survives to be selected on rather than being smeared back into a
    // regional mean. Two opposing pressures shape it, so an interior optimum
    // *emerges* from the balance rather than being dialled in: a **fecundity cost**
    // (building canopy diverts from seeding, so a sprout's germination falls
    // linearly with its parent's investment) pulls it down toward cheap, light-
    // touch seeding, while a **facilitation benefit** (a parent's own canopy
    // shelters its seedlings — a private, saturating return) pulls it up. A pioneer
    // with no parent in reach starts at `neutral`.
    canopy: {
      neutral: 0.5, // start / fallback / vote reference (a neutral plant votes ±1)
      mutationStep: 0.05, // std-dev of the per-inheritance drift of the canopy gene
      inheritRadius: 90, // a sprout copies the nearest same-kind plant within this reach
      fecundityCost: 0.55, // germination ∝ (1 − fecundityCost·canopy): cheap seeding favours low
      facilitation: 1.4, // peak germination bonus a parent's canopy gives its seedlings
      facilitationSlope: 3, // how fast that (saturating) shelter benefit ramps with canopy
    },
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

  // Speciation readout: how the live population is bucketed into "species" for
  // the HUD/chart tally. Creatures are clustered by lineage hue (single-linkage
  // along the colour wheel, against `scent.kinTolerance` so a clade reads as one
  // species exactly as it reads as one kin group), and only clusters with at
  // least `minClusterSize` members count — so a lone mutant or a dying splinter
  // doesn't inflate the count. The hue cluster count is purely an observation
  // derived from existing state; it changes nothing about the simulation.
  //
  // Alongside that *structural* (colour) read sits a *realised* one: reproductive
  // isolation. The hue count says how many clades exist by ancestry, but says
  // nothing about whether they actually still interbreed — two diverged hue bands
  // could still swap genes freely. So we also track, over a rolling window of the
  // last `matingWindow` *sexual* matings, the share that stayed within a lineage
  // (the two parents within `scent.kinTolerance` on the hue wheel) versus crossed
  // into another. As assortative `mateChoice` and the courtship cost pull breeding
  // inward, the cross-lineage share falls and isolation rises — that *fall is
  // speciation happening*, the behavioural counterpart to the colour count.
  // Alongside the *neutral* (hue) reads above sits an *adaptive* one. The hue
  // count and the isolation ring both measure ancestry along the neutral
  // lineageHue marker; neither looks at the adaptive genome, so a clade that has
  // split ecologically — half of it turned carnivore — while keeping one hue band
  // reads as a single species by both. The ecological species count clusters the
  // live population on its adaptive genes instead (`countGeneClusters`, the
  // multi-D mirror of `countHueClusters`): two creatures are the same species when
  // no single adaptive gene differs by more than `geneTolerance` (max-norm), and
  // species are the single-linkage connected components of that graph. So an
  // ecological split (a real gap in any gene) shows up even while the colour drift
  // hasn't caught up — surfaced beside the hue count so the two can disagree
  // usefully.
  speciation: {
    minClusterSize: 3, // smallest cluster (hue or gene) that counts as a species
    matingWindow: 200, // recent sexual matings the isolation read averages over
    // Max per-gene normalised difference for two genomes to count as the same
    // ecological species under single-linkage. Set comfortably above the
    // within-clade per-generation drift (~0.12/gene std, so a parent–child pair's
    // largest-gene gap is typically ~0.25) so a clade reliably chains into one
    // cluster, yet well below a full-range gene swing (1.0) so a substantial
    // single-gene divergence with a real gap reads as a distinct species.
    geneTolerance: 0.4,
    // The gene-space clustering is O(n²); above this population it's skipped and
    // the ecological species count reports null (the HUD shows "—") rather than
    // stalling the loop on a very large world. The cheap O(n log n) hue count is
    // always computed.
    maxClusterPop: 2000,
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
