// Shared math helpers for the toroidal world.

// On a wrapped (toroidal) axis of the given size, return the signed shortest
// delta for a raw difference `d`. This makes "nearest" and "steer toward"
// behave correctly across the world's edges.
export function wrapDelta(d, size) {
  const half = size / 2;
  if (d > half) return d - size;
  if (d < -half) return d + size;
  return d;
}

// Clamp a value onto the unit interval [0, 1]. Handy for folding an offset
// climate (a global level plus a spatial microclimate nudge) back onto the same
// [0, 1] axis the preference genes live on.
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Squared toroidal distance between two points — cheaper than the real
// distance and fine for comparisons.
export function wrapDistSq(ax, ay, bx, by, width, height) {
  const dx = wrapDelta(bx - ax, width);
  const dy = wrapDelta(by - ay, height);
  return dx * dx + dy * dy;
}
