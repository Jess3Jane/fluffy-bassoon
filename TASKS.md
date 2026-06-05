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

- [x] Mate choice now *costs* something, so sexual selection carries a real
      tension rather than a free preference. Before, a picky breeder reached past
      the nearest body for a better-matched partner for free; now `Creature.reproduce`
      charges a **courtship toll** scaled by how far the chosen mate is —
      `creature.courtshipCost · (distance / mateRadius)` — drawn from the
      initiator's energy *before* the child's half-share is carved off, so the
      courtship genuinely shrinks what the pair invests in offspring. A neutral
      breeder (`mateChoice` 0.5) takes the nearest body and pays a pittance; a
      picky one that reaches across the lineage-hue axis for a far kin (or far
      stranger) pays for the extra ground it courted, so `mateChoice` is now under
      a cost gradient — homogamy and outbreeding are only worth it when the better
      genetic match outweighs the energy spent reaching for it. The toll is capped
      well under `reproduceCost` (so sex itself stays economical, it just taxes
      *choosiness*), and the asexual / no-mate path pays nothing — exactly as
      before, so every prior reproduce test is unchanged. Computed from positions
      alone (`wrapDistSq`, no fresh rng), so a restored world still replays
      bit-identically; no new gene and no serialized state, so `SAVE_VERSION` is
      untouched. `test/courtship-cost.test.mjs` covers the formula (the exact
      distance-scaled toll on parent and child energy at several distances), its
      monotonicity in distance, that a picky assortative breeder pays strictly more
      than a neutral one for the same layout (and exactly the far-kin toll), and
      that the asexual path pays `reproduceCost` only.

- [x] Speciation readout, so emergent speciation is legible rather than only
      inferable from squinting at the lineage-hue colour bands. A pure
      `countHueClusters(hues, tolerance, minSize)` (`src/genome.js`) clusters the
      live population's lineage hues by **single-linkage along the colour wheel**:
      it sorts the hues, walks the ring, and breaks one cluster from the next
      wherever the circular gap between neighbours exceeds `tolerance` — so a
      clade chains together into one cluster even when it has drifted wider than
      the tolerance end-to-end (no internal gap exceeds it), while two clades
      separated by a real gap read as two. The seam at 0/360 is handled (the
      wrap-around gap is measured circularly, so a clump straddling it stays one),
      and a full ring with no break anywhere counts as one cluster, not zero. Only
      clusters with at least `minSize` members are tallied (`CONFIG.speciation.
      minClusterSize`, 3), so a lone mutant or a dying splinter doesn't inflate the
      count. It clusters against the *same* `scent.kinTolerance` kin recognition
      reads, so a clade reads as one species exactly as it reads as one kin group.
      `World.stats()` collects the hues in its existing single pass over creatures
      and surfaces a `species` count; it's pure observation derived from live
      state, changing nothing about the simulation and adding nothing to the save
      (no `SAVE_VERSION` bump). The HUD shows a **Species** row, the `History` ring
      samples `species` like the other series, and `src/charts.js` gains a third
      stacked sparkline panel (scaled to its own windowed peak so a split from one
      clade into two or three is visible despite the small raw numbers; the charts
      canvas grew to fit). `test/speciation.test.mjs` covers the empty/singleton
      edges, a tight clump, a wide-but-chained clade, two and three separated
      bands, the 0/360-seam wrap, the no-break full ring, the size floor dropping a
      splinter, identical hues, and the wiring through `World.stats()`.

- [x] Speciation now has a *behavioural* definition alongside the colour one —
      realised reproductive isolation (option (b) of the prior seed). The hue
      species count clusters by the neutral `lineageHue` marker, which tracks
      *ancestry* but says nothing about whether two clades still actually
      interbreed; this measures that directly. The world keeps a rolling ring of
      the last `CONFIG.speciation.matingWindow` (200) **sexual** matings
      (`World.recordMating`, `world.matingRing`), one bit each: 1 if the pairing
      *crossed a lineage* — the two parents more than `scent.kinTolerance` apart
      on the hue wheel, i.e. `hueSimilarity ≤ 0`, the very threshold the kin/scent
      layers and the hue species count use to tell kin from stranger — and 0 if it
      stayed within one. `Creature.reproduce` logs a bit for every two-parent
      cross (right where it already pays the courtship toll), and *only* there:
      the asexual clone path is no mating in this sense and logs nothing, so the
      read reflects the sexual portion of breeding — itself gated by the `mating`
      gene. `World.stats()` reports `matings` / `crossMatings` over the window and
      `isolation = 1 − crossShare` (the within-lineage share), `null` until any
      sexual mating is on record so the HUD shows "—" rather than a misleading 0%
      before sex even happens. This is the behavioural counterpart the colour
      count lacked: as assortative `mateChoice` and the distance-scaled courtship
      cost pull breeding inward, the logged cross-rate falls and isolation rises —
      *that fall is speciation happening*, and `mateChoice` + courtship cost are
      exactly the levers that drive it. The ring is pure observation (it draws no
      rng and feeds nothing back into the dynamics), so it never perturbs the
      deterministic stream; it *is* accumulated state, so it serializes for a true
      continuation — but an older save lacking the field loads with an empty ring
      (the read just refills as breeding resumes) rather than being rejected, so
      no `SAVE_VERSION` bump was needed. The HUD gains an **Isolation** row, the
      `History` ring samples `isolation` like the other series, and `src/charts.js`
      gains a fourth stacked sparkline panel (already a 0–1 quantity, so it needs
      no scaling; the charts canvas grew to fit). `test/isolation.test.mjs` covers
      the ring bookkeeping (fill, window cap, exact share, all-within / all-cross
      edges), the reproduce wiring (within-lineage vs. cross classification, and
      the asexual path logging nothing), and the serialize round-trip plus the
      graceful empty-ring load of a legacy save.

- [x] Ecological (adaptive-gene) species count, so an ecological split shows up
      even when the neutral colour drift hasn't caught up. The hue species count
      and the isolation ring both measure ancestry along the neutral `lineageHue`
      marker; neither looks at the *adaptive* genome, so a clade that has split
      ecologically — half of it turned carnivore — while keeping one hue band read
      as a single species by both. This is option (a) of the prior seed: a
      genetic-distance count that clusters the live population on its adaptive
      genes. `countGeneClusters(genomes, threshold, minSize)` (`src/genome.js`) is
      the multi-D mirror of `countHueClusters`: each genome maps to a point in
      normalised gene space (`geneVector` — every gene in `GENES`, each scaled to
      `[0,1]` against its range; the neutral hue is excluded), two points are
      *linked* when they sit within `threshold` on *every* gene (**max-norm /
      Chebyshev** closeness — the multi-D echo of the 1-D hue gap), and species are
      the **single-linkage connected components** of that graph (union-find with
      path-halving), tallying only components meeting the same `minClusterSize`
      floor the hue count uses. Requiring closeness on *all* genes is the crux: a
      real gap in any single adaptive gene (diet 0.1 vs 0.9, say) severs the link
      and splits the cluster even while the hue stays one band — the disagreement
      the readout exists to surface — whereas a mere *spread* with no gap (a
      continuum of intermediates) still chains into one species, exactly as
      speciation needs a gap rather than variance. `CONFIG.speciation.geneTolerance`
      (0.4) is set above the within-clade per-generation drift (~0.12/gene std, so
      a parent–child pair's largest-gene gap is typically ~0.25, and a 40-step
      drift chain still reads as one species — the test asserts this) but well
      below a full-range gene swing, so a clade reliably chains while a substantial
      single-gene divergence reads as distinct. The clustering is O(n²), so it's
      skipped above `CONFIG.speciation.maxClusterPop` (2000) and reported as `null`
      there (HUD shows "—") rather than stalling the loop; the cheap O(n log n) hue
      count is always computed. Pure observation derived from live state — it draws
      no rng, changes nothing about the simulation, and adds nothing to the save
      (no `SAVE_VERSION` bump). `World.stats()` collects the genomes in its existing
      single pass and surfaces a `geneSpecies` count; the HUD gains an **Eco
      species** row beside **Species**, the `History` ring samples it, and the
      species chart panel plots it as a second line ("eco") sharing the hue
      panel's axis (scaled to whichever peaks higher) so the two lines diverging
      *is* an ecological split outrunning the colour drift. `test/gene-species.test.mjs`
      covers `geneVector`, the empty/singleton/floor edges, identical genomes, the
      single-gene split, the no-gap spread chaining into one, the all-genes max-norm
      linkage rule, the size floor dropping a splinter, a drift chain staying one,
      the wiring through `World.stats()` (one hue band split into two diet ecotypes
      — the hue count says 1, the gene count says 2), and the population guard
      returning null over the cap while the hue count still reports.

- [x] Resource partitioning / niche specialisation, so an ecological split has an
      ecological *consequence* — diverged ecotypes stop competing head-to-head —
      and the `geneSpecies` count becomes something the dynamics actively drive
      toward rather than a passive readout. There are now **two plant kinds** (0
      and 1): a pellet's `kind` is a pure function of where it sprouts
      (`plantKindAt` — two offset sine bands carving the world into smooth
      ~quarter-size patches), so the species grow in distinct regions (a *spatial*
      sub-resource axis) and — deliberately — assigning a kind draws no rng, so the
      whole change leaves the deterministic stream byte-identical (every existing
      replay/save test still passes untouched). A new heritable gene `forage`
      (`src/genome.js`) sets which kind a herbivore is suited to: 0 specialises on
      kind 0, 1 on kind 1, 0.5 is a generalist taking either. `forageYield(forage,
      kind)` is the single source of truth — `match^forageExponent` where `match`
      is how well the gene aligns with the kind (1 perfectly specialised, 0 the
      opposite, 0.5 generalist), returning 0 below `forageMinEff`. The exponent
      (1.4, > 1) makes the curve **convex**, so two specialists out-yield one
      generalist — the disruptive-selection pressure; the floor means a creature
      *won't consume* a plant too far off its specialism, so each ecotype leaves
      the other's resource untouched (clean partitioning, not interference
      competition that strips the shared larder). The band of `forage` values
      clearing the floor on both kinds is the generalist niche; outside it a
      creature forages one kind only. The gene drives both behaviour and yield:
      `World.nearestFood` takes a `forage` arg and a specialist *seeks* only its
      own kind's patches (omitting it keeps the old "nearest of any kind", as the
      grid self-test relies on), and `World.forageNear` (replacing
      `consumeFoodNear`) consumes only the kinds the forager benefits from and
      returns `{ count, gained }` — the efficiency-weighted yield to turn into
      energy. Because `forage` is an ordinary adaptive gene it joins `geneVector`,
      so a forage gap registers in the ecological species count — the partitioning
      this gene enables is exactly what that readout was built to surface, and a
      20-minute run shows it working: when the population drifts to one specialism
      the *other* kind piles up unexploited, creating invasion pressure that
      frequency-dependent selection rapidly answers (the open niche pulls `forage`
      back within a minute), the `eco` count sitting at 2–6 coexisting ecotypes
      while the population rides the same boom/bust band as before (a matched
      specialist still gets full yield, so the food economy is only modestly
      tighter — generalism is the discount, specialism the payoff). The HUD gains
      an **Avg forage** row and splits **Food** by kind (`A/B`), the avg-traits
      chart plots forage as a fourth line, and the renderer draws the two kinds in
      distinct hues (green / violet) so the spatial patchwork and which kind a
      clade has settled onto read at a glance. `SAVE_VERSION` → 8 (a pre-v8 genome
      lacks `forage` and a pre-v8 pellet lacks `kind`, both undefined behaviour, so
      old saves are rejected); food serializes as `[x, y, kind]`.
      `test/forage.test.mjs` covers the yield curve (convexity, the floor, kind
      symmetry, monotonicity), the forage-aware sense and eat (a specialist leaves
      the off-kind plants, a generalist takes both), the stats/`foodByKind` wiring,
      both kinds growing in a seeded world, and the kind round-tripping through
      save/load.

- [x] Niche partitioning at the **second trophic level**, so the predator niche
      splits by prey size the way `forage` splits the grazer niche by plant kind —
      predation is no longer a single `diet` axis over one undifferentiated prey
      pool. A new heritable gene `hunt` (`src/genome.js`, in `[0,1]` so it mutates
      and clamps like any other) is a carnivore's *preferred prey size* on the
      normalised `size` axis: near 0 a small-prey specialist, near 1 a large-prey
      specialist, mid a medium-body hunter. `huntYield(hunt, preySize)` is the
      single source of truth — the prey-size mirror of `forageYield`: it normalises
      the victim's `size` gene onto `[0,1]`, takes `match = 1 − |hunt − sizeN|`
      (how closely the preference lands on the body), raises it to
      `huntExponent` (1.4, > 1 so the curve is **convex** — honing onto one
      prey-size band out-yields hunting across all sizes, the disruptive-selection
      pressure), and returns 0 below `huntMinEff` (0.25, mirroring the forage
      constants). The gene drives both *whom* a predator hunts and *how much* it
      gains: `World.nearestPrey` / `preyInReach` skip any body whose `huntYield`
      is 0 (a small-prey hunter *leaves* the big bodies for a large-prey ecotype —
      clean partitioning, not interference that strips a shared prey pool), and a
      kill's meat is scaled by `huntYield` in `Creature.update` (a size-matched
      catch yields full meat, a band-edge one a discount), so committing to one
      prey-size band pays the clade that splits onto it. `World.preyDensity` (the
      safety-in-numbers confusion set) is gated by the same rule — only prey the
      predator would actually strike at confuse it, so a herd of large bodies does
      nothing to shield a small victim from a small-prey specialist. All three
      queries fall back to the old "any catchable prey" behaviour when the `hunt`
      gene is absent (defensive parallel to `nearestFood` omitting `forage`), so
      no prior predation caller breaks. Because prey size is *itself* an evolving
      gene, the two trophic levels co-evolve: size-specialised predators push prey
      to diversify their bodies to evade them, which hands the predators new modes
      to split across — a richer feedback than the spatially-fixed plant kinds.
      Being an ordinary adaptive gene, `hunt` joins `geneVector`, so a split in
      hunting preference registers in the ecological species count just as a forage
      split does. The strike and meat draw on the existing rng path (no fresh
      draws), so a restored world replays bit-identically; `hunt` rides the genome
      serialization (`SAVE_VERSION` → 9 so a pre-`hunt` save is rejected rather
      than scored off a NaN yield). `stats()` averages `hunt` and the HUD shows an
      **Avg hunt** row beside **Avg forage**; the avg-traits chart plots it as a
      fifth line. A 10-minute headless run holds a stable population with active
      predation (≈870 kills) and 2 coexisting ecotypes, no NaNs.
      `test/hunt.test.mjs` covers the yield curve (full-value match, convexity,
      monotonicity, the floor, size symmetry), the hunt-aware sense/strike/
      confusion queries (a specialist leaves the off-size body, the gated
      `preyDensity`), the meat-yield scaling through a real kill, the stats wiring,
      and the gene round-tripping through save/load (with a pre-v9 save rejected).

- [x] The two plant kinds now have *different traits*, so a forage specialism
      trades off against the day-night cycle instead of being a symmetric
      coin-flip. A new module `src/plants.js` owns everything about how the kinds
      differ — `plantKindAt` (moved here, unchanged: the spatial patchwork that
      decides *where* each kind grows) plus the new bit, `kindYieldFactor(kind,
      time)`, which decides what a kind is *worth right now*. Each kind carries a
      `kindTraits` entry (`src/config.js`): an `energy` richness, a `dayLit` flag
      (peaks by day vs. night), and a `rhythmDepth` (how deeply its yield dips out
      of phase). The factor is `energy × rhythm`, where the rhythm rides the
      day-night `daylight` curve — 1 in the kind's own half of the cycle, dipping
      toward `1 − rhythmDepth` in the other, inheriting the raised-cosine's smooth
      dawn/dusk shoulders rather than switching hard. The two are deliberately
      *asymmetric*: **kind 0 (sunleaf)** is steady and day-leaning (energy 1.2,
      shallow 0.35 rhythm — never far from its mean), **kind 1 (moonleaf)** is
      feast-or-famine (energy 1.5, deep 0.7 rhythm — a richer midnight peak but
      nearly worthless by day). So which forage specialism *pays* crosses over the
      cycle: a day-grazer feasts cheaply at noon, a night-grazer reaps richly at
      midnight, and a generalist trades the convex forage discount for a yield
      that rides neither swing. Crucially the factor scales only *how much energy*
      a plant is worth, never *whether* a forager eats it — that stays the
      time-independent `forageYield` specialism gate, so a specialist still works
      its own kind at the lean hour, just for less. It folds into `World.forageNear`
      as a per-pellet multiplier on the energy gained; the eligibility/consumption
      logic is untouched, so every existing partitioning test still holds. The
      energies are picked so each kind's yield *averaged over a full day* lands
      near 1 — this layers a rhythm and a richness asymmetry onto the larder
      *without* making the world globally leaner (a 10-min headless run holds the
      same population swings and kill rate as before, and seeds that read as one
      ecotype now split into 3–4 as grazers diverge onto the two kinds). Being a
      **pure function of sim-time** (like the day-night/weather/season layers), it
      adds **no serialized state** — no pellet-shape or genome change, no
      `SAVE_VERSION` bump — and replays bit-identically across save/load. `stats()`
      surfaces a live `kindYield` pair and the HUD shows a **Plant yield** row
      (Sun %/Moon %) beside the larder split; the renderer fades each kind's
      pellets by its `kindRhythm` so a sunleaf patch glows by day and a moonleaf
      patch by night, making "which specialism pays now" read straight off the
      field. `test/plant-traits.test.mjs` covers the yield shape (richness ×
      rhythm, the rhythm band, the opposite day/night peaks and their cross-over,
      the smooth dusk intermediate), its flow through `forageNear` (a specialist
      gains more in its own phase), the `stats()` readout, the HUD labels, and that
      it slips no state into the save (yields match after a round-trip).

- [x] Make the *other* world rhythms tilt the plant kinds too, not just the
      day-night cycle. The per-kind yield now rides three nested clocks instead of
      one: `kindYieldFactor` (`src/plants.js`) is the static richness × the fast
      day-night `kindRhythm` × a new slow `kindClimateRhythm` (season × weather).
      Each kind carries a climate lean in `CONFIG.food.kindTraits`
      (`seasonLit`/`seasonTilt`, `wetLit`/`wetTilt`), and the two pull opposite
      ways on every axis: the day-leaning **sunleaf** also thrives in *summer
      rain*, the night-leaning **moonleaf** in *winter drought*. So the dominant
      forage specialism crosses over not just with the hour but with the season
      and the weather, stacking a slow boom/bust on the daily one — a clade must
      track all three cycles at once, or hedge harder as a generalist. Unlike the
      day-night rhythm's one-sided dip, each climate tilt is a *centred* swing
      (warmth via `seasonLevel`, wetness via `weatherNoise` mapped to [0,1]):
      because both signals are mean-symmetric it averages to ~1 over a year, so it
      redistributes *when* a kind pays without making the larder leaner long-run
      (the test asserts the per-kind annual mean stays within 4% of 1). It stays a
      **pure function of sim-time** like the layers it rides on, so it adds **no
      serialized state** and no `SAVE_VERSION` bump, and replays bit-identically
      across save/load. The renderer fades each kind's pellets by the *combined*
      rhythm (daily × climate, clamped), so a sunleaf patch now glows in a summer
      storm and dims in a winter drought as well as by day, making the boom/bust
      read straight off the field. `test/plant-traits.test.mjs` gains coverage of
      the climate cross-over (sunleaf richer in summer / wettest spell, moonleaf in
      winter / driest spell, isolated from the daily axis), the centred annual
      mean, and the three-way `energy × daily × climate` decomposition.

- [x] Heritable *climate tolerance*, so the season and weather swings select on
      the animals directly and not only through the larder they grow. Two new
      genes (`src/genome.js`, both in `[0,1]` so they mutate and clamp like any
      other) set a creature's preferred point on the two slow climate axes the
      world already swings along: `warmthPref` (the season) and `wetnessPref` (the
      weather). They change nothing about how a creature senses or moves — they
      set the climate it is *built for*. Living away from that point costs energy:
      `climateStress(warmthPref, wetnessPref, warmth, wetness)` is the squared
      drift of the current climate from the preferred point (in `[0,2]`, the
      mirror of `forageYield`/`huntYield` as a pure source-of-truth function), and
      `Creature.update` turns it into a *base-metabolism* multiplier
      `1 + climateStressCost · stress` — so a creature sitting in its preferred
      climate pays the base rate while one stranded far from it (a summer-adapted
      body in deep winter, a rain-adapted one in a drought) burns energy faster.
      The two climate axes are canonical pure-in-time readouts (`climateWarmth` =
      `seasonLevel`, `climateWetness` = the weather noise folded onto `[0,1]`, both
      in `src/weather.js`), so the whole tax is a pure function of sim-time and the
      genome — it draws **no rng**, leaving the deterministic stream byte-identical
      (every prior replay/save test passes untouched) and replaying bit-identically
      across save/load. Squaring the drift keeps everyday seasonal wobble a gentle
      tax and makes the extremes the real cull (winters cull the summer-adapted,
      droughts the rain-adapted — the climate is now a selective axis in its own
      right). Crucially this **pairs with the plant kinds' own opposite climate
      leans**: sunleaf thrives in summer rain, moonleaf in winter drought, so a
      clade is pulled to match its tolerance to the climate where its forage
      actually pays — coupling `warmthPref`/`wetnessPref` to `forage` rather than
      letting them drift freely. Being ordinary adaptive genes they join
      `geneVector`, so a climate-niche split registers in the ecological species
      count. `SAVE_VERSION` → 10 (a pre-v10 genome lacks the prefs, so its
      climate-stress metabolism would be NaN — the save is rejected rather than
      loaded). `stats()` averages both prefs, the HUD shows **Warmth pref** /
      **Wetness pref** rows beside the niche traits, and the avg-traits chart plots
      them as two more lines (`warm`/`wet`), so the population's drift toward the
      prevailing climate (and any split tracking the two plant kinds) is legible.
      A 10-minute headless run holds the same boom/bust population band (15–135,
      self-sustaining) with active predation and 4–6 coexisting ecotypes, no NaNs.
      `test/climate-tolerance.test.mjs` covers the stress curve (zero when matched,
      the squared/symmetric/monotone shape, the `[0,2]` cap), the climate axes, the
      gene plumbing, the *exact* metabolism wiring (energy falls by precisely the
      climate-taxed cost; a matched body keeps strictly more than an anti-adapted
      one, by exactly `base·eff·size²·climateStressCost·stress·dt`), the cull
      direction across the year, the `stats()` averages, and the save round-trip
      (genes preserved, a pre-v10 save rejected, the restored world replaying
      bit-identically).

- [x] Climate gained a *spatial* axis: a per-region **microclimate**
      (`src/microclimate.js`) layered under the global season/weather clock. Where
      the season and weather move the whole map up and down the warmth/wetness axes
      *together over time*, the microclimate is the orthogonal half — a static,
      per-region *offset* that makes one corner run warmer or drier than another at
      the very same instant (a sun-baked, dry south; a cool, damp north). It's two
      independent wrapping value-noise fields grown once from a seed with the same
      seamless-noise machinery as the terrain (`noiseField`/`sampleField`, now
      exported), on a deliberately coarse lattice so it carves broad regional
      patches rather than fine speckle. Generation runs on its own internal rng, so
      it never perturbs the simulation stream, and — like the terrain — the field
      itself is never stored, only the seed that regrows it bit-for-bit
      (`SAVE_VERSION` → 11; a pre-v11 save lacks the seed, so its local climate
      would be NaN-offset, and is rejected). The payoff is selection *across space*:
      `Creature.update` now taxes a creature against its **local** climate — the
      global `climateWarmth`/`climateWetness` *plus* the microclimate offset at its
      position, clamped back onto `[0,1]` (new `clamp01` in `src/math.js`) — so the
      same `warmthPref`/`wetnessPref` genes that tracked the year now also partition
      the population over the map, a warm-adapted clade pulled to settle the warm
      regions while a cold-adapted one holds the cool ones. It draws **no rng** once
      grown, so the deterministic stream stays byte-identical and a restored world
      replays bit-identically. `stats()` reports a **spatial-sorting correlation**
      per axis (each creature's local offset vs. its matching preference — positive
      once clades have settled into the climate that suits them, ~0 when prefs are
      scattered, null below two creatures or with no spread), surfaced as a HUD
      **Climate sort** row, and the renderer washes the ground a faint amber where a
      region runs warm and blue where it runs cool, so the mosaic the creatures sort
      along is visible at a glance. `test/microclimate.test.mjs` covers the field
      (determinism from the seed, seamless toroidal wrapping, offsets within their
      amplitudes, the two axes being independent geographies, real warm/cool
      spread), the *exact* local-climate metabolism wiring (energy falls by
      precisely the local-taxed cost; the same body keeps more energy in a warm
      region than a cool one), the sorting correlation (strongly positive when
      sorted, strongly negative when anti-sorted, null when empty), and the v11 save
      round-trip (seed preserved, field regrown sample-for-sample, a pre-v11 save
      rejected, the restored world replaying bit-identically). The existing
      climate-tolerance test neutralises the spatial amplitudes so it keeps
      isolating the global formula.

- [x] The microclimate now feeds back onto the **larder**, not only the animals,
      knitting the spatial climate mosaic and the plant-kind patchwork into one
      coherent biome instead of two independent overlays. Two centred knobs
      (`CONFIG.food.microclimateKindBias` / `microclimateFertilityBias`) let a
      region's warmth/wetness *offset* (the same per-region offset the creatures'
      `climateStress` already reads) bias the plants along the kinds' own climate
      leans: sunleaf (kind 0) thrives in warm, wet ground, moonleaf (kind 1) in
      cool, dry. A small source-of-truth in `src/plants.js`, `kindClimateScore(kind,
      dw, dm)` — `+(dw+dm)` for sunleaf, its negation for moonleaf — drives both
      halves. **Which kind** sprouts: `kindClimateBias` nudges `plantKindAt`'s
      threshold (now taking an optional `climateBias`, 0 for every old caller) so a
      warm-wet region tilts the sine patchwork toward sunleaf and a cool-dry one
      toward moonleaf, settling each region predominantly onto the kind its climate
      favours rather than the bare ~50/50 split. **How richly**: `kindFertilityFactor`
      lays a centred multiplier (`1 + bias·score`, floored at 0) over the terrain
      fertility roll in `World.spawnFood` — exactly the way terrain's own spatial
      fertility already shapes the larder — so an in-biome kind takes root more
      readily and an out-of-place sprout is suppressed, each region's favoured kind
      growing the denser. The food brush's explicit placements take the same
      biome-correct kind. Crucially this **closes the loop** with the
      climate-tolerance layer: a warm-adapted, sunleaf-foraging clade now has a
      single region that suits both its `warmthPref`/`wetnessPref` tolerance *and*
      its `forage` diet, so the two spatial sortings (animals into their climate,
      plants into theirs) reinforce one mosaic. The microclimate regrows bit-for-bit
      from its seed and draws no rng, so the spawn attempt count — and thus the
      whole deterministic stream — is unchanged from the terrain-only version, and a
      restored world replays bit-identically; the kinds ride the existing food
      serialization and the bias is recomputed from the seed-grown field, so there's
      **no new serialized state and no `SAVE_VERSION` bump** (an older v11 save loads
      fine — its stored pellet kinds are just data, new growth uses the new logic).
      `stats()` surfaces a **`biomeSort`** readout (the standing larder's mean
      normalised `kindClimateScore`, in [-1, 1]): positive as the spawn feedback
      knits the kinds to the climate, and a live tug against grazing (which strips
      the in-biome stock fastest, so a heavy bloom can pull it down), null with no
      food. The HUD shows a **Biome** row beside **Climate sort**; the renderer
      needs no change — the kind already colours each pellet (green sunleaf / violet
      moonleaf) over the microclimate's amber-warm / blue-cool wash, so the biome
      reads at a glance for free. A 10-minute headless run holds the same boom/bust
      population band (16–97, self-sustaining) with active predation (≈820 kills)
      and 4–7 coexisting ecotypes, no NaNs, and a freshly seeded larder reads a
      clearly positive biome alignment. `test/biome.test.mjs` covers the score
      (sunleaf/moonleaf opposites, the warm-wet/cool-dry signs, cancellation), the
      kind-threshold nudge (a spot flipped by a warm-wet region, kept by a cool-dry
      one, bare at zero offset), the fertility factor (boost in-climate, thin out,
      the [0, …] floor, flat 1 with no signal), the off-switch at bias 0, the wiring
      through `spawnFood` (a seeded larder sorts by region, both kinds still grow,
      explicit placement takes the biome kind), the `biomeSort` readout (positive,
      bounded, matching a hand computation, null with no food, null/NaN-free with a
      flat microclimate), and the bit-identical save/load replay.

- [x] The **larder feeds back onto the microclimate** — the last loop closed. The
      microclimate was a one-way driver (a static seed field that shaped which kind
      grows where, but nothing the plants did shaped it back); now the *standing*
      larder nudges its own local climate, so the climate map and the plant
      patchwork are a true two-way coupling. The nudge (`src/vegetation.js`) is
      *kind-aware*, which is what makes it more than a wash: each kind pulls its
      microclimate *toward the conditions it already thrives in* (sunleaf warms &
      dampens its understory, moonleaf cools & dries it — matching their own
      `kindClimateScore` leans), so a stand reinforces the very biome it grows in.
      Two guards from the brief keep it from running away: **bounded** — a per-cell
      signed lean (sunleaf +1, moonleaf −1, binned onto a coarse wrapping lattice)
      is squashed through `tanh`, so even a monoculture cell gives a finite nudge,
      ~20% of the static field's amplitude; **mean-respecting** — the lean is read
      *relative to the larder's global mean*, so the globally dominant kind is
      penalised on bare ground (a self-balancing pull) even as each patch sharpens
      locally, and the spatial-average nudge is ~0 (no global warming/cooling). It
      adds **no serialized state**: `VegetationField.rebuild(food)` recomputes the
      field each step from the live larder at the *step boundary* (before any of the
      step's growth or grazing), so a loaded world rebuilds the identical field from
      its restored food and replays bit-for-bit — no SAVE_VERSION bump. Everything
      that reads the local climate now goes through one combined accessor
      (`World.warmthOffsetAt` / `wetnessOffsetAt` = static microclimate + vegetation
      nudge): a creature's `climateStress`, a new plant's kind/fertility in
      `spawnFood`, and the renderer's amber/blue wash (which now breathes with the
      larder as stands rise, get grazed down, and shift the boundaries). At
      amplitude 0 the term vanishes and the world is identical to before. A 200s ×5
      headless sweep confirms the design: population holds its band (no
      barren/frozen runaway), both kinds persist, the larder's in-biome alignment
      *sharpens* (0.57 → 0.62), and a lopsidedly moonleaf larder (sun:moon ≈
      0.31:0.69 off) **rebalances toward an even split** (≈0.47:0.53 on) — the
      mean-respecting centring working exactly as intended.
      `test/vegetation.test.mjs` covers the pure field (empty → zero, rebuild
      determinism, the ±amplitude `tanh` bound, the kind-aware direction, the
      mean-respecting centring & ~0 spatial average), the combined `World` accessor
      and its no-food / amp-0 fallbacks, that `update` rebuilds from the live
      larder, and the no-new-state bit-identical save/load replay.

- [x] The vegetation feedback's **strength is now heritable**, so the loop's own
      gain evolves under selection instead of being a flat per-kind constant. Every
      pellet carries a `canopyAmp` gene (`src/genome.js`'s siblings live in
      `src/vegetation.js`; the gene rides the food serialization in `[0, 1]`) for
      how strongly it shapes its understory microclimate, and `VegetationField.rebuild`
      scales each plant's lean vote by `canopyAmp / neutral` — so a plant sitting at
      the `neutral` reference votes the old ±1 (the established feedback strength is
      preserved where the trait rests) while an over-/under-invester shapes the
      field more/less. The trait is *genuinely heritable*: a new sprout copies its
      **nearest same-kind parent's** investment (`World.parentCanopyAt`, off a
      dedicated `canopyGrid` rebuilt at the *step boundary* — kept apart from
      `foodGrid`, which is rebuilt after spawning, so the parent lookup reads the
      exact larder a save captures), mutated by `inheritCanopy`. Single-parent
      inheritance is the crux and the lesson of a first false start: a regional-mean
      inheritance (binning canopy onto a lattice and copying the cell average)
      *washed every mutant straight back to the mean*, pinning the trait inert at
      its start value no matter the selection — only copying a near-parent preserves
      a deviation long enough for selection to act on it. Two opposing pressures
      then shape the gene through one source-of-truth germination curve
      (`canopyGermination`): a **fecundity cost** (building canopy diverts from
      seed, so germination falls linearly with the parent's investment) pulls it
      down toward cheap, light-touch seeding, while a **facilitation benefit** (a
      parent's own canopy shelters its seedlings — a private, *saturating* return)
      pulls it up; their product peaks at an interior investment the population
      evolves toward. Crucially the equilibrium is **emergent, not dialled in**: a
      10-minute headless sweep shows the mean canopy pulled back to an interior band
      (~0.5) from *both* a forced 0.1 *and* a forced 0.9 within ~2 minutes of
      selection — the clean signature of a heritable trait under stabilising
      selection, not a constant. Because that band sits near the neutral reference,
      the established microclimate/biome feedback is left intact at equilibrium while
      now being actively *defended* (and free to diverge transiently as stands are
      grazed down and refound). The cost/benefit and inheritance draw on the main
      rng (the gene rides the existing food serialization), so a restored world
      replays bit-identically; `SAVE_VERSION` → 12 (food now serializes as
      `[x, y, kind, canopyAmp]`; a pre-v12 pellet lacks the gene, so its lean vote
      and germination would be NaN — the save is rejected). A 12-minute × 12-seed
      run holds the same boom/bust band as before (survivors 94–183 pop, active
      predation 500–1400 kills, 2–7 coexisting ecotypes, no NaNs). `stats()`
      surfaces the standing larder's mean `canopy` and the HUD shows a **Canopy**
      row; the renderer needs no change — its amber/blue climate wash already
      breathes with the now-evolved feedback strength for free. `test/canopy.test.mjs`
      covers the germination curve (the bare-1 at zero investment, the interior
      optimum beating both extremes, non-negativity, the steeper-cost response),
      inheritance (parent-centred mean, the [0, 1] clamp at the rails), the
      nearest-parent lookup (same-kind nearest, off-kind skipped, neutral fallback
      for a pioneer), the canopy-scaled vote (neutral == legacy ±1, heavy > light),
      the `spawnFood` wiring (explicit sprouts inherit the local stand), the `stats`
      readout, the **selection itself** (recovery toward the interior from both 0.1
      and 0.9 in a living world), and the v12 save round-trip (gene preserved,
      bit-identical replay, a pre-v12 save rejected).

- [x] **UI/UX: a creature inspector**, so the rich per-creature genome the world
      evolves — until now only ever shown as population *averages* in the HUD —
      becomes tangible on the individual. A third interactive brush, **Inspect**
      (joining Food / Creature in the existing `Tool` toggle, `src/tools.js`),
      turns a click into a *pick*: `World.creatureAt(x, y, tolerance)` returns the
      live creature nearest a world point within its body plus a little slack (the
      nearest wins when several overlap, dead bodies are skipped, and the lookup
      wraps across the toroidal edges like every other spatial query). It scans
      the live list directly rather than the creature grid — a one-off, human-rate
      click is trivially cheap to scan, and a direct scan always reflects exact
      current positions (the grid is only rebuilt at the step boundary, so a body
      that moved mid-step could sit a cell off). A click on empty ground returns
      null, which the UI reads as "deselect". The selection is held in `main.js`
      *by creature id*, not by reference, and re-resolved to the live object each
      frame — so it survives the creature list reordering and naturally clears the
      instant the creature dies or the world is swapped on reset/load (a vanished
      id is dropped so it isn't re-scanned). The renderer rings the selected
      creature and traces its `sense` reach with a dashed circle
      (`Renderer.drawSelection`), so the inspected individual is easy to follow
      through the crowd and how far it perceives food/prey reads at a glance. A
      side panel (top-right, `#inspector`) reads out that one creature's live
      vitals (trophic role, generation, age, an energy bar coloured red→teal
      against the species cap, position) and its **full genome**, grouped into
      Body & senses / Diet & niche / Social sections that mirror how the genome
      itself is organised, each gene shown with its value *and* an inline meter
      placing it within its legal `[min, max]` envelope (read straight off `GENES`)
      — so "high-speed, kin-blind, assortative breeder" reads without memorising
      every gene's range. A lineage-hue swatch ties the panel back to the
      on-canvas lineage colouring; the close button and `Esc` both dismiss it, and
      the canvas cursor switches to a pointer in Inspect mode. Purely a *view* of
      live state — it draws no rng, adds no serialized state, and touches no
      simulation logic (no `SAVE_VERSION` bump), so every existing replay/save
      test passes untouched. Bundled a small UX fix along the way: the left HUD,
      which had grown to ~35 stat rows plus the charts and controls, could overrun
      a short viewport and push its own buttons off the bottom (the body clips
      overflow) — it now caps at the viewport height and scrolls within itself, so
      the controls stay reachable. `test/inspect.test.mjs` covers the pick
      (empty-ground null, a dead-centre and body-edge hit, the tolerance ring
      boundary, nearest-of-overlapping wins, dead bodies excluded, and the
      toroidal-seam wrap); the DOM panel and pointer wiring need a browser, so —
      like the renderer and main entry point — they're exercised by hand rather
      than in the headless suite.

- [x] **UI/UX: a pan/zoom camera** (follow-up (a) to the inspector), so a large
      world can be explored up close — the inspector highlight made *following* one
      creature meaningful, but you still couldn't get *near* it. A pure `Camera`
      (`src/camera.js`) holds a `zoom` and a world-space centre and resolves the
      renderer's existing `{ scale, offsetX, offsetY }` transform triple each frame
      (`Camera.view`), so the draw pass and `screenToWorld` are unchanged in shape —
      they just read a camera-resolved transform instead of a fixed one. The crux is
      that it's a clean *generalisation* of the old fit: at `zoom` 1 with a null
      centre it falls out **byte-for-byte identical** to the previous
      letterbox-the-world-to-the-viewport mapping (the test asserts the scale and
      both offsets against an independent recomputation, incl. the centred margin on
      the non-limiting axis), so the default view is exactly as before and the
      feature is purely additive. Zoom is clamped to `[1, 12]` — you can't zoom out
      past the whole-world fit — and the centre is clamped so the visible window
      never leaves `[0, world]`; on an axis where the world can't fill the view (the
      letterboxed axis, or any axis at zoom 1) the centre is pinned dead-centre,
      which is what reproduces the old letterboxing. `Camera.zoomAt(factor, sx, sy)`
      zooms while pinning the world point under a screen pixel (zoom-toward-cursor /
      pinch-focus — it clamps zoom *first*, so a focus-zoom against the rail just
      stops rather than drifting the centre), and `panByWorld` / `panByScreen` move
      the centre (the latter keeping a grabbed point under the dragging pointer).
      A `CameraController` owns the browser input and is deliberately kept *out of
      the editing brushes' way*: the brushes own a single primary-button (left /
      one-finger) stroke, while the camera claims everything else — the **wheel**
      (zoom toward the cursor), **middle/right-drag** and **two-finger pinch-and-pan**
      (pan + zoom about the centroid), the **arrow keys** (pan) and **+/−** (zoom),
      plus an on-screen **+ / − / ⤢** cluster (bottom-right) that also covers touch
      and discoverability. The two controllers never fight over a gesture: the
      `ToolController` independently tracks its active pointers and abandons any
      stroke the instant a second pointer joins (a pinch) or a non-primary button is
      used, each controller maintaining its own pointer set off the shared canvas
      events rather than coordinating. The renderer keeps drawing the whole world in
      world-space under the camera transform — the canvas clips to the viewport for
      free, so a zoomed view costs nothing extra. Purely a *view*: it draws no rng,
      adds no serialized state, and touches no simulation logic (no `SAVE_VERSION`
      bump), so every existing replay/save test passes untouched. `test/camera.test.mjs`
      covers the pure maths headlessly — the zoom-1 fit reproduction (scale + both
      offsets, limiting vs. letterboxed axis), the screen↔world round-trip, the
      zoom and centre clamping (both edges, the pinned letterboxed/limiting axis),
      `zoomAt` pinning the focus pixel (and staying clamped against the rail), and
      `panByWorld` / `panByScreen` moving the view (the grabbed point following the
      drag); the DOM input wiring needs a browser, so — like the renderer, tools, and
      main entry point — it's exercised by hand rather than in the headless suite.

- [x] **Condition-dependent canopy optimum: the niche-construction gain becomes a
      spatial selection target.** The heritable `canopyAmp` gene (how hard a plant
      shapes its understory) was already under selection, but the *balance* that set
      its optimum — a falling fecundity cost against a saturating facilitation
      (shelter) benefit, in `canopyGermination` — was the same everywhere, so the
      evolved gain settled to one global band. This ties the *shelter* benefit to
      where seedlings actually struggle, so the optimum **diverges across the map**:
      `canopyGermination(c, harshness)` now scales the facilitation term by the local
      harshness, and `World.canopyHarshnessAt(x, y)` reads that harshness off the
      terrain (the complement of tile fertility — a sprout most needs cover on barren
      soil, least on fertile). The fecundity cost is unchanged, so on harsh (barren)
      ground the shelter is worth its cost and the optimum climbs (~0.41), while on
      benign (fertile) ground cheap light-touch seeding wins and it falls (~0.22) —
      a clade founding on barren soil is selected toward heavy canopy, one on fertile
      soil toward light, the feedback gain now sorting with the biome the way
      `warmthPref` / `forage` already do. The scale is clamped non-negative (an
      extreme-benign spot zeroes the shelter benefit rather than inverting it into a
      penalty), and pinned to equal the base facilitation at a `harshnessRef`, so the
      harshness-omitted `canopyGermination(c)` call reproduces the old curve *exactly*
      — the world is unchanged where conditions sit at the reference, and the
      established global-selection behaviour (and every one-arg call in
      `test/canopy.test.mjs`) is preserved. Harshness is a pure function of the static
      terrain: it draws **no rng** and adds **no serialized state**, so a restored
      world replays bit-for-bit (no `SAVE_VERSION` bump) — the persistence and canopy
      round-trip tests pass untouched. `test/canopy-niche.test.mjs` covers the optimum
      rising monotonically with harshness (and staying interior at every level), the
      non-negative clamp at the benign extreme, the default-equals-reference identity,
      terrain driving harshness without touching the rng stream, and the end-to-end
      ordering (canopy selected heavier on a real barren tile than a fertile one).
      *Caveat / deeper cut:* this makes the spatial selection *target* diverge
      cleanly, but the realised standing larder only sorts weakly — at this
      population scale, dispersal (canopy inheritance copies the nearest same-kind
      parent within `inheritRadius`, mixing barren and fertile lineages) and drift
      swamp the gentle gradient. Genuinely *realising* the spatial sort — a
      kin-structured canopy as a public good sustained only among lineage neighbours,
      and/or tighter canopy dispersal — is the follow-up below.

- [x] **A spatial canopy-sort readout, and the finding that the simple realisation
      levers don't move it.** The condition-dependent optimum (above) makes the canopy
      a sprout is *selected toward* diverge across the biome (heavier on barren ground,
      lighter on fertile), but nothing yet read back whether the *standing* larder
      actually tracks that target. `World.stats()` now splits the live larder's mean
      `canopyAmp` by local seedling **harshness** — the very gradient the germination
      curve selects along (`canopyHarshnessAt`, terrain barrenness) — bucketed at
      `harshnessRef` into **harsh** (barren) vs. **benign** (fertile/grass) ground, and
      reports both means plus their signed difference `canopySort` (positive when
      barren stands out-invest fertile ones, the direction the target points). Each
      mean is null with an empty bucket and the sort null unless both are populated
      (the HUD shows "—" rather than a misleading 0). It folds into the existing single
      pass over the food in `stats()`, draws **no rng**, and adds **no serialized
      state** (pure observation, no `SAVE_VERSION` bump) — every replay/save test passes
      untouched. The HUD gains a **Canopy sort** row (`harsh/benign (±gap)`) beside the
      existing **Canopy** mean. With the instrument in hand, a sweep settled the
      realisation question for the cheap levers: across `inheritRadius` ∈ {25…90} ×
      `harshnessGain` ∈ {2.4…8} (× a pioneer-fallback that copies the nearest *any*-kind
      parent instead of resetting to neutral), the realised `canopySort` never left the
      noise band (mean over seeds ≈ −0.01…+0.03, individual seeds straddling 0) and a
      clean 6-minute default run reads −0.03…+0.02. The root cause the readout exposes:
      on **harsh** ground the germination curve is nearly *flat in canopy* (the scaled-up
      shelter term saturates, so germination at canopy 0.8 is only ~0.94× that at 0.2 —
      almost no selection differential to realise), while the only real pull — fertile
      ground favouring cheap light seeding (~0.72×) — is a minority of tiles and gets
      swamped by the grass bulk and drift. So tightening dispersal or steepening the
      harshness gain doesn't help: there is little local selection *to* concentrate.
      Realising the sort needs a structural change that puts a real, canopy-steep
      fitness differential on harsh ground (a non-saturating harsh-side shelter term, or
      the kin-structured public-good variant), not just a tuning pass — which is what the
      sharpened follow-up below now calls for. `test/canopy-sort.test.mjs` covers the
      bucketing at the reference, the two means and the signed sort against a hand
      computation, the neutral fallback for a gene-less pellet, the null edges (no food,
      a one-sided larder), and that the readout draws no rng.

- [x] **The spatial canopy sort is realised — the standing larder now actually
      diverges, not just the selection target.** The condition-dependent optimum (above)
      made the canopy a sprout is *selected toward* climb on barren soil and fall on
      fertile, but the `canopySort` readout confirmed the *realised* standing larder
      sat in the noise (≈0, sign random across seeds): the only channel acting on the
      gene was *differential seeding* (germination shaping which random spot gets a
      sprout), and it turned out far too weak — swamped by the ±0.05/gen mutation and
      the fine terrain mosaic, the larder just parked at the mutation-centred 0.5. Two
      reasons the seeding channel is weak surfaced along the way and reorder the levers
      the prior seed laid out: the spawn probability is `terrain.fertility · germination`
      fed through `rng.chance`, which **clamps at 1**, so on the fertile/grass majority
      of the map (fertility 0.85–1.0) germination saturated the cap across most of the
      canopy range — *no* differential at all there; and the 6-attempt spawn retry
      further blunts what's left. So this took **two changes**, only the second of which
      moved the needle:
      • Lever (a), **a canopy-steep harsh-side differential** (`harshShelterLinear` in
        `src/vegetation.js`): a *non-saturating* (linear-in-canopy) shelter bonus added
        to `canopyGermination`, switched on only above the reference harshness, so on
        barren soil high canopy keeps gaining shelter past where the saturating `tanh`
        flattens. It lifts the barren optimum (~0.41 → ~0.51) and keeps the harsh curve
        *steep* rather than a tall plateau — the differential the prior seed named as
        the precondition. It vanishes at `harshnessRef`, so the harshness-omitted
        `canopyGermination(c)` call reproduces the old curve byte-for-byte and the
        established global selection (and every one-arg `canopy.test.mjs` assertion) is
        preserved. (The companion option the seed offered — a *benign-side* fecundity
        tilt to un-clamp the fertile end of the spawn channel — was implemented and
        swept, and **rejected**: it did steepen benign selection, but by suppressing
        food on the food-rich majority of the map it starved populations into extinction
        (4/16 seeds) for a marginal sort gain. The finding: you cannot realise this sort
        through the spawn channel without taxing the larder the whole world lives on.)
      • The lever that actually realises it: **direct viability selection on the
        standing larder** (`canopyViability` + a withering pass in `World.update`).
        Each step a plant has a `witherRate · (1 − viability)` chance of being culled,
        where viability is its germination at its location normalised by the best
        achievable there (`canopyViability` = `canopyGermination(c, h) / max_c`), so it
        is 1 exactly at the local optimum and falls as `canopyAmp` mismatches the
        ground. Culling the mismatched pulls the *standing* distribution straight onto
        the local optimum — heavy on barren, light on fertile — instead of nudging it
        through the noisy seeding rate, which is the whole reason it works where the
        seeding channel didn't. Two guards keep it from harming the world: it
        **self-limits on larder fullness** (the rate tapers to 0 below
        `witherFoodSoftCap`, so what it removes ∝ rate·food falls *quadratically* as
        food drops and vanishes well before the larder is bare — culling can never drive
        a starvation spiral), and the **wither roll draws the main rng** so a restored
        world replays bit-for-bit (the dead are swept by the existing end-of-step
        compaction; no serialized state, no `SAVE_VERSION` bump — at `witherRate` 0 the
        pass is skipped and the world is exactly as before).
      Lever (b), **tighter canopy dispersal**, rode along: `inheritRadius` shrank
      90 → 40 and `parentCanopyAt` now falls back to the nearest *any*-kind parent (then
      neutral only if nothing is in reach) rather than resetting to neutral — canopy is
      adapted to the kind-independent terrain harshness, so copying a near off-kind
      neighbour keeps a patch's adaptation across a kind boundary where a hard neutral
      reset would wash a tight reach back to the mean (the prior seed's explicit
      warning). The headline result, a clean 16-seed × 12-minute sweep: with withering
      **off** the realised `canopySort` is noise (mean 0.001, sign random, 7/13
      survivors positive); with it **on** the sort is positive on **all 16/16 seeds**
      (mean 0.045, range +0.004…+0.127), with **zero extinctions** (vs 3–5/16 for the
      base world — withering doesn't worsen, and the food gate may even help), a healthy
      boom/bust band (pop to ~210) and active predation (~620 kills) intact. So a walk
      across the map now shows visibly heavier canopy on barren ground, the feedback
      gain sorting with the biome the way `warmthPref` / `forage` already do. The
      `Canopy sort` HUD row reads it live; the renderer needs no change (its amber/blue
      climate wash already breathes with the now-divergent feedback strength). Tests:
      `canopy.test.mjs` gains the `canopyViability` curve (1 at each local optimum,
      bounded in (0, 1], higher for heavy canopy on harsh ground and light on benign);
      `canopy-sort.test.mjs` gains the withering wiring (a mismatched cohort is culled
      far harder than a matched one, and `witherRate` 0 leaves both intact); the
      `canopy-niche.test.mjs` monotonicity/interior-optimum and `canopy.test.mjs` global
      recovery and save-replay assertions all still hold. (One unrelated test needed a
      robustness fix: `scent.test.mjs` broke its kill loop on the *first* danger plume,
      assuming it came from the kill — but the rng-stream shift from the wither rolls let
      a voluntary "cry-wolf" alarm plume fire a step earlier; it now runs the full window
      and tracks whether a danger plume ever appeared, which still proves the kill's
      blood plume.)
      *Caveat / deeper cut still open:* the realised sort (~0.045) is real and robust but
      modest — the barren bucket holds near its ~0.51 optimum while the benign bucket
      settles around the grass optimum (~0.33), so the *gap* is intrinsically limited by
      how close those optima sit (pushing them apart via the benign spawn channel
      starves the world, as found above). Widening it further is lever (c) below.

- [x] **UI/UX: collapsible stat groups** (follow-up (b) to the inspector/camera),
      so the left HUD's ~35 stat rows fold into labelled, collapsible sections
      instead of presenting one flat scrollable wall. The flat list (plus its two
      faint `—————` dividers) is now four `<details>` groups — **Population**
      (census: pop/peak/species/eco-species/isolation/carnivores/top-gen/avg-energy/
      kills), **World & climate** (larder + the day-night/season/weather/wind
      rhythms), **Traits & niche** (the trait averages plus the climate/biome/canopy
      sort readouts), and **Social** (the voice/trust/kinship/mating signalling
      traits) — each with a custom mono-theme disclosure triangle, mirroring how the
      inspector groups the genome into Body & senses / Diet & niche / Social. The
      two trait-heavy groups default **collapsed** so the panel opens as a compact
      census-plus-climate summary, halving the visible rows; a viewer expands what
      they're watching. The non-obvious bit was preserving that open/closed state:
      `updateHud` repaints ~6×/sec, and the old code rebuilt `statsEl.innerHTML`
      wholesale each time — which would reset every `<details>` back to its default
      the instant after a viewer collapsed it (a collapse lasting a sixth of a
      second). So the HUD is now declared once as data (`HUD_GROUPS`: groups of
      `[label, read]` rows, `read` taking the live `world.stats()` snapshot),
      `buildHud()` constructs the skeleton DOM a single time at boot and collects
      each value span into `hudCells`, and `updateHud()` only rewrites those spans'
      text — so the browser keeps the open/closed state a viewer sets, and the panel
      no longer reflows wholesale every tick (a small perf win too). Purely a *view*
      restructure: no rng, no serialized state, no simulation touch (no
      `SAVE_VERSION` bump), so the headless suite is untouched and still green; the
      build/update algorithm (groups built with the right default-open states, value
      refreshes leaving a user-collapsed group collapsed) was checked with a minimal
      DOM shim, since — like the renderer and main entry point — the live `<details>`
      DOM needs a browser. CSS hides the default disclosure marker for a triangle
      that rotates on open and matches the inspector's uppercase-accent section heads.
- [x] **UI/UX: follow-selected camera mode** (follow-up (e) to the inspector/camera),
      so the inspected creature can be *kept centred as it moves* rather than wandering
      out of a zoomed-in view a frame later. A **⌖ Follow** toggle sits in the inspector
      head (between the title and the close ×); switching it on pins the camera to the
      selected creature, re-centring on it every frame in the main loop. Because the
      whole world fits at zoom 1 (where centring on one creature is a no-op), enabling
      Follow from the fully zoomed-out view first pushes in to a comfortable
      `followZoom` (5×) so the tracked creature is big enough to watch; if the viewer
      has already zoomed, their zoom is left alone. The new primitive is a pure
      `Camera.centerOn(wx, wy, …)` that sets the world-space centre and re-uses the
      existing `view()` clamping — so following a creature toward a world edge slides
      the centre only as far as the edge allows, and following at zoom 1 stays pinned to
      the world centre, exactly the established panning rules (zoom is untouched). A
      followed creature crossing the toroidal seam jumps the centre once, the only
      discontinuity and a rare one at the creatures' slow pace. Control hand-off is
      deliberate: a manual **pan** (drag / pinch / arrow keys) releases Follow via a new
      `onUserPan` hook on the `CameraController`, so panning always wins rather than
      fighting the re-centring — but **zooming** while following keeps tracking, just
      closer or further out. Follow is reset on every selection change (a fresh pick
      never silently carries the previous creature's follow) and released the instant
      the followed creature dies (the per-frame selection-resolve returns null →
      `setFollow(false)`, which also hides the inspector). Purely a *view* feature: no
      rng, no serialized state, no simulation touch (no `SAVE_VERSION` bump), so the
      headless suite stays green; `test/camera.test.mjs` gains coverage for `centerOn`
      (interior point lands at the viewport centre, off-world points clamp to the edge,
      zoom-1 stays pinned, zoom is preserved). The DOM wiring (the toggle, the per-frame
      centring, the pan hand-off) needs a browser, so it was checked there: enabling
      Follow visibly zoomed to and centred the inspected creature, and its death
      released the camera and closed the inspector.

- [x] **In-app legend for the canvas colours and washes.** Everything painted on
      the world encodes something — but until now none of it was documented on
      screen, so a newcomer had to read the source to learn that violet plants are
      the night-leaning kind or that the amber wash means a warmer microclimate. A
      folding **Legend** panel (`#legend`, a `<details>` chip anchored bottom-centre,
      collapsed by default so it stays a single tag until opened) now names each
      colour: the *creatures* key (trophic green→red diet gradient, or — when the
      colour toggle is on Lineage — the clade hue wheel), the two *plant* kinds
      (sun/moon leaf), the *terrain* tiles (water/fertile/barren over the grass
      base), the amber↔blue *climate wash*, the green/red *scent* plumes, and the
      *sky* washes (night veil, rain, drought). The swatch colours are not
      re-typed: a new `src/palette.js` holds every canvas colour as the single
      source of truth, imported by both the renderer (which dropped its private
      `TILE_COLORS` / `FOOD_COLORS` copies) and the legend, so a hue change updates
      both together and they can never drift. The legend is built from a pure
      `legendModel(colorMode)` data function (`src/legend.js`) that
      `renderLegend` turns into DOM; `main.js` renders it on boot and rebuilds it
      whenever the colour toggle flips, so the creatures key always matches the
      bodies on the canvas. Purely presentational — no rng, no serialized state, no
      simulation touch — so the headless suite stays green; `test/legend.test.mjs`
      covers the pure model (every section/item well-formed, the creatures section
      mode-dependent while the rest is shared, swatches sourced from the palette).
      Placement was checked in the browser at desktop and small sizes: the first
      bottom-left attempt overlapped the (tall, full-height) HUD column and
      swallowed its control clicks, so it moved to bottom-centre — clear of the HUD
      on the left and the inspector / camera controls on the right — where opening
      it, reading every swatch, and flipping trophic↔lineage all verified clean.

- [x] **UI/UX: click-through inspector links** (follow-up (c) to the
      inspector/camera). The inspector could only ever be pointed at a creature by
      *clicking it on the canvas* — there was no way to hop from the inspected
      individual to a *related* one, even though the world is full of relationships
      (kin, predator→prey) the rest of the simulation already computes. A **Links**
      section now sits at the foot of the panel with two navigation buttons that
      jump the selection to a creature reached *through* the inspected one: **Nearest
      kin** → `World.nearestKin(self)`, the spatially-nearest live creature within
      `scent.kinTolerance` on the lineage-hue wheel (`hueSimilarity > 0` — the exact
      kin/stranger threshold the scent, mate-choice, and species-count layers use),
      searching the whole world (not a sense window) so it finds a relative wherever
      one is; and **Target** → the creature the inspected one is currently steering
      toward, when that's another creature (its prey). For the latter, `Creature.update`
      now records the chosen target's id on `this.targetId` whenever the picked target
      *is* a creature (`target === prey`), and null when it's heading for food or
      wandering — food isn't an inspectable creature, so a grazer's link stays inert.
      `targetId` is a *transient view annotation*: it's refreshed every step, never
      serialized, and draws no rng, so it changes nothing about the simulation or its
      save format (no `SAVE_VERSION` bump; every replay/save test passes untouched).
      A link with nothing to resolve to (no kin alive, or not hunting a creature this
      step) is shown disabled with a "—" rather than hidden, so the panel's shape is
      stable. Clicking a live link **selects-and-follows in one hop**: if the camera
      was following the previous selection it keeps following the new one
      (`selectKeepingFollow` re-engages follow after the re-select), so you can walk a
      lineage or a hunt across a zoomed-in world without losing the chase; otherwise
      it's a plain re-select. The non-obvious bit was the buttons' *lifetime*:
      `updateInspector` rewrites `#inspector-body`'s innerHTML every frame (~per rAF),
      which would replace any button mid-click and drop the event — so the links live
      in a *separate, persistent* `#inspector-links` container, built once with stable
      `<button>` elements whose live target id, label, and disabled state
      `updateLinks` refreshes each frame, so a click always lands on a real element.
      Purely a *view* feature beyond the one transient annotation — no serialized
      state, no simulation logic touched — so the headless suite stays green;
      `test/inspector-links.test.mjs` covers the two pure resolutions: `nearestKin`
      (nearest kin beating a nearer stranger, the dead/self exclusions, the exact
      in/out-of-tolerance boundary, null with no kin) and the `targetId` recording (a
      hunting carnivore records its prey, the target clears to null when the prey is
      gone, and a grazer steering toward food records null). The DOM panel and the
      select-and-follow wiring need a browser, so — like the renderer, tools, and main
      entry — they were checked there: selecting a creature showed the **Links**
      section with a live **Nearest kin → #id** and a disabled **Target → —**;
      clicking the kin link jumped the inspector to that relative (and its own nearest
      kin pointed back, a mutual nearest pair); and watching the running world caught a
      carnivore with a live **Target → #id** link to the prey it was chasing.

- [x] **Kin-structured canopy: a neutral plant lineage marker and kin-sharpened
      withering that widens the realised spatial canopy sort.** The spatial sort was
      *realised* by viability withering (above) but sat at a modest, gap-capped +0.045;
      the seed asked to widen it by making canopy shelter a *public good shared only
      among lineage neighbours*. The lasting addition is a **neutral plant `lineage`
      tag** (`src/world.js`): an integer a *pioneer* sprout (one with no plant in
      canopy-inheritance reach) founds from a monotonic `nextPlantLineage` counter, and
      every other sprout inherits from its canopy parent verbatim — the plant-world
      echo of a creature's `lineageHue`. It's drawn from a **counter, not the rng**, so
      it perturbs the deterministic stream not at all (every prior replay test passes
      untouched); it rides the food tuple as a 5th slot and the counter serializes, so a
      restored world's pioneers don't collide with saved lineages (`SAVE_VERSION` → 13;
      food now `[x, y, kind, canopyAmp, lineage]`, a pre-v13 pellet lacking the tag is
      rejected). On top of it, the lever that actually moved the sort: **kin-structured
      withering**. `World.kinDensityAt(x, y, lineage)` reads how densely a plant's
      *same-lineage* neighbours cluster around it (count within `kinDensityRadius`,
      saturated against `kinDensityNorm`, in [0, 1]); the withering pass then amplifies
      the cull chance of a canopy *mismatched to its ground* by `1 + kinWitherSharpen ·
      kinGate`, so where a lineage clusters densely a barren kin stand purifies onto its
      (heavy) local optimum and a benign one onto its (light) optimum — widening the
      realised harsh-vs-benign gap. A well-matched plant has viability 1, so `1 − v` = 0
      and it never withers however dense its kin: the amplification only ever bites the
      genuinely mis-invested, and a lone stranger (gate 0) sees the plain pass. The gate
      reads the step-boundary `canopyGrid` and adds no fresh rng path, so a restored
      world still replays bit-for-bit; the germination curve (`canopyGermination` /
      `canopyViability`) is **left untouched**, so every prior canopy curve/recovery/
      sort assertion holds and at `kinWitherSharpen` 0 the world is identical to before.
      *Getting here meant rejecting the seed's own literal recipe — twice — and the two
      failures are the real lesson:* (a) a **pooled received-shelter public good** (a
      plant sheltered by the mean canopy of its kin) *erodes the own-canopy commons* — a
      cheat free-rides on its neighbours, so investment, and the sort, collapse; a paired
      12-seed × 15-min sweep found it *narrowed* the sort (0.046 → 0.036) and tipped a
      seed extinct. (b) A **kin-gated harsh-side shelter *bonus*** (heavy canopy worth
      more on barren ground where kin cluster) *adds survival on barren ground*, which
      blooms it into a food magnet, raises kin density everywhere, saturates the gate,
      and collapses the very discrimination it meant to sharpen — sort 0.043 → 0.016 with
      2 extinctions. The unifying diagnosis: **any lever that *adds* survival on barren
      ground triggers a productivity-bloom feedback**, so the working lever must instead
      *remove* the mismatched (competition-neutral — total food only falls, never blooms)
      and act on each plant's *own* viability (no commons to erode). Kin-sharpened
      withering is exactly that. The payoff, across **24 seeds × 15 min** (two independent
      12-seed sets): it lifts the *mean* realised `canopySort` modestly but consistently
      — in-sample 0.043 → 0.054, out-of-sample 0.032 → 0.040 (~+25%), all 24 seeds
      positive — and, a welcome surprise, **eliminated extinctions (0/24 vs the base
      world's 2/24)**: the kin-purified larder stays better-adapted and less crash-prone,
      with the same healthy boom/bust band (peaks to ~370, active predation ~200–1500
      kills) intact. The honest caveat: *per-seed* the sort is still dominated by terrain
      layout and dynamics noise (a mean shift, not a uniform per-seed win), so the
      realised widening stays modest — confirming the prior seed's read that the sort is
      gene-flow/dispersal-limited; the sharpened follow-up above (explicit metapopulation
      structure) is what a larger per-seed gap would need. The renderer needs no change
      (its amber/blue climate wash already breathes with the canopy feedback).
      `test/canopy-kin.test.mjs` covers the curve staying the established two-arg one (a
      stray third arg ignored), `kinDensityAt` (tagless/null → 0, the saturating
      same-lineage count, strangers excluded, the radius cutoff, no rng), lineage
      inheritance through `spawnFood` (a sprout inherits its parent's tag, a pioneer
      founds the next, the counter advancing only on pioneer births), the withering
      wiring (a mismatched kin stand culled harder than lone strangers of the same
      canopy, a well-matched stand spared however dense its kin, the off-at-`sharpen` 0
      identity), and the v13 save round-trip (tag + counter preserved, bit-identical
      replay); the existing `canopy*.test.mjs` curve/recovery/sort assertions and the
      five version-assert tests (bumped 12 → 13) all still hold.

- [x] **UI/UX: smooth zoom easing** (follow-up (e) to the inspector/camera — the
      last of the camera polish). Wheel notches and the on-screen / keyboard +/−
      buttons used to *snap* the zoom to its new level in a single frame, which
      reads as a jerk on a fast scroll and makes it hard to land on a comfortable
      magnification; now the zoom **eases** toward its target over a few frames, so
      a scroll glides in and out and repeated notches compound into one smooth
      motion. The whole thing is a clean extension of the existing focus-zoom: the
      `Camera` already knew how to set an absolute zoom while pinning the world
      point under a screen pixel (the "zoom toward the cursor" maths), so that body
      was lifted into a private `_zoomToward(targetZoom, sx, sy, …)` and now backs
      both paths. The camera holds a `zoomTarget` (the level it's easing toward) and
      a recorded focus pixel; `requestZoom(factor, sx, sy)` *only* moves the target
      and stores the focus (so N wheel events in a frame accumulate into one target
      rather than fighting), and a per-frame `tickZoom(dt, …)` — driven from the
      main loop with the real elapsed seconds, so it's frame-rate independent —
      walks the live `zoom` toward the target by a `1 − e^(−rate·dt)` blend applied
      **geometrically (in log-zoom)**, so the perceived rate is even across the
      whole 1–12× range instead of crawling near the floor and racing near the cap.
      The focus pixel is re-pinned every eased frame, so the world point under the
      cursor stays put for the *entire* glide, not just the endpoints. Three details
      keep it robust: within `zoomSnap` of the target the zoom **lands exactly** and
      the animation stops touching the centre (so a settled idle tick is a true
      no-op — and, crucially, leaves the per-frame `centerOn` from *follow mode* the
      last word on the centre, the reason `tickZoom` is sequenced *before* the
      follow re-centre in the loop); the immediate `zoomAt` used for **pinch**
      (kept snappy 1:1 for direct manipulation) now snaps `zoomTarget` to its result
      in lock-step, so a later tick never drags a pinch-set zoom back toward a stale
      target; and `reset` returns the target to 1 with the zoom. `ensureFollowZoom`
      and the wheel/button/key handlers all route through `requestZoom`, so every
      zoom entry point eases except the deliberately-immediate pinch. Purely a
      *view* feature — no rng, no serialized state, no simulation touch (no
      `SAVE_VERSION` bump), so the headless suite stays green. `test/camera.test.mjs`
      gains coverage of the new core: a request moving only the target (and notches
      compounding into it), `tickZoom` easing the live zoom monotonically upward
      without overshoot and landing *exactly* on the target (then idling as a no-op
      that doesn't disturb the centre), the focus world-point staying pinned across
      the whole glide, an eased request clamping at the zoom ceiling with no
      overshoot, an immediate `zoomAt` keeping the target in lock-step (so a
      following tick holds rather than drifts), and `reset` clearing the target. The
      DOM input wiring (wheel/pointer/keyboard/buttons) needs a browser, so — like
      the rest of the camera input — it was checked there: a single wheel notch on a
      paused world changed the rendered view across 22 of 30 frames (a snap would
      change one frame then hold) and settled cleanly, confirming the glide
      integrates end-to-end with no console errors.

- [x] Creature trail — the inspected individual's recent path traced behind it,
      so its foraging/fleeing behaviour reads *over time* and not only from the
      instantaneous heading arrow. A small view-only module (`src/trail.js`,
      `Trail`) keeps a bounded ring of recent positions: `main.js` feeds it the
      live selection's position each rendered frame (skipped while paused, so a
      paused world doesn't pile coincident points), and `select` clears it on
      every selection change so a new creature never inherits the old track. A
      point is only laid once the creature has travelled at least
      `CONFIG.trail.minDist` (4 units) from the last kept one — measured on the
      torus via the shared `wrapDelta`, so a step across the seam counts as the
      short hop it is — and the ring holds `CONFIG.trail.maxPoints` (160), so the
      trail spans the last ~640 units of *ground covered* regardless of playback
      speed or frame rate (a fast flick and a slow crawl read the same length).
      The renderer draws it under the bodies as a fading comet tail: a pure
      `trailSegments(points, w, h)` splits the wrapped path into polylines,
      breaking wherever two consecutive points jump more than half the world on
      either axis (a toroidal seam crossing) so a wrap doesn't streak a false
      line straight across the view, and each sub-segment is stroked with an
      alpha rising from the faint tail to the bright head. Purely a *view*
      feature — no rng, no simulation touch, nothing serialized (no
      `SAVE_VERSION` bump), so the headless suite stays green. `test/trail.test.mjs`
      covers the ring (first point always kept, sub-`minDist` steps gated against
      the last *kept* point, the `maxPoints` cap evicting oldest-first, the
      toroidal-`minDist` seam-short gate, `clear`) and `trailSegments` (a
      contiguous path as one polyline, a horizontal and a vertical seam split,
      lone single-point runs dropped, and the empty/one-point no-op). Verified in
      the browser: following a selected creature traces a clean fading path that
      reads its graze loops and wrap-arounds, no console errors.

## Next up

- [ ] **UI/UX, continued.** Eight passes have now landed — a *creature inspector*,
      a *pan/zoom camera*, *collapsible stat groups*, a *follow-selected camera
      mode*, an *in-app legend*, *click-through inspector links*, *smooth zoom
      easing*, and now a *creature trail* (all below). The camera follow-ups (b)
      through (e) are done; the camera feel is rounded out, and the trail now
      traces the inspected individual's path over time. Open directions for the
      next UI pass, if picked: a *minimap* / world-overview thumbnail (the
      zoomed-in view loses the global picture — a corner minimap showing the whole
      world with the current viewport rectangle would let you navigate a large
      world without zooming out — and it would pair naturally with the new trail,
      plotting the selected creature's track on the overview too), or a
      *time-series scrubber* / pause-and-step controls (single-step the fixed
      timestep to study a moment frame by frame).
- [ ] **Widen the realised canopy sort further — explicit metapopulation structure.**
      The kin-structured pass below lifted the *mean* realised sort modestly (~+25%)
      and stabilised the world, but per-seed the sort is still swamped by terrain
      layout and boom/bust dynamics — a mean shift, not a clean per-seed win. Three
      kin-shelter shapes were tried and the two "add survival on barren ground" ones
      both backfired (see the Done entry); the working lever was *competition-neutral*
      (sharpen withering, never bloom). The honest read is that the realised sort is
      capped by **gene flow between patches** more than by the selection target. A
      genuinely larger per-seed widening probably needs explicit metapopulation
      structure — episodic local extinctions/recolonisations (a patch wiped by a
      grazing front reseeded from one disperser), or a dispersal-distance gene that
      lets barren lineages stay put — so a barren kin stand can fix heavy canopy
      against immigration rather than being continually diluted. That's a structural
      change, not a tuning pass, matching the prior finding. Or pick a seed below.

## Ideas / someday

- Simple neural-net brains instead of hand-tuned genome weights.
- Courtship as an explicit mate-search radius gene that trades reach against
  metabolism, and/or mutual choice (the *chosen* partner also gets a veto, so a
  pairing needs both to agree) — deeper variations on the courtship cost now that
  it scales with distance.
