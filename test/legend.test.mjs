// Legend model: the in-app colour key is built from a pure data function
// (`legendModel`) so it can be checked without a DOM. These assertions pin the
// structure the renderer relies on and the one mode-dependent section.

import assert from "node:assert";
import { legendModel } from "../src/legend.js";
import {
  FOOD_COLORS,
  TILE_COLORS,
  TROPHIC_HERBIVORE,
  TROPHIC_CARNIVORE,
  TILE,
} from "../src/palette.js";
import { rampStops, HEATMAP_LABELS } from "../src/heatmap.js";

// Every section has a title and at least one item; every item carries a swatch
// with a known kind and a label.
const KINDS = new Set(["solid", "gradient", "hue", "wash"]);
for (const mode of ["trophic", "lineage"]) {
  const model = legendModel(mode);
  assert.ok(Array.isArray(model) && model.length > 0, "model is a non-empty array");
  for (const section of model) {
    assert.ok(section.title, "section has a title");
    assert.ok(section.items.length > 0, `section ${section.title} has items`);
    for (const item of section.items) {
      assert.ok(item.label, "item has a label");
      assert.ok(item.swatch && KINDS.has(item.swatch.kind), "item swatch has a known kind");
    }
  }
}

// The creatures section is mode-dependent: trophic shows the diet gradient,
// lineage shows the clade hue wheel.
const trophic = legendModel("trophic")[0];
assert.ok(/trophic/i.test(trophic.title), "first trophic section is the trophic creatures key");
assert.deepStrictEqual(
  trophic.items[0].swatch,
  { kind: "gradient", colors: [TROPHIC_HERBIVORE, TROPHIC_CARNIVORE] },
  "trophic creature swatch is the herbivore→carnivore gradient",
);

const lineage = legendModel("lineage")[0];
assert.ok(/lineage/i.test(lineage.title), "first lineage section is the lineage creatures key");
assert.strictEqual(lineage.items[0].swatch.kind, "hue", "lineage creature swatch is the hue wheel");

// The rest of the key is shared across modes — same sections, same swatches.
const titlesAfterCreatures = (m) => legendModel(m).slice(1).map((s) => s.title);
assert.deepStrictEqual(
  titlesAfterCreatures("trophic"),
  titlesAfterCreatures("lineage"),
  "non-creature sections are identical across colour modes",
);

// Swatch colours are sourced from the shared palette, so the legend stays in
// lockstep with the renderer. Spot-check a plant and a terrain swatch.
const plants = legendModel("trophic").find((s) => s.title === "Plants");
assert.strictEqual(plants.items[0].swatch.colors[0], FOOD_COLORS[0], "sunleaf swatch uses the food palette");
assert.strictEqual(plants.items[1].swatch.colors[0], FOOD_COLORS[1], "moonleaf swatch uses the food palette");

const ground = legendModel("trophic").find((s) => s.title === "Ground");
const water = ground.items.find((i) => i.label === "Water");
assert.strictEqual(water.swatch.colors[0], TILE_COLORS[TILE.WATER], "water swatch uses the tile palette");

// The heatmap scale documents the minimap wash: a single gradient swatch built
// from the same `rampStops` the overlay paints (so the key can't drift), with a
// stop per ramp colour positioned at its intensity. Its note names the sources.
const heat = legendModel("trophic").find((s) => s.title === "Heatmap (minimap)");
assert.ok(heat, "legend has a heatmap section");
const heatSwatch = heat.items[0].swatch;
assert.strictEqual(heatSwatch.kind, "gradient", "heat swatch is a gradient");
const stops = rampStops();
assert.strictEqual(
  heatSwatch.colors.length,
  stops.length,
  "heat swatch has one stop per ramp colour",
);
assert.strictEqual(
  heatSwatch.colors[0],
  `${stops[0].color} 0%`,
  "first heat stop is the ramp floor at 0%",
);
assert.strictEqual(
  heatSwatch.colors[stops.length - 1],
  `${stops[stops.length - 1].color} 100%`,
  "last heat stop is the ramp peak at 100%",
);
// The note names the wash's live sources (every heatmap mode but "off").
for (const label of [HEATMAP_LABELS.population, HEATMAP_LABELS.food, HEATMAP_LABELS.scent, HEATMAP_LABELS.kills]) {
  assert.ok(heat.items[0].note.includes(label), `heat note names the ${label} source`);
}
assert.ok(!heat.items[0].note.includes(HEATMAP_LABELS.off), "heat note omits the off mode");

console.log("LEGEND TEST PASSED");
