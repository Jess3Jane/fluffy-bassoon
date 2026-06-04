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

## Next up

- [ ] Lineage / species colouring driven by genome so clades are visible.
- [ ] Charts: population and trait history over time.
- [ ] Save / load world state to localStorage.
- [ ] Interactive tools: click to add food, drag to spawn creatures.

## Ideas / someday

- Day-night cycle affecting food growth.
- Terrain (water, fertile, barren) influencing movement and food.
- Simple neural-net brains instead of hand-tuned genome weights.
- Sexual reproduction with genome crossover.
