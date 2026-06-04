// Unit test for mate choice: when a creature breeds sexually it no longer simply
// pairs with the nearest partner. A heritable `mateChoice` gene (centred at 0.5)
// shapes *whom* it picks along the lineage-hue axis kin recognition reads. Above
// 0.5 it mates assortatively (prefers hue-similar partners → speciation lever);
// below 0.5 disassortatively (prefers hue-distant partners → inbreeding
// avoidance); at 0.5 it has no preference and falls back to nearest, the old
// behaviour. The preference trades off against distance, so it only bends the
// choice among partners in reach and only bites when there's a real hue spread.
// Pure logic, no DOM.

import assert from "node:assert";
import { World } from "../src/world.js";
import { GENES, randomGenome } from "../src/genome.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const RADIUS = CONFIG.creature.mateRadius;
const TOL = CONFIG.scent.kinTolerance;

// --- The mateChoice gene exists, is random in [0, 1], and is a real gene (so the
//     generic mutation/clamp machinery covers it like any other). ---
{
  const g = randomGenome(makeRng(1));
  assert.ok("mateChoice" in GENES, "mateChoice is a real gene");
  const [min, max] = GENES.mateChoice;
  assert.ok(g.mateChoice >= min && g.mateChoice <= max, "mateChoice starts in range");
  assert.strictEqual(min, 0, "mateChoice spans [0, 1]");
  assert.strictEqual(max, 1, "mateChoice spans [0, 1]");
}

// A self at (600, 400) with a fixed lineage hue, plus a candidate dropped at a
// given x with a chosen hue, so each test controls both distance and kinship.
function setup(seedN, selfHue, choice) {
  const world = new World(makeRng(seedN), { seed: false });
  const self = world.spawnCreature(600, 400);
  self.lineageHue = selfHue;
  self.genome.mateChoice = choice;
  return { world, self };
}
// Hues: KIN matches self's hue exactly (sim 1); STRANGER is well past kinTolerance
// (sim 0). Use 100 as the self/kin hue and 100 + 3·TOL as the stranger's.
const KIN = 100;
const STRANGER = (100 + 3 * TOL) % 360;

function add(world, x, hue) {
  const c = world.spawnCreature(x, 400);
  c.lineageHue = hue;
  return c;
}

// --- Equidistant kin vs. stranger: choice alone decides. ---
{
  // Assortative (1.0) takes the kin; disassortative (0.0) takes the stranger;
  // both candidates sit 50 units either side of self, so only hue can break it.
  {
    const { world, self } = setup(2, KIN, 1.0);
    const kin = add(world, 650, KIN);
    const stranger = add(world, 550, STRANGER);
    world.creatureGrid.rebuild(world.creatures);
    assert.strictEqual(world.findMate(self, RADIUS), kin, "assortative picks the equidistant kin");
  }
  {
    const { world, self } = setup(3, KIN, 0.0);
    const kin = add(world, 650, KIN);
    const stranger = add(world, 550, STRANGER);
    world.creatureGrid.rebuild(world.creatures);
    assert.strictEqual(
      world.findMate(self, RADIUS),
      stranger,
      "disassortative picks the equidistant stranger",
    );
  }
}

// --- Preference can overrule distance: a strong choice reaches past a near
//     mismatch for a far match (within the radius). ---
{
  // Assortative reaches past a near stranger (15 away) for a far kin (80 away).
  {
    const { world, self } = setup(4, KIN, 1.0);
    const nearStranger = add(world, 615, STRANGER);
    const farKin = add(world, 680, KIN);
    world.creatureGrid.rebuild(world.creatures);
    assert.strictEqual(
      world.findMate(self, RADIUS),
      farKin,
      "assortative reaches past a near stranger for a far kin",
    );
  }
  // Disassortative reaches past a near kin for a far stranger.
  {
    const { world, self } = setup(5, KIN, 0.0);
    const nearKin = add(world, 615, KIN);
    const farStranger = add(world, 680, STRANGER);
    world.creatureGrid.rebuild(world.creatures);
    assert.strictEqual(
      world.findMate(self, RADIUS),
      farStranger,
      "disassortative reaches past a near kin for a far stranger",
    );
  }
}

// --- No hue spread to choose across → the preference term is constant and
//     distance breaks the tie, so it falls back to nearest regardless of choice. ---
{
  // All strangers, strong assortative: still takes the nearest.
  {
    const { world, self } = setup(6, KIN, 1.0);
    const near = add(world, 615, STRANGER);
    const far = add(world, 680, STRANGER);
    world.creatureGrid.rebuild(world.creatures);
    assert.strictEqual(world.findMate(self, RADIUS), near, "assortative among only strangers → nearest");
  }
  // All kin, strong disassortative: still takes the nearest.
  {
    const { world, self } = setup(7, KIN, 0.0);
    const near = add(world, 615, KIN);
    const far = add(world, 680, KIN);
    world.creatureGrid.rebuild(world.creatures);
    assert.strictEqual(world.findMate(self, RADIUS), near, "disassortative among only kin → nearest");
  }
}

// --- Neutral choice (0.5) reduces to nearest even with a hue spread present. ---
{
  const { world, self } = setup(8, KIN, 0.5);
  const farKin = add(world, 680, KIN);
  const nearStranger = add(world, 615, STRANGER);
  world.creatureGrid.rebuild(world.creatures);
  assert.strictEqual(
    world.findMate(self, RADIUS),
    nearStranger,
    "neutral choice ignores hue and takes the nearest",
  );
}

// --- A missing gene defaults to neutral (no crash, nearest wins). ---
{
  const { world, self } = setup(9, KIN, 0.5);
  delete self.genome.mateChoice;
  const farKin = add(world, 680, KIN);
  const nearStranger = add(world, 615, STRANGER);
  world.creatureGrid.rebuild(world.creatures);
  assert.strictEqual(
    world.findMate(self, RADIUS),
    nearStranger,
    "a missing mateChoice gene defaults to neutral (nearest)",
  );
}

// --- The choice is wired into reproduce: a strong assortative breeder actually
//     crosses with the kin it would pick, not the nearer stranger. ---
{
  const savedRate = CONFIG.mutation.rate;
  CONFIG.mutation.rate = 0; // silence mutation so the cross is checkable verbatim

  const world = new World(makeRng(11), { seed: false });
  const self = world.spawnCreature(600, 400);
  self.lineageHue = KIN;
  self.genome.mateChoice = 1.0; // assortative
  self.genome.mating = 1.0; // always seek a partner
  self.energy = 1000;

  // A near stranger and a far kin. The kin carries a tell-tale gene value the
  // stranger doesn't, so the child reveals which parent it actually crossed with.
  const nearStranger = world.spawnCreature(615, 400);
  nearStranger.lineageHue = STRANGER;
  nearStranger.genome.speed = GENES.speed[0]; // min
  const farKin = world.spawnCreature(680, 400);
  farKin.lineageHue = KIN;
  farKin.genome.speed = GENES.speed[1]; // max — distinct from self & stranger
  self.genome.speed = (GENES.speed[0] + GENES.speed[1]) / 2; // mid

  world.creatureGrid.rebuild(world.creatures);
  // Force the crossover coin flips to take the partner's gene, so a cross shows
  // up: with mutation off, child.speed == partner.speed only if it crossed with
  // that partner. Sample a few children to be robust to the per-gene coin.
  let crossedWithKin = false;
  for (let i = 0; i < 40; i++) {
    const child = self.reproduce(world, world.rng);
    self.energy = 1000; // top back up for the next round
    if (child.genome.speed === farKin.genome.speed) crossedWithKin = true;
    assert.notStrictEqual(
      child.genome.speed,
      nearStranger.genome.speed,
      "an assortative breeder never crosses with the near stranger",
    );
  }
  assert.ok(crossedWithKin, "the assortative breeder crossed with the far kin it chose");

  CONFIG.mutation.rate = savedRate;
}

console.log("MATE-CHOICE TEST PASSED");
