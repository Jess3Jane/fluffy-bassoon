// Interactive editing tools: paint food or seed creatures by clicking and
// dragging on the world. A small palette in the HUD selects the active brush;
// unified pointer events (mouse or touch) drive a continuous stroke, so a drag
// scatters food or sprinkles creatures along its path instead of acting only
// where you first pressed.

import { wrapDelta } from "./math.js";

// Spacing (world units) between successive dabs along a drag, per tool. Food
// paints densely for a lush trail; creatures are spaced further apart so a
// stroke seeds a handful rather than a solid wall of them. Inspect re-picks
// often enough to "scrub" the selection along a drag from body to body.
const STEP = { food: 14, creature: 26, inspect: 10 };

// A food dab scatters this many pellets within this radius, so a brush stroke
// leaves an organic clump rather than a single dot.
const FOOD_DAB_COUNT = 5;
const FOOD_DAB_RADIUS = 22;

// Extra slack (world units) added to a creature's body radius when picking it
// for inspection, so small bodies are still easy to land a click on.
const INSPECT_TOLERANCE = 6;

export const TOOLS = ["food", "creature", "inspect"];
export const TOOL_LABELS = { food: "Food", creature: "Creature", inspect: "Inspect" };

// Wrap a coordinate into [0, size) — strokes can run off the toroidal edges.
function wrap(v, size) {
  return ((v % size) + size) % size;
}

// Owns the canvas pointer interaction for the editing brushes. `getWorld` is a
// callback (not a stored reference) because the world is swapped out on reset /
// load, and the brush must always act on the live one.
export class ToolController {
  constructor({ canvas, renderer, getWorld, onPick }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.getWorld = getWorld;
    // Called by the inspect brush with the creature under the pointer (or null
    // for empty ground, so a click away clears the selection).
    this.onPick = onPick ?? (() => {});
    this.tool = "food";
    this.painting = false;
    this.lastX = 0;
    this.lastY = 0;

    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", (e) => this.onUp(e));
  }

  setTool(tool) {
    if (TOOLS.includes(tool)) this.tool = tool;
  }

  // World coords of a pointer event, or null if it lands outside the world
  // rectangle (e.g. on the letterboxing).
  worldPoint(e) {
    const { x, y } = this.renderer.screenToWorld(e.clientX, e.clientY);
    const world = this.getWorld();
    if (x < 0 || y < 0 || x > world.width || y > world.height) return null;
    return { x, y };
  }

  onDown(e) {
    const p = this.worldPoint(e);
    if (!p) return;
    e.preventDefault();
    this.painting = true;
    this.lastX = p.x;
    this.lastY = p.y;
    // Capture so a drag keeps reporting even if the pointer briefly leaves the
    // canvas; harmless to skip where unsupported.
    this.canvas.setPointerCapture?.(e.pointerId);
    this.apply(p.x, p.y); // one dab immediately on press
  }

  onMove(e) {
    if (!this.painting) return;
    const p = this.worldPoint(e);
    if (!p) return;
    const world = this.getWorld();
    const step = STEP[this.tool];
    // Walk from the last dab toward the pointer in `step`-sized hops (along the
    // shortest toroidal path), dabbing at each — so a fast flick still lays a
    // continuous trail and a slow crawl doesn't pile dabs on one spot.
    let dx = wrapDelta(p.x - this.lastX, world.width);
    let dy = wrapDelta(p.y - this.lastY, world.height);
    let dist = Math.hypot(dx, dy);
    while (dist >= step) {
      const t = step / dist;
      this.lastX = wrap(this.lastX + dx * t, world.width);
      this.lastY = wrap(this.lastY + dy * t, world.height);
      this.apply(this.lastX, this.lastY);
      dx = wrapDelta(p.x - this.lastX, world.width);
      dy = wrapDelta(p.y - this.lastY, world.height);
      dist = Math.hypot(dx, dy);
    }
  }

  onUp(e) {
    if (!this.painting) return;
    this.painting = false;
    this.canvas.releasePointerCapture?.(e.pointerId);
  }

  // Apply the active brush once at (x, y).
  apply(x, y) {
    const world = this.getWorld();
    if (this.tool === "inspect") {
      this.onPick(world.creatureAt(x, y, INSPECT_TOLERANCE));
    } else if (this.tool === "food") {
      for (let i = 0; i < FOOD_DAB_COUNT; i++) {
        // Uniform scatter over a disc (sqrt keeps it from clumping centre-heavy).
        const a = world.rng() * Math.PI * 2;
        const d = Math.sqrt(world.rng()) * FOOD_DAB_RADIUS;
        world.spawnFood(
          wrap(x + Math.cos(a) * d, world.width),
          wrap(y + Math.sin(a) * d, world.height),
        );
      }
    } else {
      world.spawnCreature(x, y);
    }
  }
}
