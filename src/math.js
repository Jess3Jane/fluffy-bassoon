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

// Squared toroidal distance between two points — cheaper than the real
// distance and fine for comparisons.
export function wrapDistSq(ax, ay, bx, by, width, height) {
  const dx = wrapDelta(bx - ax, width);
  const dy = wrapDelta(by - ay, height);
  return dx * dx + dy * dy;
}
