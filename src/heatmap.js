// Heatmap overlay for the minimap. The minimap already plots every creature as a
// dot, but a scatter of dots reads density poorly at thumbnail scale and shows
// nothing about the *other* things spread across the world — where the larder is
// thick, where scent is pooling. This bins a chosen quantity into a coarse grid
// over the whole world and washes it onto the overview as a colour ramp, so an
// off-screen hotspot (a population cluster, a food-rich corner, a fresh kill's
// danger plume) reads at a glance rather than only from the dot scatter.
//
// Everything here is pure and headlessly testable: `binPoints` accumulates
// weighted samples into a grid, `gridMax` / `normalize` scale it onto [0, 1], and
// `heatColor` maps a normalised cell to an rgba string. The `Minimap` view picks
// the data source per mode and paints the grid; `main.js` wires the toggle. It
// holds no simulation state and adds nothing to the save — purely a view aid.

import { clamp01 } from "./math.js";

// The selectable overlay layers, in toggle-cycle order. "off" draws nothing (the
// plain dot overview); the rest each bin a different live quantity.
export const HEATMAP_MODES = ["off", "population", "food", "scent", "kills"];

// Short labels for the HUD toggle button.
export const HEATMAP_LABELS = {
  off: "Off",
  population: "Population",
  food: "Food",
  scent: "Scent",
  kills: "Kills",
};

// Target on-screen size (CSS px) of one heat cell. The grid resolution is derived
// from the thumbnail size so cells stay a readable size whatever the world aspect
// — coarse enough to pool a meaningful sample, fine enough to localise a hotspot.
export const HEAT_CELL_PX = 7;

// Gamma applied when normalising, so low-but-nonzero densities stay visible
// rather than being crushed to black by a single dense outlier cell. < 1 lifts
// the dim end of the ramp.
export const HEAT_GAMMA = 0.55;

// Pick a grid resolution (columns × rows) for a thumbnail of the given pixel
// size, targeting ~`cellPx` per cell and always at least 1×1.
export function heatGridSize(mmW, mmH, cellPx = HEAT_CELL_PX) {
  const cols = Math.max(1, Math.round(mmW / cellPx));
  const rows = Math.max(1, Math.round(mmH / cellPx));
  return { cols, rows };
}

// Which cell a world point falls in. Coordinates are within [0, world) on each
// toroidal axis; a value landing exactly on the far edge (or a hair past it from
// floating-point drift) is clamped into the last cell rather than overflowing.
function cellIndex(v, span, n) {
  let i = Math.floor((v / span) * n);
  if (i < 0) i = 0;
  else if (i >= n) i = n - 1;
  return i;
}

// Accumulate weighted point samples into a `cols × rows` grid (row-major: index
// `row * cols + col`). Each item contributes `getWeight(item)` to the cell its
// `(getX, getY)` position falls in. Returns a Float64Array; an empty item list
// yields an all-zero grid. Pure — no rng, no world mutation.
export function binPoints(items, cols, rows, worldW, worldH, getX, getY, getWeight) {
  const grid = new Float64Array(cols * rows);
  if (!items) return grid;
  for (const item of items) {
    const w = getWeight ? getWeight(item) : 1;
    if (!(w > 0)) continue; // skip zero/negative/NaN weights so they don't taint the grid
    const cx = cellIndex(getX(item), worldW, cols);
    const cy = cellIndex(getY(item), worldH, rows);
    grid[cy * cols + cx] += w;
  }
  return grid;
}

// The largest cell value in a grid (0 for an empty grid). Used as the
// normalisation denominator so the ramp spans the actual range present.
export function gridMax(grid) {
  let max = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
  return max;
}

// Scale a raw grid onto [0, 1] by its peak, with a gamma lift so faint cells stay
// visible. A flat/empty grid (max 0) normalises to all zeros rather than dividing
// by zero. Returns a new Float64Array; the input is left untouched.
export function normalize(grid, gamma = HEAT_GAMMA) {
  const max = gridMax(grid);
  const out = new Float64Array(grid.length);
  if (max <= 0) return out;
  for (let i = 0; i < grid.length; i++) {
    out[i] = Math.pow(grid[i] / max, gamma);
  }
  return out;
}

// Colour-ramp stops for the heat wash: cool/dim at the low end climbing to a hot
// bright peak, so intensity reads as temperature over the dark backdrop. Each
// stop is [position, r, g, b]; alpha is handled separately so the dim end fades
// out rather than masking the map under a flat tint.
const RAMP = [
  [0.0, 30, 60, 140], // deep blue
  [0.35, 40, 170, 180], // teal
  [0.6, 90, 210, 90], // green
  [0.8, 240, 210, 70], // yellow
  [1.0, 240, 90, 60], // red-orange
];

// Max alpha at the hot end; the wash fades to fully transparent at t=0 so the
// creature dots and viewport rectangle drawn on top stay legible.
const RAMP_MAX_ALPHA = 0.72;

// Sample the ramp at normalised intensity `t ∈ [0, 1]`, returning [r, g, b, a]
// (rgb 0–255, a 0–1). Linear interpolation between the bracketing stops; alpha
// climbs from 0 at the dim end so low density barely tints the map.
export function sampleRamp(t) {
  t = clamp01(t);
  let lo = RAMP[0];
  let hi = RAMP[RAMP.length - 1];
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      lo = RAMP[i - 1];
      hi = RAMP[i];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const f = span > 0 ? (t - lo[0]) / span : 0;
  const r = Math.round(lo[1] + (hi[1] - lo[1]) * f);
  const g = Math.round(lo[2] + (hi[2] - lo[2]) * f);
  const b = Math.round(lo[3] + (hi[3] - lo[3]) * f);
  // Alpha ramps with intensity (eased so the dim end stays faint).
  const a = RAMP_MAX_ALPHA * Math.pow(t, 0.75);
  return [r, g, b, a];
}

// Convenience: the ramp as a CSS `rgba(...)` string for a normalised cell value.
// A value at or below 0 returns fully transparent so a zero cell paints nothing.
export function heatColor(t) {
  if (!(t > 0)) return "rgba(0,0,0,0)";
  const [r, g, b, a] = sampleRamp(t);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
