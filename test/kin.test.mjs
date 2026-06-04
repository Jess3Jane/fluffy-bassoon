// Unit test for kin recognition: every plume now carries the lineage hue of the
// creature that laid it, and a smeller weights each plume's pull by how close
// that hue is to its own — scaled by the new heritable `kinship` gene. At
// kinship 0 a creature is kin-blind (the old behaviour); as it rises it answers
// mostly its own kin and discounts strangers. This is the lever that lets honest
// *food* signalling pay through inclusive fitness instead of eroding to silence.
// Pure logic, no DOM.

import assert from "node:assert";
import { ScentField, SCENT } from "../src/scent.js";
import { World } from "../src/world.js";
import { GENES, randomGenome, hueSimilarity } from "../src/genome.js";
import { makeRng } from "../src/rng.js";
import { CONFIG } from "../src/config.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = 1200;
const H = 800;
const TOL = CONFIG.scent.kinTolerance;

// --- The kinship gene exists, is random in [0, 1], and is a real gene (so the
//     generic mutation/clamp machinery covers it like any other).
{
  const g = randomGenome(makeRng(1));
  assert.ok("kinship" in GENES, "kinship is a real gene");
  const [min, max] = GENES.kinship;
  assert.ok(g.kinship >= min && g.kinship <= max, "kinship starts in range");
}

// --- hueSimilarity: 1 at identical hue, falling linearly to 0 at `tolerance`
//     degrees apart, clamped at 0 beyond; wraps around the colour wheel; and a
//     null hue (untagged plume) counts as fully similar (kin-blind fallback).
{
  assert.ok(close(hueSimilarity(100, 100, TOL), 1), "identical hue → similarity 1");
  assert.ok(close(hueSimilarity(100, 100 + TOL, TOL), 0), "tolerance apart → similarity 0");
  assert.ok(close(hueSimilarity(100, 100 + TOL / 2, TOL), 0.5), "half tolerance → 0.5");
  assert.ok(close(hueSimilarity(100, 300, TOL), 0), "far apart → clamped to 0");
  // Circular: 350° and 10° are only 20° apart across the wrap.
  assert.ok(close(hueSimilarity(350, 10, TOL), 1 - 20 / TOL), "hue distance wraps the wheel");
  assert.ok(close(hueSimilarity(null, 123, TOL), 1), "a null (untagged) hue reads as kin");
  assert.ok(close(hueSimilarity(123, null, TOL), 1), "a null smeller hue reads as kin");
}

// --- emit tags a plume with the emitter's hue; it survives serialize/deserialize.
{
  const f = new ScentField(W, H);
  f.emit(10, 10, SCENT.FOOD, 1, 200);
  f.emit(20, 20, SCENT.DANGER, 1); // untagged
  assert.equal(f.plumes[0].hue, 200, "emit records the emitter hue");
  assert.equal(f.plumes[1].hue, null, "an untagged emit stores a null hue");

  const round = ScentField.deserialize(
    JSON.parse(JSON.stringify(f.serialize())),
    W,
    H,
  );
  assert.equal(round.plumes[0].hue, 200, "hue survives the round-trip");
  assert.equal(round.plumes[1].hue, null, "a null hue survives the round-trip");
}

// --- steer kin-weighting: with a food plume tagged hue 100, a herbivore...
{
  const f = new ScentField(W, H);
  f.emit(100, 50, SCENT.FOOD, 1.5, 100); // plume due east, tagged hue 100
  f.rebuild();

  // ...that is kin (same hue), at full kinship, gets the full pull.
  const kin = f.steer(50, 50, 0, 140, 1, 1, 100, 1);
  assert.ok(kin.dx > 0, "a kin creature is pulled toward kin food scent");

  // ...that is a stranger (far hue), at full kinship, ignores the call entirely.
  const stranger = f.steer(50, 50, 0, 140, 1, 1, 100 + 180, 1);
  assert.ok(close(stranger.dx, 0) && close(stranger.dy, 0), "full kinship ignores a stranger's call");

  // ...that is kin-blind (kinship 0) answers the same call regardless of hue,
  //    exactly as before kin recognition existed.
  const blindKin = f.steer(50, 50, 0, 140, 1, 1, 100, 0);
  const blindStranger = f.steer(50, 50, 0, 140, 1, 1, 100 + 180, 0);
  assert.ok(close(blindKin.dx, kin.dx), "kinship 0 matches the old full-response field (kin)");
  assert.ok(close(blindStranger.dx, kin.dx), "kinship 0 is deaf to hue (stranger pulls the same)");

  // ...a half-tolerance-distant emitter at full kinship gets half the pull: the
  //    weight slides smoothly between kin and stranger.
  const half = f.steer(50, 50, 0, 140, 1, 1, 100 + TOL / 2, 1);
  assert.ok(close(half.dx, kin.dx * 0.5), "kin weight scales the pull linearly with hue distance");
}

// --- An untagged plume (older save) is heard by everyone regardless of kinship,
//     so kin recognition degrades gracefully rather than silencing the field.
{
  const f = new ScentField(W, H);
  f.emit(100, 50, SCENT.FOOD, 1.5); // no hue
  f.rebuild();
  const picky = f.steer(50, 50, 0, 140, 1, 1, 100, 1); // max kinship, any hue
  assert.ok(picky.dx > 0, "an untagged plume is heard even at full kinship");
}

// --- In a live world, the food plume a creature lays is tagged with *its own*
//     lineage hue, so kin downstream can recognise the caller.
{
  const world = new World(makeRng(7), { seed: false });
  const c = world.spawnCreature(600, 400);
  c.energy = 200;
  c.genome.foodVoice = 1;
  // Drop food right on top of it and step once so it feeds and signals.
  world.spawnFood(600, 400);
  world.update(1 / 60);
  const foodPlumes = world.scent.plumes.filter((p) => p.kind === SCENT.FOOD);
  assert.ok(foodPlumes.length > 0, "the feeding creature laid a food plume");
  assert.ok(
    foodPlumes.some((p) => close(p.hue, c.lineageHue)),
    "the food plume carries the feeder's lineage hue",
  );
}

console.log("KIN TEST PASSED");
