# Tasks

A roadmap for **Fluffy Bassoon** — an evolving creature ecosystem. The goal is
emergent complexity: simple per-creature rules that, in aggregate, produce
population dynamics, natural selection, and surprising behaviour.

## Done

- [x] Project scaffold: `index.html`, `styles.css`, ES-module source layout,
      deployable to GitHub Pages with no build step.
- [x] Core simulation loop with fixed-timestep update and canvas rendering.
- [x] World: toroidal 2D space holding food and creatures.
- [x] Food: plants that spawn and regrow over time.
- [x] Creatures: energy, position, heading, and a heritable genome.
- [x] Sensing + behaviour: creatures steer toward food using their genome.
- [x] Metabolism: moving and living cost energy; eating restores it.
- [x] Reproduction with mutation; death at zero energy.
- [x] Live stats overlay (population, food, generation, average traits).
- [x] Predator / prey dynamics: a heritable `diet` trait (herbivore↔carnivore)
      lets bigger creatures hunt smaller ones for meat, with a specialist
      tradeoff (plants vs. prey) and trophic-role colouring. A second trophic
      level emerges; the carnivore share self-regulates against prey supply.
- [x] Spatial partitioning (grid hashing) so neighbour queries scale to large
      populations. A uniform `SpatialGrid` (`src/grid.js`) buckets food and
      creatures into toroidally-wrapped cells, so nearest-food / nearest-prey /
      contact queries scan a small cell window instead of the whole world.
      Behaviour-identical to the old linear scan (the smoke test cross-checks
      grid queries against brute force), and ~5× faster at ~1k creatures plus
      thousands of plants — the gap widening as the world grows.
- [x] Lineage / species colouring driven by genome so clades are visible. Each
      genome carries a neutral `lineageHue` marker (`src/genome.js`) that is
      inherited and drifts a few degrees per generation, so a founder and its
      descendants share a colour while diverged clades drift apart into distinct
      colour bands. The marker affects nothing about behaviour and lives outside
      `GENES` (it wraps the colour wheel rather than clamping). A HUD button
      toggles the renderer between **Trophic** colouring (diet → green/red) and
      **Lineage** colouring (the clade marker).

- [x] Charts: population and trait history over time. A `History` ring buffer
      (`src/history.js`) samples `world.stats()` on a fixed *sim-time* cadence —
      so the window reads identically at 1× or 8× — and evicts oldest-first to
      stay bounded. `src/charts.js` draws two stacked sparklines in the HUD: a
      population panel (total + carnivore sub-band, scaled to the windowed peak)
      and an average-trait panel (diet, plus speed/size normalised to their gene
      ranges onto a shared 0–1 axis), making booms, crashes, and the trait drift
      behind them legible without leaving the page.

- [x] Save / load world state to localStorage. The whole world serializes to a
      plain, JSON-safe snapshot (`World.serialize` / `World.deserialize` in
      `src/world.js`, with per-entity `Creature.serialize` / `fromState`): the
      running counters, every live creature and food pellet, *and the rng state*
      — mulberry32's single uint32, now exposed via `rng.getState/setState`
      (`src/rng.js`). Restoring the rng last makes a loaded world a true
      continuation: it replays the exact random stream, so original and restored
      worlds run forward bit-identically (the persistence test asserts this).
      `src/persistence.js` is a defensive localStorage wrapper (versioned saves,
      every call guarded so a disabled/full/corrupt store degrades to "no save"
      rather than crashing), wired to **Save** / **Load** HUD buttons.

- [x] Interactive tools: click/drag to paint food or seed creatures. A
      `ToolController` (`src/tools.js`) owns the canvas pointer interaction and
      drives two brushes selectable from a HUD **Tool** toggle: *Food* scatters
      clumps of plants, *Creature* drops fresh random-genome founders. Pointer
      events (mouse or touch, with pointer capture) walk the drag in fixed
      `step`-sized hops along the shortest toroidal path, dabbing at each — so a
      fast flick still lays a continuous trail and a slow crawl doesn't pile
      dabs on one spot (food paints densely, creatures spaced further apart).
      The spawn primitives live on the world core (`World.spawnFood` now returns
      the pellet / null at the food cap; `World.spawnCreature` adds a founder at
      a point via `Creature.randomAt` and keeps the peak counter honest), so the
      brush logic stays a thin DOM shim and the spawning is headlessly tested.

- [x] Day-night cycle affecting food growth. A raised-cosine *daylight* level
      (`src/daycycle.js`) rides a fixed sim-time period — full at noon, dark at
      midnight, with smooth dawn/dusk shoulders — and scales the food spawn rate
      between full and a configurable night floor (`CONFIG.dayNight`). Plants
      regrow fast by day and slowly by night, so the larder (and the population
      living off it) breathes with the cycle instead of holding steady. The whole
      cycle is a *pure function of `world.time`*, so it adds no serialized state,
      stays bit-identical across save/load, and reads the same at any speed. The
      renderer washes the scene with a deepening night veil, and the HUD shows the
      phase (Day / Dusk / Night / Dawn) and daylight percentage.

- [x] Terrain (water, fertile, barren) influencing movement and food. A static
      tile map (`src/terrain.js`) is grown from a single seed with wrapping
      value-noise — two fields (elevation carves water, moisture splits fertile
      vs. barren on dry land) thresholded into four tile kinds, mostly grassland.
      It tiles seamlessly across the toroidal world. Terrain shapes two things:
      **food** (random growth makes a few attempts and keeps the first spot whose
      tile *fertility* wins a roll, so plants cluster on fertile soil, thin out on
      barren ground, and never sprout on water) and **movement** (a per-tile
      *speed* multiplier — water bogs creatures to a crawl while they keep burning
      base metabolism, making it a natural barrier and refuge). The map needs no
      serialized state beyond `terrainSeed`: `World` regrows it bit-identically on
      load (`SAVE_VERSION` bumped to 2), and terrain generation runs on its own
      internal rng so it never perturbs the main simulation stream. The renderer
      paints a grass backdrop and lays the water/fertile/barren patches over it.

- [x] Weather & seasons layered over the day-night cycle. Two slower rhythms
      (`src/weather.js`) ride on top of the daily one, both *pure functions of
      `world.time`* — so, like the day-night cycle, they add no serialized state,
      stay bit-identical across save/load, and read the same at any speed.
      **Seasons** are a slow raised-cosine "year" many days long (rich summers,
      lean winters, with autumn cooling and spring warming between). **Weather**
      flickers faster on top — rain spells and droughts drawn from deterministic
      smooth 1-D value-noise sampled at the clock (a bit-mixing integer hash
      interpolated with smoothstep, two octaves for texture). Their product is a
      floored food multiplier that *multiplies* the day-night `foodGrowthFactor`
      in `World.update`, so the larder now breathes on both a daily and a longer
      boom/bust timescale. The renderer washes the scene cool-blue in rain and
      dry-warm in drought (alongside the night veil), `stats()` surfaces the live
      season/weather/climate values, and the HUD shows the season (Summer / Autumn
      / Winter / Spring), the weather (Drought…Storm), and the combined climate
      food percentage.

- [x] Weather nudges behaviour, not just the food supply. Two wet-weather effects
      (`src/weather.js`) layer on top of the climate's food modulation, both —
      like the rest of the weather layer — *pure functions of `world.time`*, so
      they add no serialized state and replay bit-identically. Only the wet half
      of the weather signal bites, so rain and drought trade off against each
      other: **rain dims sight** (`weatherSenseFactor` shrinks a creature's sense
      range toward a floor in a downpour, so the food a rain spell grows is harder
      to actually find) and **storms buffet headings** (`windStrength` ramps up
      past a calm onset into a gale, and `Creature.update` adds a wind-scaled
      random kick to the heading each step, knocking even a creature locked onto
      food off its line). Drought is the dry, calm opposite — clear to see through
      and still to steer in — so a spell is double-edged: rain feeds the world but
      fogs and jostles it, drought starves it but leaves it legible. The buffet
      draws on the main rng, so it stays a true save/load continuation (the
      weather test's round-trip now checksums creature motion to prove it).

- [x] Wind has a *direction*, not just a strength. A slowly turning prevailing
      wind (`windDirection` in `src/weather.js`) sweeps one full turn around the
      compass per `windTurnSeconds`, with a smooth value-noise wobble layered on
      so the bearing meanders rather than sweeping evenly. Like the rest of the
      weather layer it's a *pure function of `world.time`* — no serialized state,
      bit-identical across save/load, identical at any speed. The direction
      exists in all weather but only *bites* when a storm stirs a real wind, and
      then it bites two ways: **creatures get a coherent push** (`Creature.update`
      now steers every heading toward the same downwind bearing, scaled by
      `windPush` × strength, *before* the existing random gust jitter — so a gale
      herds the whole population one way instead of only scattering it), and
      **food drifts downwind** (`World.update` nudges every pellet along the
      bearing by `windFoodDrift` × strength, slowly raking the larder across the
      world in the same direction). The buffet still draws on the main rng so it
      stays a true save/load continuation, and the round-trip test's checksum now
      covers food positions too, since the drift must replay identically. The
      renderer rakes faint streaks across the scene along the bearing when the
      wind blows, `stats()` surfaces the live `wind`/`windDir`, and the HUD shows
      the wind as a compass point (Calm…NE) with its strength.

- [x] Wind carries *scent* / pheromone trails, not just bodies. A drifting
      chemical field (`src/scent.js`, a `ScentField` owning the plumes plus their
      own `SpatialGrid`) turns the prevailing wind into an information channel.
      Creatures lay faint plumes as they live — a **food** plume when feeding and
      a strong **danger** (blood) plume where one is killed — and others *smell*
      the field at their full `sense`-gene reach, undimmed by rain (smell carries
      when sight fails, so it complements the weather-fogged eye). The field reads
      back as a steering nudge whose sign depends on diet: **food** scent draws
      grazers (weighted by herbivory), while **danger** scent splits the world —
      a herbivore flees the blood while a carnivore homes in on it, the same
      death-marker repelling prey and summoning predators on one field. Plumes
      ride the same storm wind that drifts food (faster, being airborne — so a
      gale smears them into downwind trails), fade linearly until forgotten, and
      are capped so a busy world stays bounded. Unlike the pure-in-time weather
      layer this is *real state* (it depends on what creatures did), so it
      serializes into the save (`SAVE_VERSION` bumped to 3); but emission, drift,
      and decay draw no fresh rng, so a restored field replays bit-identically
      (the scent test round-trips a checksum over every plume). The renderer
      paints plumes as soft green/red hazes under the food, `stats()` surfaces the
      live plume count, and the HUD shows a **Scent** row.

- [x] Scent *signalling* is now heritable, so it evolves under selection instead
      of firing as a fixed reflex. Four genes join the genome (`src/genome.js`,
      all in `[0,1]` so mutation clamps them like any other gene): a **voice** for
      each plume kind (`foodVoice`, `alarmVoice`) sets how loudly the creature
      emits it, and a **trust** for each (`foodTrust`, `alarmTrust`) scales how
      strongly it heeds that plume on the air (`ScentField.steer` now multiplies
      each kind's pull by the smeller's trust, defaulting to 1 so old callers are
      unchanged). Emission costs energy in proportion to loudness (`Creature.signal`
      spends `scent.emitCost` × strength and skips any plume too faint to outlast
      the decay floor — so near-silence is free), which makes silence a viable
      strategy and advertising a gamble. The food plume a grazer drops is now
      scaled by `foodVoice`; on top of the involuntary blood a kill still spills,
      a creature can also **cry wolf** — lay a *voluntary* danger plume (up to
      `scent.alarmRate`/sec, scaled by `alarmVoice`), indistinguishable on the air
      from real blood. Splitting emit from response per kind is what opens the
      strategy space the field was built for: an honest crier warns neighbours of
      a hunt, while a **deceiver** pairs a loud `alarmVoice` with a deaf
      `alarmTrust` to scatter rival grazers off contested food while standing its
      own ground. The cry draws on the main rng, so it replays bit-identically
      across save/load (the genes ride the existing genome serialization;
      `SAVE_VERSION` bumped to 4 so a pre-signalling save is rejected rather than
      loaded as a NaN-steered creature). `stats()` averages the four new traits
      and the HUD shows a **signalling** block (food/alarm voice and trust), so
      the population's drift toward honesty, silence, or deception is legible.

- [x] Kin recognition, so cooperation has something to select for. Honest *food*
      signalling was pure altruism — broadcasting your larder only fed
      competitors — so `foodVoice` had no upward pressure and would erode to
      silence. Now every plume carries the lineage hue of whoever laid it
      (`ScentField.emit` tags each plume; `Creature.signal` and a kill's blood
      plume pass the emitter's / victim's `lineageHue`), and a new heritable
      `kinship` gene (`src/genome.js`, in `[0,1]` so it mutates and clamps like
      any other) weights a creature's scent *response* by how close the caller's
      hue is to its own. `ScentField.steer` multiplies each plume's pull by a kin
      weight `1 − kinship·(1 − hueSimilarity(self, plume))`: at kinship 0 the
      creature is kin-blind and heeds every plume by diet/trust alone (the old
      behaviour, so all prior callers and tests are unchanged), and as kinship
      rises it discounts strangers' plumes toward zero and answers mostly its own
      kin. `hueSimilarity` (`src/genome.js`) is a circular, tolerance-scaled
      closeness (`scent.kinTolerance` degrees — wide enough to span a clade given
      the ~5°/gen `lineageDrift`, narrow enough that diverged lineages read as
      strangers); a null/untagged hue (an older save's plumes) counts as fully
      similar, so kin recognition degrades gracefully rather than silencing the
      field. This is the lever the signalling arena needed: a loud larder-call
      that mainly draws relatives (who share the `foodVoice` gene) is favoured by
      inclusive fitness where one that fed every passing competitor was not — so
      the arena becomes a tension between kin-directed honesty and
      stranger-directed deception, not "silence always wins". The plume hue rides
      the save (`ScentField.serialize`/`deserialize` carry it as a 5th tuple slot;
      `SAVE_VERSION` bumped to 5 so a pre-`kinship` genome is rejected rather than
      loaded NaN-steered), and emission/response draw no fresh rng, so a restored
      world replays bit-identically (a dedicated `test/kin.test.mjs` covers the
      gene, the hue similarity, the kin-weighted steer, and the plume tagging).
      (Exposed and fixed a latent serialize asymmetry along the way: a creature
      killed *after* its own turn used to linger in `world.creatures` as an inert
      corpse until the next step, which a save taken at that boundary would drop —
      diverging the `deaths` count on resume; `World.update` now sweeps those late
      deaths out at end of step, a change neutral to the dynamics since a dead
      creature draws no rng and is skipped by every query.) `stats()` averages
      `kinship` and the HUD shows a **Kinship** row.

- [x] Kin-weighted *emission*, the other half of the lever. Response-side kin
      recognition let a creature choose *whom to heed*, but a loud caller still
      paid the full energy cost of advertising to everyone within earshot, kin or
      not. Now a creature also modulates *how loudly* it calls by how many close
      kin are nearby. `World.kinDensity(self, radius)` is the cheap read: it scans
      the existing creature grid within the smeller's `sense` reach and sums each
      live neighbour's `hueSimilarity` to `self` (1 for a clone, fading to 0 past
      `kinTolerance`), squashed to `[0,1]` against `scent.kinDensityNorm` — the
      hue-weighted kin count at which the read saturates. The food call laid on
      feeding (`Creature.update`) is then gated by it through the *same* `kinship`
      gene that gates the response, with the exact mirror of the steer weight:
      `kinGain = 1 − kinship·(1 − density)`. So a kin-blind creature (`kinship` 0)
      calls at full `foodVoice` regardless of who's around (the old behaviour, so
      every prior caller/test is unchanged), while a kin-tuned one hushes among
      strangers — where broadcasting only feeds competitors — and calls up to full
      voice when relatives cluster around to benefit. Crucially the hush is
      *free*: a gated-down plume falls below the decay floor, so `Creature.signal`
      skips it and spends no energy, exactly the "quiet for free, pay only when it
      pays" economics the inclusive-fitness payoff needs. Reusing `kinship` (no new
      gene, no `SAVE_VERSION` bump) is what makes `foodVoice` and `kinship`
      co-evolve rather than only the latter doing the filtering. The flagged
      failure mode — collapse to silence everywhere — can't take hold by
      construction: the gate is gene-controlled and vanishes at `kinship` 0, so
      selection (not the mechanic) decides whether kin-gated calling beats
      kin-blind calling, on each clade's own terms. Emission draws no fresh rng,
      so a restored world still replays bit-identically; `test/kin-emission.test.mjs`
      covers the density read (saturation, hue-weighting, radius cutoff) and the
      gated call (kin-blind full voice, kin-loud, stranger-silent-and-free, graded
      between).

- [x] Safety in numbers, so kin clustering has a survival payoff beyond
      signalling. Kin-weighted emission already pulls relatives together around
      food, but grouping carried no direct benefit — a predator caught a lone
      grazer exactly as easily as one in a crowd. Now a kill is *diluted by the
      crowd*: when a predator has a victim in reach (`Creature.update`), the catch
      is rolled against a chance that falls with the local prey press.
      `World.preyDensity(predator, victim, radius)` is the cheap read — it scans
      the existing creature grid within `dilutionRadius` of the victim and counts
      the *other* creatures this predator could eat (the confusion set of
      alternative targets, the victim and predator themselves excluded), squashed
      to `[0,1]` against `dilutionNorm`, the crowd size at which the effect tops
      out. The catch chance is `1 − dilutionStrength·density`: a lone victim
      (density 0 → chance 1) is caught outright and draws no rng, so a solitary
      hunt is exactly as before, while a victim buried in a saturating herd is
      caught only at the floored chance `1 − dilutionStrength`. `dilutionStrength`
      is deliberately `< 1`, so even a dense herd leaves a real catch floor — the
      flagged failure mode (a herd that can never be eaten, which starves its
      predators and then itself) can't take hold: a kill is made *harder* in a
      crowd, never *unwinnable*. This gives flocking an emergent anti-predator
      payoff — a second reason (besides scent) for the population to aggregate, so
      herds can form for defence and predators must work to cut an animal out of
      one. The catch roll is on the main rng, so a restored world replays
      bit-identically (the persistence round-trip covers it; `preyDensity` and the
      gated catch get their own `test/safety.test.mjs` — the saturating, canEat-
      filtered, radius-bounded crowd read, the always-caught lone victim, the
      floored crowded kill rate, and the monotone fall between).

- [x] Sexual reproduction with genome crossover, so recombination — not just
      mutation — drives adaptation, and the *mode* of reproduction is itself
      under selection. A new heritable `mating` gene (`src/genome.js`, in `[0,1]`
      so it mutates and clamps like any other) sets how readily a creature breeds
      with a partner rather than cloning itself. In `Creature.reproduce` the
      creature that hits the energy threshold rolls `rng.chance(mating)`: on a hit
      it looks for a partner within `creature.mateRadius` (`World.findMate` — the
      nearest live other creature off the existing creature grid, no new index),
      and if one is in reach the child's genome is a **uniform crossover** of both
      parents (`crossover` in `src/genome.js`: each gene inherited independently
      from one parent or the other with equal chance, the neutral `lineageHue`
      following the initiating "maternal" line so clade colouring stays coherent
      as genes mix). The recombined genome is then run through the *same* `mutate`
      as before, so mutation rides on top of crossover. With a low `mating` — or
      simply nobody in reach — it falls back to the old asexual path (a mutated
      clone), so sex never stalls breeding for want of a mate; it only happens
      where there's someone to mix with, which ties it to the same clustering the
      scent/kin/herding layers already drive (so no dedicated mate-seeking is
      needed for a first cut). Only the initiator pays the energy cost (it's the
      one that crossed the threshold); the partner just contributes genes, which
      keeps the carefully-tuned energy economy untouched. A child's generation is
      one past the *older* of its two parents. The mode roll and crossover draw on
      the main rng, so a restored world replays bit-identically; the `mating` gene
      rides the existing genome serialization (`SAVE_VERSION` bumped to 6 so a
      pre-`mating` save is rejected rather than bred off a NaN). `stats()` averages
      `mating` and the HUD shows a **Mating** row, so the population's drift toward
      sex or cloning is legible. `test/sexual.test.mjs` covers the gene, the
      crossover (per-gene parentage, that it mixes both parents, hue from parent
      a), `findMate` (nearest / radius / self / dead exclusions), and the wired
      reproduce paths (clone at mating 0 even beside a partner, a real cross at
      mating 1 with a mate, the solo fallback to cloning, and generation bumps).

- [x] Mate *choice*, the natural follow-up to sexual reproduction. A breeder used
      to pair with whoever was nearest; now a heritable `mateChoice` gene
      (`src/genome.js`, in `[0,1]` so it mutates and clamps like any other) shapes
      *whom* it picks, along the same lineage-hue axis kin recognition already
      reads. The gene is centred at 0.5: `World.findMate` scores each candidate in
      reach by `pref·(2·hueSim − 1) − distWeight·(dist/radius)` (where
      `pref = 2·mateChoice − 1 ∈ [−1, 1]` and `hueSim` is the same
      `hueSimilarity`/`kinTolerance` closeness used by the scent layer) and takes
      the best. Above 0.5 the creature mates **assortatively** — it rewards
      hue-similar partners (homogamy), which can pull a clade toward reproductive
      isolation and so hands speciation a lever; below 0.5 it mates
      **disassortatively** — it rewards hue-distant partners (outbreeding /
      inbreeding avoidance), keeping a lineage mixing with strangers. The
      preference trades off against distance through a new
      `creature.mateChoiceDistWeight` (at 1.0, a full-strength hue preference can
      exactly offset a partner sitting a full radius further off), so choice only
      bends the pick among the partners actually in reach, and only bites when
      there is a real hue spread to choose across: at a neutral `mateChoice` (0.5)
      the hue term vanishes and the score is pure −distance, so it reduces
      *exactly* to the old "nearest wins" (a missing gene defaults to neutral too),
      and when every candidate is a stranger (or every one kin) the hue term is
      constant across them and distance breaks the tie back to nearest. This is the
      sexual-selection counterpart to `mating`: that gene sets *whether* to mix
      genes, `mateChoice` sets *with whom*. `findMate` still draws no fresh rng, so
      a restored world replays bit-identically; the gene rides the existing genome
      serialization (`SAVE_VERSION` bumped to 7 so a pre-`mateChoice` save is
      rejected rather than mated off a NaN preference). `stats()` averages
      `mateChoice` and the HUD shows a **Mate choice** row, so the population's
      drift toward homogamy, indifference, or outbreeding is legible.
      `test/mate-choice.test.mjs` covers the gene, the equidistant kin-vs-stranger
      pick at each extreme, the preference overruling distance within the radius,
      the fall back to nearest with no hue spread / at neutral / with the gene
      missing, and that the choice is wired through `reproduce` (an assortative
      breeder actually crosses with the far kin it picks, never the near stranger).

## Next up

- [ ] Make mate choice *cost* something, so sexual selection has a real tension
      rather than a free preference. Right now a picky breeder pays nothing to
      reach past the nearest body for a better-matched one. Options: a courtship
      energy/time cost that scales with how far the chosen mate is (or how picky
      the gene is), an explicit mate-search radius gene that trades reach against
      metabolism, or letting the *chosen* partner also exercise a veto (mutual
      choice) so a pairing needs both to agree. Or pick another seed below.

## Ideas / someday

- Simple neural-net brains instead of hand-tuned genome weights.
- Speciation readout: with assortative mate choice now able to isolate clades,
  track and surface *how many* distinct lineage-hue clusters are breeding-isolated
  over time (a species count in the HUD / a charts panel), so emergent speciation
  is legible rather than only inferable from the colour bands.
