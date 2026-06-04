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

## Next up

- [ ] Wind should have a *direction*, not just a strength — a slowly turning
      prevailing wind that nudges every heading the same way (and could carry
      drifting food/spores downwind), so storms herd the population rather than
      only scattering it, and the buffet gains a coherent push under the gusts.

## Ideas / someday

- Simple neural-net brains instead of hand-tuned genome weights.
- Sexual reproduction with genome crossover.
