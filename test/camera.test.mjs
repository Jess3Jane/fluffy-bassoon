// Headless tests for the pan/zoom camera's pure transform core (`src/camera.js`).
// The DOM input wiring (wheel / pointer / keyboard / buttons in CameraController)
// needs a browser, so — like the renderer and main entry point — it's exercised
// by hand; but the Camera maths (the fit transform, zoom/centre clamping, the
// focus-zoom, and panning) is pure and fully testable.

import assert from "node:assert";
import { Camera, CAMERA } from "../src/camera.js";

// A landscape world and a portrait viewport, so the two axes differ and the
// letterboxing is non-trivial (height limits the fit, width gets the margin).
const W = 1200;
const H = 800;
const VW = 600; // viewport
const VH = 600;

function approx(a, b, eps = 1e-9, msg = "") {
  assert.ok(Math.abs(a - b) <= eps, `${msg} (${a} vs ${b})`);
}

// --- At zoom 1 with a null centre, the camera reproduces the old fit exactly. ---
{
  const cam = new Camera();
  const t = cam.view(W, H, VW, VH);
  // The renderer's pre-camera transform, recomputed here independently.
  const fit = Math.min(VW / W, VH / H);
  const expOffX = (VW - W * fit) / 2;
  const expOffY = (VH - H * fit) / 2;
  approx(t.scale, fit, 1e-9, "scale is the fit scale");
  approx(t.offsetX, expOffX, 1e-9, "offsetX matches the old letterbox");
  approx(t.offsetY, expOffY, 1e-9, "offsetY matches the old letterbox");
  // The limiting axis (height here, since VW/W < VH/H is false... check) fills
  // the view; here VW/W = 0.5, VH/H = 0.75, so width limits → fit = 0.5, and the
  // world height (800*0.5=400) is letterboxed inside 600 with a 100px margin.
  approx(fit, 0.5, 1e-12, "width is the limiting axis");
  approx(t.offsetX, 0, 1e-9, "no horizontal letterbox on the limiting axis");
  approx(t.offsetY, 100, 1e-9, "vertical letterbox margin centred");
}

// --- A world point maps through the transform and back consistently. ---
{
  const cam = new Camera();
  const t = cam.view(W, H, VW, VH);
  const screenX = t.offsetX + 300 * t.scale;
  const back = (screenX - t.offsetX) / t.scale;
  approx(back, 300, 1e-9, "world→screen→world round-trips");
}

// --- Zoom clamps to [minZoom, maxZoom]. ---
{
  const cam = new Camera();
  cam.zoom = 0.2; // below the floor
  cam.view(W, H, VW, VH);
  approx(cam.zoom, CAMERA.minZoom, 1e-12, "zoom floored at minZoom");
  cam.zoom = 999; // above the ceiling
  cam.view(W, H, VW, VH);
  approx(cam.zoom, CAMERA.maxZoom, 1e-12, "zoom capped at maxZoom");
}

// --- When zoomed in, the centre is clamped so the view stays within the world. ---
{
  const cam = new Camera();
  cam.zoom = 4;
  // Try to look far past the right/bottom edges.
  cam.cx = W * 10;
  cam.cy = H * 10;
  cam.view(W, H, VW, VH);
  const fit = Math.min(VW / W, VH / H);
  const scale = fit * 4;
  const halfX = VW / 2 / scale;
  const halfY = VH / 2 / scale;
  approx(cam.cx, W - halfX, 1e-9, "centre clamped to the right edge");
  approx(cam.cy, H - halfY, 1e-9, "centre clamped to the bottom edge");
  // And past the near edges.
  cam.cx = -100;
  cam.cy = -100;
  cam.view(W, H, VW, VH);
  approx(cam.cx, halfX, 1e-9, "centre clamped to the left edge");
  approx(cam.cy, halfY, 1e-9, "centre clamped to the top edge");
}

// --- On a letterboxed axis at zoom 1 the centre is pinned to the world centre. ---
{
  const cam = new Camera();
  cam.zoom = 1;
  cam.cy = 0; // try to shove it off-centre on the margin (height) axis
  cam.view(W, H, VW, VH);
  approx(cam.cy, H / 2, 1e-9, "letterboxed axis pinned centred");
  // The limiting (width) axis at zoom 1 also can't pan — it exactly fills.
  cam.cx = 0;
  cam.view(W, H, VW, VH);
  approx(cam.cx, W / 2, 1e-9, "limiting axis at zoom 1 pinned centred");
}

// --- zoomAt keeps the world point under the focus pixel fixed. ---
// Pick a focus near the viewport centre so the centre-clamping (which legitimately
// overrides the pin when zooming against an edge) doesn't interfere.
{
  const cam = new Camera();
  const sx = 320;
  const sy = 300; // a slightly off-centre focus pixel, away from the edges
  const before = cam.view(W, H, VW, VH);
  const wxBefore = (sx - before.offsetX) / before.scale;
  const wyBefore = (sy - before.offsetY) / before.scale;
  const after = cam.zoomAt(2, sx, sy, W, H, VW, VH);
  approx(cam.zoom, 2, 1e-12, "zoom doubled");
  // The same focus pixel must still resolve to the same world point.
  const wxAfter = (sx - after.offsetX) / after.scale;
  const wyAfter = (sy - after.offsetY) / after.scale;
  approx(wxAfter, wxBefore, 1e-7, "focus world-x pinned under the cursor");
  approx(wyAfter, wyBefore, 1e-7, "focus world-y pinned under the cursor");
}

// --- A focus-zoom against the zoom rail leaves zoom clamped (no overshoot). ---
{
  const cam = new Camera();
  cam.zoom = CAMERA.maxZoom;
  cam.view(W, H, VW, VH);
  cam.zoomAt(4, 300, 300, W, H, VW, VH);
  approx(cam.zoom, CAMERA.maxZoom, 1e-12, "focus-zoom past the ceiling stays capped");
}

// --- panByWorld shifts the centre and re-clamps. ---
{
  const cam = new Camera();
  cam.zoom = 4;
  cam.cx = W / 2;
  cam.cy = H / 2;
  cam.view(W, H, VW, VH);
  cam.panByWorld(50, -30, W, H, VW, VH);
  approx(cam.cx, W / 2 + 50, 1e-9, "centre moved right by the world delta");
  approx(cam.cy, H / 2 - 30, 1e-9, "centre moved up by the world delta");
}

// --- panByScreen drags the grabbed point with the pointer (content follows). ---
{
  const cam = new Camera();
  cam.zoom = 4;
  cam.cx = W / 2;
  cam.cy = H / 2;
  const t = cam.view(W, H, VW, VH);
  // The world point currently at screen pixel (sx, sy)...
  const sx = 300;
  const sy = 300;
  const wx = (sx - t.offsetX) / t.scale;
  const wy = (sy - t.offsetY) / t.scale;
  // ...should sit at (sx + dx, sy + dy) after dragging the content by (dx, dy).
  const dx = 40;
  const dy = -25;
  const t2 = cam.panByScreen(dx, dy, W, H, VW, VH);
  const nowSx = t2.offsetX + wx * t2.scale;
  const nowSy = t2.offsetY + wy * t2.scale;
  approx(nowSx, sx + dx, 1e-7, "grabbed point followed the drag in x");
  approx(nowSy, sy + dy, 1e-7, "grabbed point followed the drag in y");
}

// --- reset returns to the default fit. ---
{
  const cam = new Camera();
  cam.zoom = 6;
  cam.cx = 10;
  cam.cy = 20;
  cam.reset();
  assert.equal(cam.zoom, 1, "zoom reset to 1");
  assert.equal(cam.cx, null, "centre reset to null (world centre)");
  assert.equal(cam.cy, null, "centre reset to null (world centre)");
  const t = cam.view(W, H, VW, VH);
  const fit = Math.min(VW / W, VH / H);
  approx(t.scale, fit, 1e-9, "reset view is the fit scale again");
}

console.log("CAMERA TEST PASSED");
