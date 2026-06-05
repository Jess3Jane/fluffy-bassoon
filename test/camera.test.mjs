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

// --- centerOn places the followed point at the viewport centre (zoomed in). ---
{
  const cam = new Camera();
  cam.zoom = 4;
  const t = cam.centerOn(500, 350, W, H, VW, VH);
  // The chosen point is comfortably interior, so it isn't edge-clamped and ends
  // up exactly at the centre pixel.
  approx(cam.cx, 500, 1e-9, "centre x set to the followed point");
  approx(cam.cy, 350, 1e-9, "centre y set to the followed point");
  const sx = t.offsetX + 500 * t.scale;
  const sy = t.offsetY + 350 * t.scale;
  approx(sx, VW / 2, 1e-7, "followed point sits at the viewport centre x");
  approx(sy, VH / 2, 1e-7, "followed point sits at the viewport centre y");
  approx(cam.zoom, 4, 1e-12, "centerOn leaves the zoom untouched");
}

// --- centerOn re-clamps so following past an edge stops at the edge. ---
{
  const cam = new Camera();
  cam.zoom = 4;
  cam.centerOn(W + 1000, H + 1000, W, H, VW, VH); // a creature off the far corner
  const fit = Math.min(VW / W, VH / H);
  const scale = fit * 4;
  approx(cam.cx, W - VW / 2 / scale, 1e-9, "follow clamped at the right edge");
  approx(cam.cy, H - VH / 2 / scale, 1e-9, "follow clamped at the bottom edge");
}

// --- centerOn at zoom 1 stays pinned to the world centre (nothing to follow). ---
{
  const cam = new Camera();
  cam.zoom = 1;
  cam.centerOn(100, 100, W, H, VW, VH);
  approx(cam.cx, W / 2, 1e-9, "zoom-1 follow pinned to world centre x");
  approx(cam.cy, H / 2, 1e-9, "zoom-1 follow pinned to world centre y");
}

// --- requestZoom only moves the target; the live zoom doesn't jump. ---
{
  const cam = new Camera();
  cam.view(W, H, VW, VH);
  cam.requestZoom(3, 320, 300);
  approx(cam.zoom, 1, 1e-12, "live zoom is unchanged by a request");
  approx(cam.zoomTarget, 3, 1e-12, "the target is the requested zoom");
  // A second notch compounds into the same target rather than snapping the view.
  cam.requestZoom(2, 320, 300);
  approx(cam.zoom, 1, 1e-12, "live zoom still unchanged after a second request");
  approx(cam.zoomTarget, 6, 1e-12, "notches compound into the target");
}

// --- tickZoom eases the live zoom monotonically onto the target, landing exactly. ---
{
  const cam = new Camera();
  cam.view(W, H, VW, VH);
  cam.requestZoom(4, 320, 300); // target 4×
  const dt = 1 / 60;
  let prev = cam.zoom;
  let crossedHalf = false;
  for (let i = 0; i < 5; i++) {
    cam.tickZoom(dt, W, H, VW, VH);
    assert.ok(cam.zoom > prev, "zoom eases upward each frame");
    assert.ok(cam.zoom <= cam.zoomTarget + 1e-9, "never overshoots the target");
    if (cam.zoom > 2) crossedHalf = true;
    prev = cam.zoom;
  }
  assert.ok(crossedHalf, "covers real ground within a few frames");
  // Run it out: it converges and lands exactly on the target (no perpetual crawl).
  for (let i = 0; i < 200; i++) cam.tickZoom(dt, W, H, VW, VH);
  approx(cam.zoom, 4, 1e-9, "eased zoom settles exactly on the target");
  // Once settled, ticking is a no-op (and doesn't disturb the centre).
  const cxBefore = cam.cx;
  cam.tickZoom(dt, W, H, VW, VH);
  approx(cam.zoom, 4, 1e-12, "a settled tick holds the zoom");
  approx(cam.cx, cxBefore, 1e-12, "a settled tick leaves the centre alone");
}

// --- The focus pixel's world point stays pinned across the whole eased glide. ---
{
  const cam = new Camera();
  const sx = 320;
  const sy = 300; // interior focus, away from the clamping edges
  const before = cam.view(W, H, VW, VH);
  const wxBefore = (sx - before.offsetX) / before.scale;
  const wyBefore = (sy - before.offsetY) / before.scale;
  cam.requestZoom(3, sx, sy);
  const dt = 1 / 60;
  for (let i = 0; i < 200; i++) {
    const t = cam.tickZoom(dt, W, H, VW, VH);
    const wx = (sx - t.offsetX) / t.scale;
    const wy = (sy - t.offsetY) / t.scale;
    approx(wx, wxBefore, 1e-6, "focus world-x pinned through the glide");
    approx(wy, wyBefore, 1e-6, "focus world-y pinned through the glide");
  }
}

// --- An eased request clamps at the zoom ceiling. ---
{
  const cam = new Camera();
  cam.view(W, H, VW, VH);
  cam.requestZoom(1000, 320, 300);
  approx(cam.zoomTarget, CAMERA.maxZoom, 1e-12, "request target capped at maxZoom");
  for (let i = 0; i < 300; i++) cam.tickZoom(1 / 60, W, H, VW, VH);
  approx(cam.zoom, CAMERA.maxZoom, 1e-9, "eased zoom lands at the cap, no overshoot");
}

// --- An immediate zoomAt keeps the ease target in lock-step (no drift-back). ---
{
  const cam = new Camera();
  cam.view(W, H, VW, VH);
  cam.zoomAt(2.5, 320, 300, W, H, VW, VH); // a direct pinch zoom
  approx(cam.zoom, 2.5, 1e-12, "immediate zoom applies at once");
  approx(cam.zoomTarget, 2.5, 1e-12, "the ease target snaps to the immediate result");
  // So a following tick doesn't drag the zoom back toward a stale target.
  cam.tickZoom(1 / 60, W, H, VW, VH);
  approx(cam.zoom, 2.5, 1e-12, "a tick after a pinch holds the zoom");
}

// --- reset clears the ease target back to the default. ---
{
  const cam = new Camera();
  cam.requestZoom(8, 320, 300);
  cam.reset();
  approx(cam.zoomTarget, 1, 1e-12, "reset returns the ease target to 1");
  cam.tickZoom(1 / 60, W, H, VW, VH);
  approx(cam.zoom, 1, 1e-12, "a tick after reset stays at the fit");
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
