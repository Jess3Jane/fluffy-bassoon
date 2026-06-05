// Shared colour palette for the canvas renderer and the in-app legend. Keeping
// the swatch colours in one place means the legend stays in lockstep with what
// the renderer actually paints — change a hue here and both update together.

import { TILE } from "./terrain.js";

// Fill colours per tile kind, indexed by the TILE enum. Grass doubles as the
// world backdrop, so only the patches that differ from it are drawn over the top.
export const TILE_COLORS = [
  "#0e1a17", // grass — the base ground
  "#15364e", // water — deep blue
  "#163a22", // fertile — rich green
  "#332b1d", // barren — dry brown
];

// Fill colours per plant kind: kind 0 a leafy green, kind 1 a violet, so the two
// sub-resources creatures partition along read apart at a glance.
export const FOOD_COLORS = ["#3f7d52", "#7d6fb0"];

// Microclimate wash extremes: amber where a region runs warmer than average,
// blue where it runs cooler. (The renderer fades these to a faint alpha.)
export const CLIMATE_WARM = "rgb(214, 140, 64)";
export const CLIMATE_COOL = "rgb(74, 128, 184)";

// Scent plume colours: green for "food here", red for the "danger" of a kill —
// the same green/red the trophic creature colouring uses.
export const SCENT_FOOD = "rgb(96, 220, 132)";
export const SCENT_DANGER = "rgb(228, 72, 96)";

// Sky washes laid over the whole scene: a dark veil for night, a cool grey-blue
// for rain, a dry warm haze for drought.
export const NIGHT_VEIL = "rgb(6, 10, 28)";
export const WEATHER_RAIN = "rgb(70, 92, 120)";
export const WEATHER_DROUGHT = "rgb(120, 92, 44)";

// Trophic creature colouring endpoints. `genomeHue` maps diet onto 120° green
// (herbivore) → 0° red (carnivore) at the body's saturation/lightness; the
// legend shows that band, so the two extremes name themselves.
export const TROPHIC_HERBIVORE = "hsl(120, 65%, 50%)";
export const TROPHIC_CARNIVORE = "hsl(0, 65%, 50%)";

// Re-export the tile enum so callers can index TILE_COLORS by name.
export { TILE };
