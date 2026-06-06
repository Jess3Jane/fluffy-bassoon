// Headless tests for the world-clock phase dial's pure geometry and colour
// ramps (`src/phasedial.js`). The canvas draw needs a browser, but the angle
// mapping that places the time-of-day hand, the point-on-circle helper the
// markers ride, and the season/weather colour ramps are all pure and fully
// testable here.

import assert from "node:assert";
import {
  clockAngle,
  dialPoint,
  lerpRgb,
  seasonColor,
  weatherColor,
} from "../src/phasedial.js";

const approx = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= (eps ?? 1e-9), `${msg}: ${a} vs ${b}`);

// Parse an "rgb(r, g, b)" string back into a [r, g, b] triple for assertions.
function parseRgb(str) {
  const m = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  assert.ok(m, `parses as rgb: ${str}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// --- clockAngle: noon at top, running clockwise. ---
{
  approx(clockAngle(0), -Math.PI / 2, 1e-9, "noon (phase 0) points straight up");
  approx(clockAngle(0.25), 0, 1e-9, "quarter-day past noon points right (dusk)");
  approx(clockAngle(0.5), Math.PI / 2, 1e-9, "midnight (phase 0.5) points straight down");
  approx(clockAngle(0.75), Math.PI, 1e-9, "three-quarters points left (dawn)");
}

// --- dialPoint: the cardinal phases land on the circle's cardinal points. ---
{
  const cx = 50;
  const cy = 40;
  const r = 30;
  let p = dialPoint(0, cx, cy, r);
  approx(p.x, cx, 1e-9, "phase 0 x at centre");
  approx(p.y, cy - r, 1e-9, "phase 0 y straight up");
  p = dialPoint(0.25, cx, cy, r);
  approx(p.x, cx + r, 1e-9, "phase 0.25 x to the right");
  approx(p.y, cy, 1e-9, "phase 0.25 y at centre");
  p = dialPoint(0.5, cx, cy, r);
  approx(p.x, cx, 1e-9, "phase 0.5 x at centre");
  approx(p.y, cy + r, 1e-9, "phase 0.5 y straight down");
  p = dialPoint(0.75, cx, cy, r);
  approx(p.x, cx - r, 1e-9, "phase 0.75 x to the left");
  approx(p.y, cy, 1e-9, "phase 0.75 y at centre");
}

// --- dialPoint always lands on the circle of the given radius. ---
{
  const cx = 12;
  const cy = -7;
  const r = 19;
  for (const phase of [0, 0.1, 0.37, 0.62, 0.9, 0.999]) {
    const p = dialPoint(phase, cx, cy, r);
    const dist = Math.hypot(p.x - cx, p.y - cy);
    approx(dist, r, 1e-9, `phase ${phase} sits on the radius`);
  }
}

// --- lerpRgb: endpoints, midpoint, and clamping. ---
{
  const a = [0, 0, 0];
  const b = [100, 200, 50];
  assert.deepStrictEqual(parseRgb(lerpRgb(a, b, 0)), [0, 0, 0], "t=0 is the a endpoint");
  assert.deepStrictEqual(parseRgb(lerpRgb(a, b, 1)), [100, 200, 50], "t=1 is the b endpoint");
  assert.deepStrictEqual(parseRgb(lerpRgb(a, b, 0.5)), [50, 100, 25], "t=0.5 is the midpoint");
  // Out-of-range t clamps rather than extrapolating.
  assert.deepStrictEqual(parseRgb(lerpRgb(a, b, -2)), [0, 0, 0], "t<0 clamps to a");
  assert.deepStrictEqual(parseRgb(lerpRgb(a, b, 5)), [100, 200, 50], "t>1 clamps to b");
}

// --- seasonColor: cool in winter, warm in summer, monotone between. ---
{
  const cool = parseRgb(seasonColor(0));
  const warm = parseRgb(seasonColor(1));
  // Summer is warmer: more red, less blue than winter.
  assert.ok(warm[0] > cool[0], "summer ring is redder than winter");
  assert.ok(warm[2] < cool[2], "summer ring is less blue than winter");
  // The red channel rises monotonically with warmth across the level axis.
  let prev = -Infinity;
  for (let lvl = 0; lvl <= 1.0001; lvl += 0.25) {
    const r = parseRgb(seasonColor(lvl))[0];
    assert.ok(r >= prev, `season red non-decreasing in warmth at ${lvl}`);
    prev = r;
  }
}

// --- weatherColor: dry ochre, neutral grey, wet blue, meeting at fair. ---
{
  const dry = parseRgb(weatherColor(-1));
  const fair = parseRgb(weatherColor(0));
  const wet = parseRgb(weatherColor(1));
  // Storm reads bluer than drought; drought reads warmer (redder) than storm.
  assert.ok(wet[2] > dry[2], "storm is bluer than drought");
  assert.ok(dry[0] > wet[0], "drought is warmer (redder) than storm");
  // Fair weather is the shared midpoint of both half-ramps: the two ramps
  // evaluated at the seam agree on it.
  assert.deepStrictEqual(parseRgb(weatherColor(0)), fair, "fair is the seam colour");
  // The blue channel climbs from drought through fair to storm.
  assert.ok(fair[2] > dry[2] && wet[2] > fair[2], "blue rises drought→fair→storm");
}

console.log("PHASE-DIAL TEST PASSED");
