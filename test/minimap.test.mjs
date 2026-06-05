// Headless tests for the minimap geometry (`src/minimap.js`): the aspect-fit
// thumbnail size, the world↔thumbnail point mappings, and the visible-viewport
// rectangle derived from the camera transform. The canvas draw itself needs a
// browser, but every bit of geometry the overview relies on is pure and fully
// testable here. Cross-checked against the real `Camera` so the rectangle the
// minimap outlines matches what the renderer actually shows.

import assert from "node:assert";
import {
  minimapSize,
  worldToMinimap,
  minimapToWorld,
  visibleWorldRect,
  MINIMAP,
} from "../src/minimap.js";
import { Camera } from "../src/camera.js";

const approx = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= (eps ?? 1e-9), `${msg}: ${a} vs ${b}`);

// A representative world size for the camera cross-checks below.
const CONFIGLESS_W = 1600;
const CONFIGLESS_H = 1000;

// --- minimapSize fits the world into the box, preserving aspect ratio. ---
{
  // A wide world: width is the limiting axis, so it touches maxW and the height
  // is letterboxed shorter.
  const { w, h } = minimapSize(1200, 800, 180, 140);
  // min(180/1200, 140/800) = min(0.15, 0.175) = 0.15
  approx(w, 180, 1e-9, "wide world width touches maxW");
  approx(h, 120, 1e-9, "wide world height scaled by the limiting axis");
  assert.ok(w <= 180 + 1e-9 && h <= 140 + 1e-9, "stays within the box");
  // Aspect ratio preserved.
  approx(w / h, 1200 / 800, 1e-9, "aspect ratio preserved");
}

// --- A tall world is limited by height instead. ---
{
  const { w, h } = minimapSize(400, 1000, 180, 140);
  // min(180/400, 140/1000) = min(0.45, 0.14) = 0.14
  approx(h, 140, 1e-9, "tall world height touches maxH");
  approx(w, 56, 1e-9, "tall world width scaled by the limiting axis");
}

// --- A square world in a square box fills it exactly. ---
{
  const { w, h } = minimapSize(500, 500, 160, 160);
  approx(w, 160, 1e-9, "square width");
  approx(h, 160, 1e-9, "square height");
}

// --- The default box is used when no max is passed. ---
{
  const { w, h } = minimapSize(MINIMAP.maxW * 2, MINIMAP.maxH * 2);
  approx(w, MINIMAP.maxW, 1e-9, "defaults to MINIMAP.maxW");
  approx(h, MINIMAP.maxH, 1e-9, "defaults to MINIMAP.maxH");
}

// --- worldToMinimap maps corners and centre proportionally. ---
{
  const mmW = 180;
  const mmH = 120;
  const W = 1200;
  const H = 800;
  let p = worldToMinimap(0, 0, mmW, mmH, W, H);
  approx(p.x, 0, 1e-9, "origin x");
  approx(p.y, 0, 1e-9, "origin y");
  p = worldToMinimap(W, H, mmW, mmH, W, H);
  approx(p.x, mmW, 1e-9, "far corner x");
  approx(p.y, mmH, 1e-9, "far corner y");
  p = worldToMinimap(W / 2, H / 2, mmW, mmH, W, H);
  approx(p.x, mmW / 2, 1e-9, "centre x");
  approx(p.y, mmH / 2, 1e-9, "centre y");
}

// --- minimapToWorld is the exact inverse of worldToMinimap. ---
{
  const mmW = 180;
  const mmH = 120;
  const W = 1200;
  const H = 800;
  for (const [wx, wy] of [
    [0, 0],
    [300, 500],
    [W, H],
    [777, 123],
  ]) {
    const p = worldToMinimap(wx, wy, mmW, mmH, W, H);
    const back = minimapToWorld(p.x, p.y, mmW, mmH, W, H);
    approx(back.x, wx, 1e-9, "round-trip x");
    approx(back.y, wy, 1e-9, "round-trip y");
  }
}

// --- visibleWorldRect at zoom 1 covers the whole world (clamped). ---
{
  const W = CONFIGLESS_W;
  const H = CONFIGLESS_H;
  const cam = new Camera();
  const viewW = 1000;
  const viewH = 700;
  const view = cam.view(W, H, viewW, viewH);
  const r = visibleWorldRect(view, viewW, viewH, W, H);
  // The letterboxed fit sees past the world edges; clamped, the rect is the
  // whole world — so the minimap outline covers the entire thumbnail.
  approx(r.x, 0, 1e-6, "zoom-1 rect left at world edge");
  approx(r.y, 0, 1e-6, "zoom-1 rect top at world edge");
  approx(r.w, W, 1e-6, "zoom-1 rect spans full world width");
  approx(r.h, H, 1e-6, "zoom-1 rect spans full world height");
}

// --- Zoomed in and centred, the rect is a centred sub-window of the world. ---
{
  const W = CONFIGLESS_W;
  const H = CONFIGLESS_H;
  const cam = new Camera();
  // A viewport matching the world's aspect ratio, so the fit scale is equal on
  // both axes and the visible span is cleanly 1/zoom of the world each way.
  const viewW = 800;
  const viewH = 500;
  // Zoom about the viewport centre so the centre stays put.
  cam.zoomAt(4, viewW / 2, viewH / 2, W, H, viewW, viewH);
  const view = cam.view(W, H, viewW, viewH);
  const r = visibleWorldRect(view, viewW, viewH, W, H);
  // Strictly inside the world on every side, and the rect's centre is the
  // world centre (the camera was zoomed about the middle from the centred view).
  assert.ok(r.x > 0 && r.y > 0, "zoomed rect pulled in from the top-left");
  assert.ok(r.x + r.w < W && r.y + r.h < H, "zoomed rect pulled in from the bottom-right");
  approx(r.x + r.w / 2, W / 2, 1e-6, "rect centred on world centre x");
  approx(r.y + r.h / 2, H / 2, 1e-6, "rect centred on world centre y");
  // At 4× zoom the visible span is a quarter of the fit span on each axis.
  approx(r.w, W / 4, 1e-6, "rect width is 1/zoom of the world");
  approx(r.h, H / 4, 1e-6, "rect height is 1/zoom of the world");
}

// --- Panned to a corner, the rect clamps against the world edge. ---
{
  const W = CONFIGLESS_W;
  const H = CONFIGLESS_H;
  const cam = new Camera();
  const viewW = 1000;
  const viewH = 700;
  cam.zoomAt(4, viewW / 2, viewH / 2, W, H, viewW, viewH);
  // Pan hard toward the top-left; the camera clamps the centre so the window
  // stays inside the world, pinning the rect's top-left corner to the origin.
  cam.panByWorld(-100000, -100000, W, H, viewW, viewH);
  const view = cam.view(W, H, viewW, viewH);
  const r = visibleWorldRect(view, viewW, viewH, W, H);
  approx(r.x, 0, 1e-6, "panned-to-corner rect pinned to left edge");
  approx(r.y, 0, 1e-6, "panned-to-corner rect pinned to top edge");
  assert.ok(r.w > 0 && r.w < W, "rect still a sub-window in width");
  assert.ok(r.h > 0 && r.h < H, "rect still a sub-window in height");
}

console.log("MINIMAP TEST PASSED");
