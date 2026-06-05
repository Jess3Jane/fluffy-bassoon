// Canvas rendering. The world is drawn in world-space and scaled to fit the
// viewport while preserving aspect ratio (letterboxed if needed).

import { CONFIG } from "./config.js";
import { daylight } from "./daycycle.js";
import { kindRhythm, kindClimateRhythm } from "./plants.js";
import { weatherNoise, windStrength, windDirection } from "./weather.js";
import { TILE } from "./terrain.js";
import { SCENT } from "./scent.js";

// Fill colours per tile kind, indexed by the TILE enum. Grass doubles as the
// world backdrop, so only the patches that differ from it are drawn over the top.
const TILE_COLORS = [
  "#0e1a17", // grass — the base ground
  "#15364e", // water — deep blue
  "#163a22", // fertile — rich green
  "#332b1d", // barren — dry brown
];

// Fill colours per plant kind: kind 0 a leafy green, kind 1 a violet, so the two
// sub-resources creatures partition along read apart at a glance.
const FOOD_COLORS = ["#3f7d52", "#7d6fb0"];

// How many cells across to sample the microclimate wash. Coarse — the field is
// broad regional patches, not fine detail — so the overlay stays cheap.
const MICROCLIMATE_CELLS = 32;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    // "trophic" colours by diet (green herbivore → red carnivore); "lineage"
    // colours by the heritable lineage marker so clades show as colour bands.
    this.colorMode = "trophic";
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";

    // Fit the world rectangle inside the viewport, centred.
    const sx = w / CONFIG.world.width;
    const sy = h / CONFIG.world.height;
    this.scale = Math.min(sx, sy);
    this.offsetX = (w - CONFIG.world.width * this.scale) / 2;
    this.offsetY = (h - CONFIG.world.height * this.scale) / 2;
  }

  // Convert a screen/client point into world coordinates.
  screenToWorld(clientX, clientY) {
    return {
      x: (clientX - this.offsetX) / this.scale,
      y: (clientY - this.offsetY) / this.scale,
    };
  }

  draw(world) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // Terrain. Paint the grass backdrop in one fill, then lay the water /
    // fertile / barren patches over it tile by tile.
    this.drawTerrain(ctx, world.terrain);
    // Microclimate: a faint warm/cool wash over the ground so the spatial climate
    // mosaic the creatures sort along is visible — warm regions glow amber, cool
    // ones blue — under the terrain detail and everything else.
    this.drawMicroclimate(ctx, world.microclimate);
    ctx.strokeStyle = "rgba(111, 211, 199, 0.15)";
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(0, 0, world.width, world.height);

    // Scent plumes drift under everything else as soft coloured hazes — green
    // for "food here", red for the "danger" of a kill — so the invisible field
    // the wind carries becomes visible, fading with each plume's strength.
    this.drawScent(ctx, world.scent);

    // Food. The two plant kinds draw in distinct hues — leafy green for kind 0,
    // violet for kind 1 — so the spatial patchwork the resource axis partitions
    // along is visible at a glance, and which kind a clade has settled onto reads
    // straight off where it forages. Each kind is also faded by its current
    // yield rhythm — the fast day-night `kindRhythm` times the slow climate
    // `kindClimateRhythm` (season × weather): a sunleaf glows by day and in a
    // summer rain, dims at night and in a winter drought, a moonleaf the reverse,
    // so the shifting "which specialism pays now" reads on the field itself across
    // all three timescales. One pass per kind keeps the fill set cheap.
    for (let kind = 0; kind < FOOD_COLORS.length; kind++) {
      ctx.fillStyle = FOOD_COLORS[kind];
      // Map the combined rhythm onto a visible alpha band so an out-of-phase
      // patch fades without vanishing; clamp since the climate tilt can push the
      // product above 1 in a kind's boom (a summer storm) — a glow, not an error.
      const glow = kindRhythm(kind, world.time) * kindClimateRhythm(kind, world.time);
      ctx.globalAlpha = Math.min(1, 0.4 + 0.6 * glow);
      for (const f of world.food) {
        if ((f.kind === 1 ? 1 : 0) !== kind) continue;
        ctx.beginPath();
        ctx.arc(f.x, f.y, CONFIG.food.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Creatures.
    for (const c of world.creatures) {
      this.drawCreature(ctx, c);
    }

    // Wind: faint streaks raking across the scene along the prevailing bearing
    // when a storm blows, so the coherent push that herds the population reads at
    // a glance.
    this.drawWind(ctx, world);

    // Night veil: a translucent dark-blue wash over the whole scene that
    // deepens as daylight fades, so the day-night cycle reads at a glance.
    const darkness = 1 - daylight(world.time);
    if (darkness > 0.001) {
      ctx.fillStyle = `rgba(6, 10, 28, ${(darkness * 0.55).toFixed(3)})`;
      ctx.fillRect(0, 0, world.width, world.height);
    }

    // Weather wash: rain greys the scene cool and blue, drought casts a dry warm
    // haze, so the slower climate swing reads at a glance like the night veil.
    // Only the stronger half of each spell shows, so fair weather stays clear.
    const w = weatherNoise(world.time);
    if (w > 0.15) {
      const a = Math.min(0.22, (w - 0.15) * 0.32);
      ctx.fillStyle = `rgba(70, 92, 120, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, world.width, world.height);
    } else if (w < -0.15) {
      const a = Math.min(0.16, (-w - 0.15) * 0.24);
      ctx.fillStyle = `rgba(120, 92, 44, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, world.width, world.height);
    }

    ctx.restore();
  }

  drawTerrain(ctx, terrain) {
    // Grass backdrop covers the whole world; non-grass tiles are drawn on top.
    ctx.fillStyle = TILE_COLORS[TILE.GRASS];
    ctx.fillRect(0, 0, terrain.width, terrain.height);

    const { cols, rows, tileW, tileH, tiles } = terrain;
    // Overlap tiles a hair so seams between same-coloured neighbours don't show.
    const pad = 0.5 / this.scale;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const type = tiles[r * cols + c];
        if (type === TILE.GRASS) continue;
        ctx.fillStyle = TILE_COLORS[type];
        ctx.fillRect(c * tileW - pad, r * tileH - pad, tileW + pad * 2, tileH + pad * 2);
      }
    }
  }

  // The microclimate as a faint coloured wash: a coarse grid of cells, each
  // sampling the local warmth offset and tinting amber where a region runs warmer
  // than the global average, blue where it runs cooler. The alpha tracks the
  // offset's size (capped low so it never fights the entities on top), so the
  // strongest warm/cool corners read clearly while neutral ground stays bare.
  // Purely a view of the static field — it holds no state and never changes.
  drawMicroclimate(ctx, microclimate) {
    const cols = MICROCLIMATE_CELLS;
    const rows = Math.max(1, Math.round(cols * (microclimate.height / microclimate.width)));
    const cw = microclimate.width / cols;
    const ch = microclimate.height / rows;
    const amp = microclimate.warmthAmp || 1;
    const pad = 0.5 / this.scale;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cw;
        const y = (r + 0.5) * ch;
        const warm = microclimate.warmthOffsetAt(x, y) / amp; // ~[-1, 1]
        const a = Math.min(0.14, Math.abs(warm) * 0.14);
        if (a < 0.005) continue;
        ctx.fillStyle =
          warm > 0
            ? `rgba(214, 140, 64, ${a.toFixed(3)})` // amber: warmer than average
            : `rgba(74, 128, 184, ${a.toFixed(3)})`; // blue: cooler than average
        ctx.fillRect(c * cw - pad, r * ch - pad, cw + pad * 2, ch + pad * 2);
      }
    }
  }

  // Faint wind streaks: short segments drifting along the prevailing bearing,
  // animated by the wind clock and wrapped across the toroidal world. They only
  // show once a storm stirs a real wind, fading in with its strength, so fair
  // weather stays clear. Purely decorative — driven entirely by `world.time`, so
  // it holds no state and reads the same at any playback speed.
  drawWind(ctx, world) {
    const strength = windStrength(world.time);
    if (strength <= 0.05) return;
    const dir = windDirection(world.time);
    const cos = Math.cos(dir);
    const sin = Math.sin(dir);
    const len = 14 + strength * 26; // streaks lengthen as the gale builds
    const travel = world.time * (40 + strength * 120); // drift along the wind
    ctx.save();
    ctx.strokeStyle = `rgba(222, 232, 246, ${Math.min(0.16, strength * 0.2).toFixed(3)})`;
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      // A fixed pseudo-random anchor per streak (cheap hash of the index),
      // shifted downwind by `travel` and wrapped back into the world.
      const hx = fract(Math.sin(i * 12.9898) * 43758.5453);
      const hy = fract(Math.sin(i * 78.233) * 12543.6789);
      let x = (hx * world.width + cos * travel) % world.width;
      let y = (hy * world.height + sin * travel) % world.height;
      if (x < 0) x += world.width;
      if (y < 0) y += world.height;
      ctx.moveTo(x, y);
      ctx.lineTo(x - cos * len, y - sin * len);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Paint the scent field as soft translucent blobs, one per plume, sized and
  // faded by strength so a fresh, strong plume reads boldly and a thinning one
  // melts away. Food scent glows green, danger scent red — the same green/red the
  // trophic colouring uses, so "where the grazing is" and "where blood was spilt"
  // read at a glance. Purely a view of `world.scent`; it holds no state of its own.
  drawScent(ctx, scent) {
    for (const p of scent.plumes) {
      const frac = Math.min(1, p.strength / CONFIG.scent.dangerStrength);
      const a = (0.04 + frac * 0.16).toFixed(3);
      const r = 10 + frac * 16;
      ctx.fillStyle =
        p.kind === SCENT.FOOD
          ? `rgba(96, 220, 132, ${a})`
          : `rgba(228, 72, 96, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCreature(ctx, c) {
    const r = c.radius;
    // Energy drives brightness so starving creatures visibly fade.
    const energyFrac = Math.max(
      0.25,
      Math.min(1, c.energy / CONFIG.creature.maxEnergy),
    );
    const light = Math.round(35 + energyFrac * 35);
    const hue = this.colorMode === "lineage" ? c.lineageHue : c.hue;

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.heading);

    // Body.
    ctx.fillStyle = `hsl(${hue}, 65%, ${light}%)`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Heading indicator.
    ctx.fillStyle = `hsl(${hue}, 80%, ${light + 18}%)`;
    ctx.beginPath();
    ctx.moveTo(r * 0.4, 0);
    ctx.lineTo(r * 1.6, 0);
    ctx.lineTo(r * 0.4, r * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

// Fractional part in [0, 1), used to scatter wind-streak anchors from a hash.
function fract(v) {
  return v - Math.floor(v);
}
