// Minimap / world-overview thumbnail. The pan/zoom camera lets a large world be
// explored up close, but zooming in loses the global picture — which corner the
// inspected creature is heading toward, where the booms and busts are happening
// off-screen. This corner thumbnail draws the whole world at a glance with the
// current viewport outlined on it, so the zoomed-in view stays navigable: a
// click jumps the camera anywhere on the map. It pairs with the inspector trail,
// plotting the selected creature's recent track on the overview too.
//
// Everything geometric (the aspect-fit size, the world↔thumbnail mappings, the
// visible-viewport rectangle) lives here as pure functions so it's unit-testable
// headlessly; the `Minimap` view class below owns the canvas and the per-frame
// draw, and `main.js` wires the click-to-navigate. It holds no simulation state
// and adds nothing to the save — purely a view aid.

import { trailSegments } from "./trail.js";
import { binPoints, normalize, heatColor, heatGridSize } from "./heatmap.js";
import { killWeight } from "./killfeed.js";

export const MINIMAP = {
  // The thumbnail fits within this pixel box, preserving the world's aspect
  // ratio (the limiting axis touches the box, the other is letterboxed). The
  // width matches the HUD column's inner content width so it sits flush with the
  // charts above it.
  maxW: 208,
  maxH: 150,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Fit the world's aspect ratio into the max box, returning the thumbnail's pixel
// size. The limiting axis touches the box; the other is letterboxed, so a
// non-square world reads with its true proportions.
export function minimapSize(worldW, worldH, maxW = MINIMAP.maxW, maxH = MINIMAP.maxH) {
  const scale = Math.min(maxW / worldW, maxH / worldH);
  return { w: worldW * scale, h: worldH * scale };
}

// World point → minimap-local pixel (origin at the thumbnail's top-left). A
// linear scale per axis since the thumbnail size already matches the world's
// aspect ratio, so the mapping is uniform and stays proportional.
export function worldToMinimap(wx, wy, mmW, mmH, worldW, worldH) {
  return { x: (wx / worldW) * mmW, y: (wy / worldH) * mmH };
}

// Minimap-local pixel → world point — the exact inverse of `worldToMinimap`,
// used to turn a click on the thumbnail into the world point to recentre on.
export function minimapToWorld(mx, my, mmW, mmH, worldW, worldH) {
  return { x: (mx / mmW) * worldW, y: (my / mmH) * worldH };
}

// The currently-visible world region, derived from the renderer's live camera
// transform (screenX = offsetX + worldX·scale) and the viewport size, clamped to
// the world bounds. At zoom 1 the letterboxed view "sees" past the world edges,
// so the rectangle is pinned to the world rather than spilling off the thumbnail
// — it then covers the whole minimap, reading as "you're seeing everything".
export function visibleWorldRect(view, viewW, viewH, worldW, worldH) {
  const { scale, offsetX, offsetY } = view;
  const x0 = clamp((0 - offsetX) / scale, 0, worldW);
  const y0 = clamp((0 - offsetY) / scale, 0, worldH);
  const x1 = clamp((viewW - offsetX) / scale, 0, worldW);
  const y1 = clamp((viewH - offsetY) / scale, 0, worldH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Owns the minimap canvas and its per-frame draw. A separate DOM canvas (rather
// than painting onto the main one) keeps it clear of the tool/camera pointer
// controllers that own the world canvas — the minimap gets its own click
// handling, wired in `main.js`, with no contention over a gesture.
export class Minimap {
  constructor(canvas, camera, renderer) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.camera = camera;
    this.renderer = renderer; // for the live viewport size and world→screen transform
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Current thumbnail size in CSS pixels; resized lazily to the world's aspect.
    this.w = 0;
    this.h = 0;
    // Active heatmap overlay layer ("off" / "population" / "food" / "scent"),
    // cycled by the HUD toggle. "off" leaves the plain dot overview untouched.
    this.heatMode = "off";
  }

  // Size the backing canvas to the world's aspect ratio (only when it changes,
  // so a steady world doesn't reallocate the bitmap every frame).
  resize(worldW, worldH) {
    const { w, h } = minimapSize(worldW, worldH);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
  }

  // Draw the overview: a dark backdrop, every creature as a tiny dot (coloured to
  // match the main canvas's mode), the selected creature's trail and marker, and
  // the current viewport rectangle. `selected`/`trail` mirror what the renderer
  // is highlighting, so the minimap and the main view agree on the focus.
  draw(world, selected, trail) {
    this.resize(world.width, world.height);
    const ctx = this.ctx;
    const mmW = this.w;
    const mmH = this.h;
    if (mmW < 1 || mmH < 1) return;
    const worldW = world.width;
    const worldH = world.height;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, mmW, mmH);

    // Backdrop: a touch lighter than the page so the thumbnail reads as a map.
    ctx.fillStyle = "rgba(8, 12, 19, 0.92)";
    ctx.fillRect(0, 0, mmW, mmH);

    // Heatmap wash (under everything else, so the dots/trail/viewport stay on
    // top): a coarse grid of the selected quantity binned across the whole world.
    this.drawHeat(world, mmW, mmH);

    // Creatures as 1px dots, coloured by the renderer's active mode (diet hue in
    // trophic, clade hue in lineage) so the overview matches the main canvas.
    const lineage = this.renderer.colorMode === "lineage";
    for (const c of world.creatures) {
      const p = worldToMinimap(c.x, c.y, mmW, mmH, worldW, worldH);
      ctx.fillStyle = `hsl(${lineage ? c.lineageHue : c.hue}, 65%, 60%)`;
      ctx.fillRect(p.x - 0.5, p.y - 0.5, 1.5, 1.5);
    }

    // Selected creature's trail, plotted on the overview as a faint polyline
    // (split at the toroidal seam the same way the main trail is, so a wrap
    // doesn't streak a false line across the thumbnail).
    if (selected && selected.alive && trail) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      for (const seg of trailSegments(trail.points, worldW, worldH)) {
        ctx.beginPath();
        for (let i = 0; i < seg.length; i++) {
          const p = worldToMinimap(seg[i].x, seg[i].y, mmW, mmH, worldW, worldH);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    // Selected creature: a small bright ring so the inspected individual stands
    // out from the crowd of dots even at thumbnail scale.
    if (selected && selected.alive) {
      const p = worldToMinimap(selected.x, selected.y, mmW, mmH, worldW, worldH);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Viewport rectangle: outline the world region the main view is showing, read
    // from the renderer's live transform. At zoom 1 it covers the whole thumbnail.
    const view = {
      scale: this.renderer.scale,
      offsetX: this.renderer.offsetX,
      offsetY: this.renderer.offsetY,
    };
    const r = visibleWorldRect(view, this.renderer.viewW, this.renderer.viewH, worldW, worldH);
    const tl = worldToMinimap(r.x, r.y, mmW, mmH, worldW, worldH);
    const wpx = (r.w / worldW) * mmW;
    const hpx = (r.h / worldH) * mmH;
    ctx.strokeStyle = "rgba(111, 211, 199, 0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, Math.max(1, wpx - 1), Math.max(1, hpx - 1));
  }

  // Bin the active heat quantity across the world and wash it onto the thumbnail
  // as a coloured grid. A no-op when the overlay is off or the source is empty.
  // Pure binning/colour maths live in `heatmap.js`; this just picks the data
  // source per mode and paints the cells.
  drawHeat(world, mmW, mmH) {
    const src = heatSource(world, this.heatMode);
    if (!src) return;
    const { cols, rows } = heatGridSize(mmW, mmH);
    const grid = binPoints(
      src.items,
      cols,
      rows,
      world.width,
      world.height,
      src.getX,
      src.getY,
      src.getWeight
    );
    const norm = normalize(grid);
    const ctx = this.ctx;
    const cw = mmW / cols;
    const ch = mmH / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = norm[r * cols + c];
        if (t <= 0) continue;
        ctx.fillStyle = heatColor(t);
        // Overlap each cell by ~0.5px so the grid reads as a continuous wash
        // rather than a tile fence at thumbnail scale.
        ctx.fillRect(c * cw - 0.5, r * ch - 0.5, cw + 1, ch + 1);
      }
    }
  }

  // Convert a client (screen) pixel to the world point under it, via the
  // thumbnail's on-screen rectangle. Returns null if the thumbnail isn't sized
  // yet. Used by the click-to-navigate handler in `main.js`.
  clientToWorld(clientX, clientY, worldW, worldH) {
    if (this.w < 1 || this.h < 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mx = clamp(clientX - rect.left, 0, this.w);
    const my = clamp(clientY - rect.top, 0, this.h);
    return minimapToWorld(mx, my, this.w, this.h, worldW, worldH);
  }
}

// Resolve a heat mode to its live data source: the items to bin, how to read each
// one's position, and its weight. Returns null for "off" (or an unknown mode), so
// the overlay simply draws nothing. Kept as a plain function (not a method) so the
// mode→source mapping is in one readable place and easy to extend.
//
//   * population — every live creature, weight 1, so the grid is a body-count
//     density (where the crowd is, beyond what the dot scatter shows).
//   * food       — every plant pellet, weight 1: the standing larder's thickness.
//   * scent      — every plume, weighted by its remaining strength, so a fresh
//     strong death-marker glows brighter than a faded feeding mark.
//   * kills      — recent kill sites from the view-only kill feed, weighted by
//     recency (fresh kills glow, old ones fade), so predation hotspots read at a
//     glance. Unlike the other three this isn't standing live state — a kill is
//     an event — so the world accumulates the positions transiently for the view.
function heatSource(world, mode) {
  switch (mode) {
    case "population":
      return { items: world.creatures, getX: (c) => c.x, getY: (c) => c.y, getWeight: () => 1 };
    case "food":
      return { items: world.food, getX: (f) => f.x, getY: (f) => f.y, getWeight: () => 1 };
    case "scent":
      return {
        items: world.scent ? world.scent.plumes : null,
        getX: (p) => p.x,
        getY: (p) => p.y,
        getWeight: (p) => p.strength,
      };
    case "kills": {
      const feed = world.killFeed;
      if (!feed) return null;
      feed.prune(world.time); // tidy fully-faded sites before reading
      return {
        items: feed.sites,
        getX: (s) => s.x,
        getY: (s) => s.y,
        getWeight: (s) => killWeight(s, world.time, feed.maxAge),
      };
    }
    default:
      return null;
  }
}
