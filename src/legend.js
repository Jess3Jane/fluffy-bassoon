// The in-app legend: a key for the canvas colours and washes. Everything painted
// on the world encodes something — trophic vs. lineage creature colour, the two
// plant kinds, the terrain tiles, the amber/blue climate wash, scent plumes, the
// night/weather skies — but none of it is documented on screen. This builds a
// small folding panel that names each colour, sourced from the same `palette.js`
// the renderer paints from so the swatches never drift out of sync.

import {
  TILE_COLORS,
  FOOD_COLORS,
  CLIMATE_WARM,
  CLIMATE_COOL,
  SCENT_FOOD,
  SCENT_DANGER,
  NIGHT_VEIL,
  WEATHER_RAIN,
  WEATHER_DROUGHT,
  TROPHIC_HERBIVORE,
  TROPHIC_CARNIVORE,
  TILE,
} from "./palette.js";
import { kindLabel } from "./plants.js";

// A swatch descriptor names how the colour reads on the canvas:
//   solid    — a flat fill (plants, terrain tiles)
//   gradient — a band between two endpoints (trophic diet, the climate wash)
//   hue      — the full colour wheel (the lineage clade marker)
//   wash     — a translucent overlay laid over the dark scene (scent, sky)
const solid = (color) => ({ kind: "solid", colors: [color] });
const gradient = (...colors) => ({ kind: "gradient", colors });
const hue = () => ({ kind: "hue", colors: [] });
const wash = (color) => ({ kind: "wash", colors: [color] });

// The legend content as plain data, so it can be unit-tested without a DOM and
// rendered by `renderLegend` below. The creatures section depends on the active
// colour mode — the same bodies mean diet under "trophic" and clade under
// "lineage" — so it is built from `colorMode`; everything else is fixed.
export function legendModel(colorMode) {
  const creatures =
    colorMode === "lineage"
      ? {
          title: "Creatures — lineage",
          items: [
            { swatch: hue(), label: "Clade hue", note: "kin share a colour; diverged clades drift apart" },
          ],
        }
      : {
          title: "Creatures — trophic",
          items: [
            {
              swatch: gradient(TROPHIC_HERBIVORE, TROPHIC_CARNIVORE),
              label: "Herbivore → Carnivore",
              note: "diet, green grazer to red hunter",
            },
          ],
        };

  return [
    creatures,
    {
      title: "Plants",
      items: [
        { swatch: solid(FOOD_COLORS[0]), label: `${kindLabel(0)}leaf`, note: "day-leaning yield" },
        { swatch: solid(FOOD_COLORS[1]), label: `${kindLabel(1)}leaf`, note: "night-leaning yield" },
      ],
    },
    {
      title: "Ground",
      items: [
        { swatch: solid(TILE_COLORS[TILE.WATER]), label: "Water", note: "bogs movement — a barrier" },
        { swatch: solid(TILE_COLORS[TILE.FERTILE]), label: "Fertile", note: "plants cluster here" },
        { swatch: solid(TILE_COLORS[TILE.BARREN]), label: "Barren", note: "little grows" },
      ],
    },
    {
      title: "Climate wash",
      items: [
        { swatch: gradient(CLIMATE_COOL, CLIMATE_WARM), label: "Cooler ↔ Warmer", note: "the microclimate creatures sort along" },
      ],
    },
    {
      title: "Scent",
      items: [
        { swatch: wash(SCENT_FOOD), label: "Food", note: "grazing drifts on the wind" },
        { swatch: wash(SCENT_DANGER), label: "Danger", note: "where blood was spilt" },
      ],
    },
    {
      title: "Sky",
      items: [
        { swatch: wash(NIGHT_VEIL), label: "Night", note: "the day-night veil" },
        { swatch: wash(WEATHER_RAIN), label: "Rain", note: "a cool, wet spell" },
        { swatch: wash(WEATHER_DROUGHT), label: "Drought", note: "a dry warm haze" },
      ],
    },
  ];
}

// Build the CSS background for a swatch from its descriptor. The wash kind lays
// the translucent overlay over the dark scene colour, mirroring how it reads on
// the canvas (a faint tint, not a solid block).
function swatchBackground(swatch) {
  switch (swatch.kind) {
    case "gradient":
      return `linear-gradient(90deg, ${swatch.colors.join(", ")})`;
    case "hue":
      return "linear-gradient(90deg, hsl(0,65%,50%), hsl(60,65%,50%), hsl(120,65%,50%), hsl(180,65%,50%), hsl(240,65%,50%), hsl(300,65%,50%), hsl(360,65%,50%))";
    case "wash":
      // The scene the washes sit over is near-black; fade the swatch the same way
      // so e.g. the night veil reads as a deep tint rather than a flat block.
      return `linear-gradient(90deg, #0a0e14, ${washTint(swatch.colors[0])})`;
    default:
      return swatch.colors[0];
  }
}

// Turn an `rgb(...)` string into a translucent `rgba(...)` so a wash swatch shows
// as the faint overlay it is on the canvas. Non-rgb inputs pass through.
function washTint(color) {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, 0.75)` : color;
}

// Render the legend model into `container` (its `<div id="legend-body">`). Pure
// DOM construction — safe to call again on a colour-mode change to rebuild the
// creatures section against the new mode.
export function renderLegend(container, colorMode) {
  container.textContent = "";
  for (const section of legendModel(colorMode)) {
    const head = document.createElement("div");
    head.className = "legend-sect";
    head.textContent = section.title;
    container.appendChild(head);
    for (const item of section.items) {
      const row = document.createElement("div");
      row.className = "legend-row";
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = swatchBackground(item.swatch);
      const text = document.createElement("span");
      text.className = "legend-text";
      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = item.label;
      text.appendChild(label);
      if (item.note) {
        const note = document.createElement("span");
        note.className = "legend-note";
        note.textContent = item.note;
        text.appendChild(note);
      }
      row.append(sw, text);
      container.appendChild(row);
    }
  }
}
