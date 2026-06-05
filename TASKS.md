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

## Next up

- [ ] Now that climate selects on the animals directly, give it a *spatial* axis
      too: a per-region microclimate (warmer/cooler, wetter/drier offsets baked
      into the terrain map, or a smooth noise field over the world) layered on top
      of the global season/weather, so `warmthPref`/`wetnessPref` also partition
      creatures *across space* — a warm-adapted clade settling the sun-baked south
      while a cold-adapted one holds the damp north — instead of only tracking the
      global clock in time. Pairs with terrain (water already bogs movement) and
      with the plant-kind spatial patchwork, turning the map into a true mosaic of
      niches. Or pick a seed below.

## Ideas / someday

- Simple neural-net brains instead of hand-tuned genome weights.
- Courtship as an explicit mate-search radius gene that trades reach against
  metabolism, and/or mutual choice (the *chosen* partner also gets a veto, so a
  pairing needs both to agree) — deeper variations on the courtship cost now that
  it scales with distance.
