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
  }

  reset() {
    this.zoom = 1;
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

  // Zoom by `factor` while keeping the world point under the screen position
  // (sx, sy) pinned there — the natural "zoom toward the cursor / pinch focus"
  // behaviour. Clamps zoom first, so a focus zoom against the rails just stops
  // rather than drifting the centre.
  zoomAt(factor, sx, sy, worldW, worldH, viewW, viewH) {
    const before = this.view(worldW, worldH, viewW, viewH);
    const wx = (sx - before.offsetX) / before.scale;
    const wy = (sy - before.offsetY) / before.scale;
    this.zoom = clamp(this.zoom * factor, CAMERA.minZoom, CAMERA.maxZoom);
    const scale = this.fitScale(worldW, worldH, viewW, viewH) * this.zoom;
    // Place the centre so (wx, wy) maps back onto (sx, sy) at the new scale.
    this.cx = wx + (viewW / 2 - sx) / scale;
    this.cy = wy + (viewH / 2 - sy) / scale;
    return this.view(worldW, worldH, viewW, viewH); // re-clamp the centre
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
  constructor({ canvas, camera, renderer, getWorld }) {
    this.canvas = canvas;
    this.camera = camera;
    this.renderer = renderer; // for the live viewport size
    this.getWorld = getWorld; // world is swapped on reset / load, so read it live
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
    this.camera.zoomAt(factor, e.clientX, e.clientY, ...this.dims());
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
      }
      this.gesture = { cx, cy, dist };
      return;
    }

    // Single middle/right-button mouse drag: pan by the pointer's movement.
    if (this.panId === e.pointerId) {
      this.camera.panByScreen(e.clientX - this.panX, e.clientY - this.panY, ...this.dims());
      this.panX = e.clientX;
      this.panY = e.clientY;
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
        break;
      case "ArrowRight":
        this.camera.panByWorld(stepX, 0, ...dims);
        break;
      case "ArrowUp":
        this.camera.panByWorld(0, -stepY, ...dims);
        break;
      case "ArrowDown":
        this.camera.panByWorld(0, stepY, ...dims);
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
  // keyboard +/- use (no cursor to focus on).
  zoomCentre(factor) {
    const [worldW, worldH, viewW, viewH] = this.dims();
    this.camera.zoomAt(factor, viewW / 2, viewH / 2, worldW, worldH, viewW, viewH);
  }
}
