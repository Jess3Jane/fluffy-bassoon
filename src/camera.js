// A pan/zoom camera over the toroidal world. The simulation is untouched — this
// is purely a *view* transform layered on top of the "fit the whole world into
// the viewport" base mapping the renderer started with. At zoom 1 with the
// default (null) centre it reproduces that original letterboxed fit exactly;
// zooming in and panning lets a large world be explored up close — so following
// one creature via the inspector highlight finally means being able to get near
// it. It holds no simulation state and adds nothing to the save.

export const CAMERA = {
  minZoom: 1, // 1 = the whole world fits (the original view); never zoom out past it
  maxZoom: 12, // how far in you can push
  // Wheel zoom: a factor per unit of `deltaY`, compounded by the scroll amount.
  // Just over 1 so a normal notch is a gentle step; raised to −deltaY so
  // scrolling up (negative delta) zooms in.
  wheelStep: 1.0015,
  keyZoomStep: 1.2, // zoom factor per +/- keypress
  keyPanFrac: 0.18, // arrow-key pan, as a fraction of the visible span
  // When "follow selected" is switched on from the fully zoomed-out view, push in
  // to this zoom so the tracked creature is actually large enough to watch (at
  // zoom 1 the whole world fits and centring on one creature is a no-op).
  followZoom: 5,
  // Smooth-zoom easing: rather than snapping zoom to its new value, the actual
  // zoom eases toward a *target* each frame, so wheel notches and +/- presses
  // glide instead of jumping. `zoomEase` is the exponential rate per second (a
  // frame-rate-independent 1 − e^(−rate·dt) blend, ~70ms time constant), and a
  // zoom within `zoomSnap` (a fraction) of the target lands exactly to stop the
  // animation cleanly.
  zoomEase: 14,
  zoomSnap: 0.004,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Clamp a centre coordinate so the visible window stays within [0, worldD]. When
// the world is smaller than the view on this axis (zoomed out / the letterboxed
// axis), it can't fill the view, so it's pinned centred — exactly reproducing the
// old letterboxing.
function clampCentre(c, worldD, viewD, scale) {
  const half = viewD / 2 / scale; // half the visible span, in world units
  if (half >= worldD / 2) return worldD / 2;
  return c < half ? half : c > worldD - half ? worldD - half : c;
}

export class Camera {
  constructor() {
    this.zoom = 1;
    // World-space point shown at the viewport centre. null means "world centre",
    // resolved lazily so the camera needs no world dimensions to construct.
    this.cx = null;
    this.cy = null;
    // Smooth-zoom state: the zoom the camera is easing *toward*, and the screen
    // pixel to keep pinned while it eases (the cursor for a wheel zoom, the
    // viewport centre for a button/key zoom). `zoom` follows `zoomTarget` a step
    // per `tickZoom`; an immediate `zoomAt` keeps them in lock-step.
    this.zoomTarget = 1;
    this.zoomFocusX = 0;
    this.zoomFocusY = 0;
  }

  reset() {
    this.zoom = 1;
    this.zoomTarget = 1;
    this.cx = null;
    this.cy = null;
  }

  // The base pixels-per-world-unit that fits the whole world into the viewport
  // along its limiting axis, preserving aspect ratio — the scale the renderer
  // used before the camera existed.
  fitScale(worldW, worldH, viewW, viewH) {
    return Math.min(viewW / worldW, viewH / worldH);
  }

  // Clamp zoom and centre against the world and viewport, then return the
  // renderer's transform triple { scale, offsetX, offsetY } such that
  //   screenX = offsetX + worldX * scale   (and likewise for y).
  // Writes the clamped zoom/centre back, so repeated panning/zooming stays in
  // bounds. At zoom 1 with a null centre this is byte-for-byte the old fit.
  view(worldW, worldH, viewW, viewH) {
    this.zoom = clamp(this.zoom, CAMERA.minZoom, CAMERA.maxZoom);
    const scale = this.fitScale(worldW, worldH, viewW, viewH) * this.zoom;
    if (this.cx == null) this.cx = worldW / 2;
    if (this.cy == null) this.cy = worldH / 2;
    this.cx = clampCentre(this.cx, worldW, viewW, scale);
    this.cy = clampCentre(this.cy, worldH, viewH, scale);
    return {
      scale,
      offsetX: viewW / 2 - this.cx * scale,
      offsetY: viewH / 2 - this.cy * scale,
    };
  }

  // Set the zoom to an absolute level (clamped) while keeping the world point
  // under the screen pixel (sx, sy) pinned there — the shared core of both the
  // immediate `zoomAt` and the eased `tickZoom`. Clamps zoom first, so a zoom
  // against the rails just stops rather than drifting the centre.
  _zoomToward(targetZoom, sx, sy, worldW, worldH, viewW, viewH) {
    const before = this.view(worldW, worldH, viewW, viewH);
    const wx = (sx - before.offsetX) / before.scale;
    const wy = (sy - before.offsetY) / before.scale;
    this.zoom = clamp(targetZoom, CAMERA.minZoom, CAMERA.maxZoom);
    const scale = this.fitScale(worldW, worldH, viewW, viewH) * this.zoom;
    // Place the centre so (wx, wy) maps back onto (sx, sy) at the new scale.
    this.cx = wx + (viewW / 2 - sx) / scale;
    this.cy = wy + (viewH / 2 - sy) / scale;
    return this.view(worldW, worldH, viewW, viewH); // re-clamp the centre
  }

  // Zoom by `factor` *immediately* while keeping the world point under (sx, sy)
  // pinned — the natural "zoom toward the cursor / pinch focus" behaviour, used
  // for direct-manipulation pinch where 1:1 response beats easing. Snaps the
  // ease target to the result, so a later `tickZoom` doesn't drag the zoom back.
  zoomAt(factor, sx, sy, worldW, worldH, viewW, viewH) {
    const v = this._zoomToward(this.zoom * factor, sx, sy, worldW, worldH, viewW, viewH);
    this.zoomTarget = this.zoom;
    return v;
  }

  // Request an eased zoom by `factor` about the screen pixel (sx, sy): it only
  // moves the *target* (so repeated wheel notches compound into one smooth
  // glide) and records the focus pixel; `tickZoom` walks the live zoom toward it.
  requestZoom(factor, sx, sy) {
    this.zoom = clamp(this.zoom, CAMERA.minZoom, CAMERA.maxZoom);
    const base = this.zoomTarget ?? this.zoom;
    this.zoomTarget = clamp(base * factor, CAMERA.minZoom, CAMERA.maxZoom);
    this.zoomFocusX = sx;
    this.zoomFocusY = sy;
  }

  // Advance the eased zoom one frame toward `zoomTarget`, keeping the recorded
  // focus pixel pinned. A frame-rate-independent exponential blend; within
  // `zoomSnap` of the target it lands exactly and then leaves the centre alone
  // (so a per-frame `centerOn` from follow mode keeps the last word on it).
  tickZoom(dt, worldW, worldH, viewW, viewH) {
    if (this.zoomTarget == null) this.zoomTarget = this.zoom;
    const ratio = this.zoomTarget / this.zoom;
    if (Math.abs(ratio - 1) < CAMERA.zoomSnap) {
      if (this.zoom !== this.zoomTarget) {
        return this._zoomToward(
          this.zoomTarget,
          this.zoomFocusX,
          this.zoomFocusY,
          worldW,
          worldH,
          viewW,
          viewH,
        );
      }
      return this.view(worldW, worldH, viewW, viewH);
    }
    const t = 1 - Math.exp(-CAMERA.zoomEase * dt);
    // Ease geometrically (in log-zoom), so the perceived rate is even across the
    // whole zoom range rather than crawling near the floor and racing near the cap.
    const next = this.zoom * Math.pow(ratio, t);
    return this._zoomToward(next, this.zoomFocusX, this.zoomFocusY, worldW, worldH, viewW, viewH);
  }

  // Centre the view on a world point (the inspected creature, for "follow"),
  // leaving the zoom untouched. `view` re-clamps, so following a creature toward
  // a world edge slides the centre only as far as the edge allows and following
  // at zoom 1 stays pinned to the world centre — exactly the panning rules. The
  // creature's position is its canonical (un-wrapped) coordinate, so a creature
  // crossing the toroidal seam jumps the centre once; tracked per frame at the
  // creature's slow pace, that's the only discontinuity and it's rare.
  centerOn(wx, wy, worldW, worldH, viewW, viewH) {
    this.cx = wx;
    this.cy = wy;
    return this.view(worldW, worldH, viewW, viewH);
  }

  // Pan the camera by a world-space delta (the primitive the others build on).
  panByWorld(dwx, dwy, worldW, worldH, viewW, viewH) {
    if (this.cx == null) this.cx = worldW / 2;
    if (this.cy == null) this.cy = worldH / 2;
    this.cx += dwx;
    this.cy += dwy;
    return this.view(worldW, worldH, viewW, viewH);
  }

  // Pan by a *screen*-pixel delta (a drag), keeping the grabbed point under the
  // pointer: dragging the content right (positive dx) shifts the view so the same
  // world point follows the cursor. Converts to world units at the current scale.
  panByScreen(dxScreen, dyScreen, worldW, worldH, viewW, viewH) {
    const scale =
      this.fitScale(worldW, worldH, viewW, viewH) *
      clamp(this.zoom, CAMERA.minZoom, CAMERA.maxZoom);
    return this.panByWorld(
      -dxScreen / scale,
      -dyScreen / scale,
      worldW,
      worldH,
      viewW,
      viewH,
    );
  }
}

// Owns the canvas pointer/wheel/keyboard interaction that drives the camera. It
// listens on the same canvas as the editing tools, but stays out of their way:
// the editing brushes own a single primary-button (left / one-finger) stroke,
// while the camera claims everything else — the wheel, middle/right-drag pans,
// two-finger pinch-and-pan, the arrow keys, and the on-screen buttons. The tool
// controller independently abandons its stroke the moment a second pointer
// appears, so the two never fight over a gesture.
export class CameraController {
  constructor({ canvas, camera, renderer, getWorld, onUserPan }) {
    this.canvas = canvas;
    this.camera = camera;
    this.renderer = renderer; // for the live viewport size
    this.getWorld = getWorld; // world is swapped on reset / load, so read it live
    // Called when the viewer actively pans (drag / pinch / arrows). "Follow
    // selected" uses it to step aside the instant the viewer grabs the view, so
    // manual panning always wins rather than fighting the per-frame re-centring.
    // Zoom is deliberately *not* a user-pan: zooming while following keeps
    // tracking the creature, just closer or further out.
    this.onUserPan = onUserPan ?? null;
    // Active pointers by id → {x, y}, so a two-finger pinch/pan can be tracked.
    this.pointers = new Map();
    // Previous two-finger gesture frame {cx, cy, dist}, or null between gestures.
    this.gesture = null;
    // The pointer id currently driving a middle/right-button mouse pan, or null.
    this.panId = null;
    this.panX = 0;
    this.panY = 0;

    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  dims() {
    const world = this.getWorld();
    return [world.width, world.height, this.renderer.viewW, this.renderer.viewH];
  }

  onWheel(e) {
    e.preventDefault();
    const factor = Math.pow(CAMERA.wheelStep, -e.deltaY);
    // Eased: accumulate notches into the zoom target; `tickZoom` glides to it.
    this.camera.requestZoom(factor, e.clientX, e.clientY);
  }

  // Advance the smooth zoom one frame — called from the main loop with the real
  // elapsed seconds, so wheel/button/key zooms glide rather than snap.
  tickZoom(dt) {
    this.camera.tickZoom(dt, ...this.dims());
  }

  onDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) this.gesture = null; // start a fresh pinch frame
    // A middle- or right-button mouse press starts a drag-pan (left is the tools').
    if (e.pointerType === "mouse" && (e.button === 1 || e.button === 2)) {
      e.preventDefault();
      this.panId = e.pointerId;
      this.panX = e.clientX;
      this.panY = e.clientY;
      this.canvas.setPointerCapture?.(e.pointerId);
    }
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }

    // Two (or more) fingers: pinch to zoom about the centroid and pan with it.
    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      if (this.gesture) {
        const dims = this.dims();
        // Pan by how far the centroid moved, then zoom about it by the spread
        // ratio (which re-pins the centroid, so the two compose cleanly).
        this.camera.panByScreen(cx - this.gesture.cx, cy - this.gesture.cy, ...dims);
        this.camera.zoomAt(dist / this.gesture.dist, cx, cy, ...dims);
        this.onUserPan?.();
      }
      this.gesture = { cx, cy, dist };
      return;
    }

    // Single middle/right-button mouse drag: pan by the pointer's movement.
    if (this.panId === e.pointerId) {
      this.camera.panByScreen(e.clientX - this.panX, e.clientY - this.panY, ...this.dims());
      this.panX = e.clientX;
      this.panY = e.clientY;
      this.onUserPan?.();
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    if (this.panId === e.pointerId) {
      this.panId = null;
      this.canvas.releasePointerCapture?.(e.pointerId);
    }
  }

  onKey(e) {
    // Don't hijack typing in a form control (e.g. the speed slider).
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const dims = this.dims();
    const [worldW, worldH, viewW, viewH] = dims;
    const scale = this.camera.fitScale(worldW, worldH, viewW, viewH) * this.camera.zoom;
    const stepX = (CAMERA.keyPanFrac * viewW) / scale;
    const stepY = (CAMERA.keyPanFrac * viewH) / scale;
    switch (e.key) {
      case "ArrowLeft":
        this.camera.panByWorld(-stepX, 0, ...dims);
        this.onUserPan?.();
        break;
      case "ArrowRight":
        this.camera.panByWorld(stepX, 0, ...dims);
        this.onUserPan?.();
        break;
      case "ArrowUp":
        this.camera.panByWorld(0, -stepY, ...dims);
        this.onUserPan?.();
        break;
      case "ArrowDown":
        this.camera.panByWorld(0, stepY, ...dims);
        this.onUserPan?.();
        break;
      case "+":
      case "=":
        this.zoomCentre(CAMERA.keyZoomStep);
        break;
      case "-":
      case "_":
        this.zoomCentre(1 / CAMERA.keyZoomStep);
        break;
      default:
        return; // leave other keys (Esc, etc.) alone
    }
    e.preventDefault();
  }

  // Zoom about the viewport centre — what the on-screen +/- buttons and the
  // keyboard +/- use (no cursor to focus on). Eased, like the wheel.
  zoomCentre(factor) {
    const [, , viewW, viewH] = this.dims();
    this.camera.requestZoom(factor, viewW / 2, viewH / 2);
  }

  // Centre the live world dimensions on (wx, wy) — the per-frame call that keeps
  // a followed creature in the middle of the view.
  centerOn(wx, wy) {
    this.camera.centerOn(wx, wy, ...this.dims());
  }

  // Switching follow on from the fully zoomed-out view would centre on the
  // creature but show it as a speck, so push in to the follow zoom first; if the
  // viewer has already zoomed in, leave their zoom alone.
  ensureFollowZoom() {
    if (this.camera.zoom <= CAMERA.minZoom + 1e-6) {
      this.zoomCentre(CAMERA.followZoom / this.camera.zoom);
    }
  }
}
