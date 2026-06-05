// Inspector path trail: a bounded record of where the selected creature has
// recently been, so its foraging / fleeing behaviour reads *over time* — the
// curve of a chase, the loops of a graze — not just the instantaneous heading
// arrow. Purely a view aid: it holds no simulation state, draws no rng, and is
// never serialized; `main.js` feeds it the live selection's position each frame
// and clears it whenever the selection changes.

import { wrapDelta } from "./math.js";

export class Trail {
  // `maxPoints` caps the ring so a long-lived selection stays bounded;
  // `minDist` is the smallest toroidal step that earns a new point, so a
  // stationary or slow creature doesn't pile a thousand coincident points and
  // the trail measures real ground covered (making its length the same span of
  // *distance* regardless of playback speed or frame rate).
  constructor(maxPoints, minDist) {
    this.maxPoints = maxPoints;
    this.minDistSq = minDist * minDist;
    // Oldest first, newest last — so drawing can fade by index (tail faint,
    // head bright) and the cap drops from the front.
    this.points = [];
  }

  // Forget the whole track (called when the inspector switches creatures or the
  // world is swapped, so a new selection never inherits the old one's path).
  clear() {
    this.points.length = 0;
  }

  // Note the selected creature's current position. Skips a point that hasn't
  // moved at least `minDist` from the last one (measured on the torus, so a step
  // across the seam counts as the short hop it really is), then evicts the
  // oldest if the ring is full.
  record(x, y, width, height) {
    const pts = this.points;
    if (pts.length) {
      const last = pts[pts.length - 1];
      const dx = wrapDelta(x - last.x, width);
      const dy = wrapDelta(y - last.y, height);
      if (dx * dx + dy * dy < this.minDistSq) return;
    }
    pts.push({ x, y });
    if (pts.length > this.maxPoints) pts.shift();
  }
}

// Split a wrapped path into drawable polylines. Two consecutive recorded points
// that sit on opposite sides of the world (their raw gap exceeding half the
// world on either axis) are really a short hop *across the toroidal seam*, not a
// long line straight across the middle of the view — so the segment between them
// is broken, starting a fresh polyline rather than streaking a false line over
// the whole map. Pure (no canvas, no state), so the seam logic is unit-tested.
export function trailSegments(points, width, height) {
  const segments = [];
  let current = [];
  const halfW = width / 2;
  const halfH = height / 2;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (current.length) {
      const prev = current[current.length - 1];
      // A jump larger than half the world on either axis crossed the seam.
      if (Math.abs(p.x - prev.x) > halfW || Math.abs(p.y - prev.y) > halfH) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
    }
    current.push(p);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}
