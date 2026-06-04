# Fluffy Bassoon

An evolving creature ecosystem that runs entirely in your browser — a complex
simulated world where emergent complexity is the whole point.

Hundreds of creatures roam a toroidal world looking for food. Each carries a
small **genome** (speed, sense range, size, metabolism, wanderlust, and
**diet**). Eating gives energy; moving and living spend it. When a creature has
enough energy it splits in two, passing on a mutated copy of its genome. There
is no fitness function — survival *is* the fitness function, so the population
evolves on its own. Watch traits drift, populations boom and crash, and lineages
deepen.

The `diet` gene spans herbivore (green) to carnivore (red): herbivores graze
plants, while carnivores hunt creatures they can out-size, gaining meat instead.
Specialising at either end is more efficient than sitting in the middle, so a
**second trophic level** emerges on its own — and the carnivore share rises and
falls with the supply of prey.

## Run it

It's a static site with no build step. Either open `index.html` through a local
web server (ES modules need `http://`, not `file://`):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or just use the deployed GitHub Pages site.

## Controls

- **Click** the world to drop a cluster of food.
- **Pause / Resume**, **Reset**, and a **Speed** slider (1×–8×) in the HUD.
- The HUD shows live population, carnivore count, food, kills, top generation,
  and average traits (including diet).

## Develop

```sh
npm test   # runs a headless simulation and checks ecosystem invariants
```

Source lives in `src/` (pure simulation core + a canvas renderer). Tuning knobs
are in `src/config.js`. The roadmap is in `TASKS.md`.

## Stack

Vanilla JavaScript, ES modules, and a 2D canvas. No dependencies, no build —
deployed to GitHub Pages via the workflow in `.github/workflows/deploy.yml`.
