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

A **day-night cycle** rides over all of it: daylight rises and falls on a fixed
rhythm, and food regrows fast in the light but slowly in the dark. The larder —
and the population that lives off it — breathes with the cycle, and the world
visibly dims at night.

Two slower rhythms ride over the day-night cycle. **Seasons** swing across a
long "year" — rich summers, lean winters, with autumn cooling and spring warming
between — while **weather** flickers faster on top, rain spells boosting food and
droughts thinning it. Both are pure functions of the clock (so they survive a
save/load intact), and together they scale food growth on a longer timescale, so
the population rides broad boom-and-bust waves as well as the daily breathing. The
scene washes cool-blue in rain and dry-warm in drought.

Weather reaches past the larder into how creatures move. Rain dims sight (food
grown in a downpour is harder to find), and storms raise a **wind** — not just a
strength but a *direction*, a prevailing bearing that turns slowly around the
compass. When a gale blows it pushes every heading the same way (a coherent shove
that herds the whole population downwind, on top of the random gust jitter) and
drifts loose food along the same bearing, so a storm rakes the larder across the
world rather than only scattering it. Faint streaks rake the scene to show which
way it's blowing. Drought is the calm, clear opposite — you see far and steer
true, but go hungry.

The world is laid over a **terrain** map of grassland dotted with patches of
water, fertile soil, and barren ground. Food springs up thickest on fertile
soil, sparsely on barren ground, and never on water; creatures wade slowly
through water, so it becomes a natural barrier and refuge that shapes where life
concentrates. The map is grown from a single seed (saved with the world, so it
returns intact on load) using wrapping noise, so every world looks different.

The wind also carries **scent**. Creatures lay faint pheromone plumes as they
live — a "food here" plume while grazing, and a strong "danger" plume of blood
where one is killed — and others smell the field on the air, drawn toward or
away by diet (grazers chase food scent and flee blood; predators home in on the
blood). The same gale that herds bodies smears these plumes into downwind trails,
so flocking and avoidance emerge from a field the wind was already moving. And
the signalling is **heritable**: genes set how loudly each creature emits each
plume (a "voice") and how strongly it heeds each (a "trust"), with every emission
costing energy. A creature can even *cry wolf* — lay a voluntary danger plume
indistinguishable from real blood. So the field is an evolutionary arena: silence
is free, honesty is a gamble, eavesdropping is cheap, and a deceiver that shouts
"danger" with a deaf ear can scatter rivals off contested food. Watch the
signalling traits in the HUD drift as selection sorts it out.

Cooperation has something to select for, too, through **kin recognition**. Every
plume now carries the lineage hue of whoever laid it, and a heritable `kinship`
trait sets how much a creature weights the field by *who* is calling: a kin-blind
creature answers every plume by its diet alone (the old behaviour), while a
kin-keen one answers mostly its own relatives — those whose inherited colour sits
close to its own — and tunes out strangers. That tilts the maths behind honest
*food* signalling: broadcasting your larder to every passing competitor is pure
altruism that erodes to silence, but a call that mostly draws close kin (who
carry the same calling gene) can pay off through inclusive fitness. So the
signalling arena becomes a tension between kin-directed honesty and
stranger-directed deception, with `kinship` in the HUD tracking where it lands.

The `kinship` trait now works both ways. Besides choosing *whom to heed*, a
creature also chooses *when to bother calling*: it reads how many close kin are
within earshot (a quick hue-weighted headcount off the creature grid) and gates
its food call by it, through the same gene and the same maths as the response
side. A kin-blind creature still calls at full voice no matter who's around; a
kin-keen one falls silent among strangers — where advertising only feeds rivals —
and calls up to full voice when relatives cluster nearby to benefit. The hush is
free (too faint a call is never laid, so it costs no energy), so advertising is
paid for only when kin are there to repay it — which lets `foodVoice` and
`kinship` co-evolve instead of leaving all the work to the listener.

Clustering now pays off in **safety in numbers**, too. A predator that has a
victim in reach no longer makes a sure kill: the strike is *diluted* by the crowd
of other prey pressed around its target, so a grazer buried in a herd is harder
to single out than a lone one. The catch chance falls with the local prey density
(read off the creature grid, just like the kin headcount) down to a floor — never
to zero, so a herd is a refuge, not a fortress, and predators must work to cut an
animal out of one rather than starving against an uncatchable flock. That gives
flocking an emergent anti-predator value on top of the scent payoff, a second
reason for the population to bunch up.

Reproduction itself now evolves, through **sexual reproduction with crossover**.
A heritable `mating` trait sets how readily a creature breeds with a partner
instead of cloning itself. When a creature ready to breed rolls to mate, it looks
for the nearest neighbour in reach; if one is there, the child's genome is a
uniform shuffle of both parents' genes (recombination, which can pull good traits
from separate lineages into one body far faster than mutation alone), with
mutation layered on top as before. With a low `mating` — or nobody nearby — it
falls back to cloning, so breeding never stalls for want of a mate; sex happens
only where the scent/kin/herding layers have already drawn creatures together.
Whether a lineage drifts toward mixing or faithful cloning is left to selection,
with `mating` tracked in the HUD.

Sexual reproduction in turn grows a **mate choice**. A breeder no longer just
takes the nearest partner: a heritable `mateChoice` trait, centred at neutral,
shapes *whom* it picks along the same lineage-hue axis kin recognition reads.
Above neutral the creature mates **assortatively** — preferring partners whose
hue is close to its own, a homogamy that can pull a clade toward reproductive
isolation and hands speciation a lever; below neutral it mates
**disassortatively** — preferring hue-distant partners, an outbreeding /
inbreeding-avoidance pull that keeps a lineage mixing with strangers. The
preference is paid against distance, so it only bends the choice among the
partners already in reach and only bites when there's a real hue spread to choose
across — with everyone a stranger (or everyone kin), or at a neutral gene, it
collapses back to nearest, the old behaviour. Where `mating` decides *whether* to
mix genes, `mateChoice` decides *with whom*, and the HUD tracks where the
population lands.

Choosing is no longer free, though: sexual reproduction now pays a **courtship
cost** scaled by how far the chosen partner is. A breeder taking the nearest body
pays almost nothing, but one that reaches past it for a better-hue-matched mate
pays for the extra ground it courts across, drawn from its energy before the
child's share is set aside. So `mateChoice` sits under a real cost gradient —
homogamy and outbreeding only pay off when the better genetic match outweighs the
energy spent reaching for it — rather than being a preference exercised for free.
The toll is kept well under the base cost of breeding, so it taxes choosiness
without making sex itself uneconomical, and the asexual / no-mate path pays
nothing.

Now that assortative mate choice can isolate clades and courtship cost gives that
isolation a price, a **speciation readout** makes the result legible instead of
leaving you to squint at the colour bands. The live population's lineage hues are
clustered by single-linkage along the colour wheel — a clade chains into one
cluster so long as no gap between neighbouring hues is wider than the same
tolerance kin recognition uses, while two clades parted by a real gap read as two
— and clusters too small to be more than a passing mutant are dropped. The result
is a **species** count in the HUD and a third history chart panel, so you can
watch one lineage split into two or three (and merge back) over time.

## Run it

It's a static site with no build step. Either open `index.html` through a local
web server (ES modules need `http://`, not `file://`):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or just use the deployed GitHub Pages site.

## Controls

- **Click or drag** the world to paint with the active brush, chosen by the
  **Tool** toggle: *Food* scatters clumps of plants along your stroke, *Creature*
  seeds fresh random-genome founders. Drag to lay a continuous trail (food paints
  densely, creatures are spaced out) and reshape the ecosystem by hand — drop a
  feast to trigger a boom, or seed a new founder population to watch it evolve.
- **Pause / Resume**, **Reset**, and a **Speed** slider (1×–8×) in the HUD.
- **Save / Load** snapshot the world to this browser's localStorage and restore
  it later. Because the random-number generator's state is saved too, a loaded
  world is an exact continuation — it picks up the same evolutionary trajectory
  rather than starting a fresh one.
- A **Colour** toggle switches creature colouring between *Trophic* (diet →
  green herbivore / red carnivore) and *Lineage*: each genome carries a neutral
  hue that descends with a slight drift, so clades show up as distinct colour
  bands and you can watch a lineage spread or wink out.
- The HUD shows live population, the **species** count (distinct lineage-hue
  clades large enough to count), carnivore count, food, kills, top generation,
  the current time of day (Day / Dusk / Night / Dawn with a daylight percentage),
  the season (Summer / Autumn / Winter / Spring), weather (Drought … Storm, with
  the combined climate food percentage), the wind (Calm, or a compass bearing and
  strength once a storm raises one), the live scent-plume count, and average
  traits — including diet, the four heritable signalling traits (food/alarm
  voice and trust), `kinship` (how strongly the creature filters scent by the
  caller's lineage), `mating` (how readily it breeds sexually vs. clones), and
  `mateChoice` (assortative vs. disassortative partner preference).
- Three **history charts** in the HUD trace the world over time: a population
  panel (total population with the carnivore sub-band), an average-trait panel
  (diet plus speed/size normalised onto a shared 0–1 axis), and a species panel
  (the lineage-hue clade count), so you can watch booms, crashes, trait drift,
  and clades splitting apart unfold. History is sampled on sim-time, so the
  window reads the same whatever the speed setting.

## Develop

```sh
npm test   # runs a headless simulation and checks ecosystem invariants
```

Source lives in `src/` (pure simulation core + a canvas renderer). Tuning knobs
are in `src/config.js`. The roadmap is in `TASKS.md`. Neighbour lookups go
through a uniform spatial grid (`src/grid.js`) so the simulation stays cheap as
populations grow into the thousands.

## Stack

Vanilla JavaScript, ES modules, and a 2D canvas. No dependencies, no build —
deployed to GitHub Pages via the workflow in `.github/workflows/deploy.yml`.
