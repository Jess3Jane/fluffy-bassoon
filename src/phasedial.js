// World-clock phase dial. The HUD already surfaces the day-night, season, and
// weather state as text rows, but the three nested rhythms that drive the whole
// larder's boom and bust are easier to *feel* as a clock than to read off
// numbers. This compact circular widget shows all three at a glance: an inner
// day-night clock face (a bright day arc up top, a dark night arc below) with a
// hand sweeping the current time of day and a sun/moon at its tip; an outer ring
// tinted by the season with a marker riding the slow year; and a weather wash
// plus a wind arrow when a storm stirs one up.
//
// Like the minimap/legend it holds no simulation state and adds nothing to the
// save — purely a view aid reading `world.time`. Everything geometric and the
// colour ramps live here as pure functions so they're unit-testable headlessly;
// the `PhaseDial` view class owns the canvas and the per-frame draw.

import {
  dayPhase,
  daylight,
  phaseLabel,
} from "./daycycle.js";
import {
  seasonPhase,
  seasonLevel,
  seasonLabel,
  weatherNoise,
  weatherLabel,
  windStrength,
  windBearing,
} from "./weather.js";

export const PHASE_DIAL = {
  // The widget is a square canvas this many CSS pixels on a side; it sits in the
  // HUD column under the minimap, so the size is kept modest.
  size: 132,
};

// A phase in [0, 1) → a canvas angle (radians) for a point on the dial. Noon
// (phase 0) sits at the top and time runs clockwise, the way a sun tracks across
// the sky: 0.25 of a day past noon is dusk on the right, midnight (0.5) at the
// bottom, dawn (0.75) on the left. Canvas +y runs down, so an increasing angle
// already reads clockwise on screen; we just rotate so phase 0 lands at −π/2.
export function clockAngle(phase) {
  return phase * 2 * Math.PI - Math.PI / 2;
}

// The point on a circle of radius `r` about (cx, cy) for the given phase, using
// `clockAngle`. Phase 0 → straight up (cx, cy − r), 0.25 → right, 0.5 → down,
// 0.75 → left.
export function dialPoint(phase, cx, cy, r) {
  const a = clockAngle(phase);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// Linear-interpolate between two [r, g, b] triples, returning a CSS `rgb(...)`
// string. `t` is clamped to [0, 1] so callers can pass a raw signal.
export function lerpRgb(a, b, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const ch = (i) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

// Season ring colour from the seasonal warmth level in [0, 1]: a cool slate-blue
// at midwinter (0) warming through to a summer gold-green at midsummer (1), so
// the ring's hue alone names the time of year.
const SEASON_COOL = [78, 116, 168]; // deep winter
const SEASON_WARM = [196, 188, 96]; // high summer
export function seasonColor(level) {
  return lerpRgb(SEASON_COOL, SEASON_WARM, level);
}

// Weather marker colour from the weather signal in [-1, 1]: a dry warm ochre in
// drought (−1), through a neutral grey in fair weather (0), to a rain blue at the
// height of a storm (+1) — the same dry-warm / wet-cool axis the renderer washes
// the scene along.
const WEATHER_DRY = [176, 132, 72]; // drought
const WEATHER_FAIR = [150, 158, 170]; // clear
const WEATHER_WET = [96, 140, 200]; // storm
export function weatherColor(noise) {
  // Two half-ramps meeting at fair weather, so the neutral midpoint reads grey
  // rather than a muddy blend of the two extremes.
  if (noise >= 0) return lerpRgb(WEATHER_FAIR, WEATHER_WET, noise);
  return lerpRgb(WEATHER_FAIR, WEATHER_DRY, -noise);
}

// Owns the dial canvas and its per-frame draw. A separate DOM canvas (like the
// minimap) keeps it clear of the world canvas's pointer controllers; it takes no
// input of its own.
export class PhaseDial {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = 0;
    this.resize();
  }

  // Size the backing canvas once to the configured CSS size (scaled for the
  // device pixel ratio). Idempotent, so a repeat call is a no-op.
  resize() {
    const s = PHASE_DIAL.size;
    if (s === this.size) return;
    this.size = s;
    this.canvas.width = Math.round(s * this.dpr);
    this.canvas.height = Math.round(s * this.dpr);
    this.canvas.style.width = s + "px";
    this.canvas.style.height = s + "px";
  }

  // Draw the dial for the world's current sim-time.
  draw(world) {
    const time = world.time;
    const ctx = this.ctx;
    const s = this.size;
    if (s < 1) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);

    // Reserve the bottom strip for the two caption lines, so the dial sits in the
    // square above it rather than overrunning the canvas.
    const captionH = 26;
    const cx = s / 2;
    const cy = (s - captionH) / 2;
    const outerR = Math.min(cx, cy) - 4; // season ring outer edge
    const ringW = 7; // season ring thickness
    const faceR = outerR - ringW - 3; // day-night clock face radius

    this.drawSeasonRing(cx, cy, outerR, ringW, time);
    this.drawClockFace(cx, cy, faceR, time);
    this.drawWind(cx, cy, faceR, time);
    this.drawHand(cx, cy, faceR, time);
    this.drawCentre(cx, cy, time);
  }

  // The outer season ring: a band tinted by the current warmth, with a small
  // marker notch riding the slow year so the season's drift is visible even
  // though its colour barely moves frame to frame.
  drawSeasonRing(cx, cy, outerR, ringW, time) {
    const ctx = this.ctx;
    const midR = outerR - ringW / 2;
    ctx.lineWidth = ringW;
    ctx.strokeStyle = seasonColor(seasonLevel(time));
    ctx.beginPath();
    ctx.arc(cx, cy, midR, 0, Math.PI * 2);
    ctx.stroke();

    // Marker: a bright tick at the season phase, noon-at-top like the clock, so
    // the ring reads as a second, far slower hand.
    const inner = dialPoint(seasonPhase(time), cx, cy, outerR - ringW);
    const outer = dialPoint(seasonPhase(time), cx, cy, outerR);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
  }

  // The day-night clock face: a vertical gradient with a bright daytime sky up
  // top (where noon sits) fading to night at the bottom (midnight), so the face
  // itself shows which way is day before the hand even moves.
  drawClockFace(cx, cy, faceR, time) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, cy - faceR, 0, cy + faceR);
    g.addColorStop(0, "rgb(86, 132, 178)"); // day sky
    g.addColorStop(0.5, "rgb(40, 58, 86)"); // dawn/dusk band
    g.addColorStop(1, "rgb(10, 14, 32)"); // night
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.stroke();
  }

  // A wind arrow through the centre when a storm actually stirs one up, pointing
  // the way the wind pushes (its bearing) and lengthening with its strength, so
  // the dial shows not just the weather but the gale's direction.
  drawWind(cx, cy, faceR, time) {
    const strength = windStrength(time);
    if (strength <= 0) return;
    const ctx = this.ctx;
    const a = windBearing(time);
    const len = faceR * (0.35 + 0.45 * strength);
    const tx = cx + len * Math.cos(a);
    const ty = cy + len * Math.sin(a);
    ctx.strokeStyle = `rgba(150, 200, 240, ${0.35 + 0.5 * strength})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - len * Math.cos(a) * 0.4, cy - len * Math.sin(a) * 0.4);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    // Arrowhead.
    const head = 4 + 3 * strength;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - head * Math.cos(a - 0.4), ty - head * Math.sin(a - 0.4));
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - head * Math.cos(a + 0.4), ty - head * Math.sin(a + 0.4));
    ctx.stroke();
  }

  // The time-of-day hand: a spoke from the centre out to the current day phase on
  // the face's rim, tipped with a sun by day and a moon by night, so the current
  // hour reads at a glance and the celestial body matches the daylight level.
  drawHand(cx, cy, faceR, time) {
    const ctx = this.ctx;
    const phase = dayPhase(time);
    const tip = dialPoint(phase, cx, cy, faceR - 9);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    const light = daylight(time);
    const bodyR = 6;
    if (light >= 0.5) {
      // Sun: a bright disc with a soft glow, brighter the higher the daylight.
      ctx.fillStyle = `rgba(255, ${Math.round(210 + 30 * light)}, 120, ${0.6 + 0.4 * light})`;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, bodyR, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Moon: a pale disc with a bite taken out (a crescent) by overpainting an
      // offset disc in the face colour.
      ctx.fillStyle = "rgba(226, 232, 244, 0.95)";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, bodyR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgb(16, 22, 44)";
      ctx.beginPath();
      ctx.arc(tip.x + 2.5, tip.y - 1.5, bodyR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The hub: a weather-tinted centre cap, plus the two caption lines anchored to
  // the canvas bottom (so they clear the season ring): the day phase and season
  // names, then the weather, kept terse so the text and the visual read together.
  drawCentre(cx, cy, time) {
    const ctx = this.ctx;
    ctx.fillStyle = weatherColor(weatherNoise(time));
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const s = this.size;
    ctx.fillStyle = "rgba(210, 222, 235, 0.92)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${phaseLabel(time)} · ${seasonLabel(time)}`, cx, s - 14);
    ctx.fillStyle = "rgba(170, 184, 200, 0.85)";
    ctx.fillText(weatherLabel(time), cx, s - 3);
  }
}
