// Tiny sparkline charts for the HUD, drawn straight to a canvas. Four stacked
// panels read out of a History ring: population over time (with the carnivore
// sub-band), the average-trait drift (diet, plus speed/size normalised to their
// gene ranges so they share a 0–1 axis), the speciation count (distinct
// lineage-hue clades alongside the ecological count clustered on the adaptive
// genome), and realised reproductive isolation (the within-lineage share of
// recent sexual matings). Together they
// make the emergent story legible — booms and crashes, the selection pressure
// behind them, clades splitting apart, and breeding actually turning inward as
// they do — without leaving the page.

import { normTrait } from "./history.js";

const PAD = 6; // canvas edge → panel gutter
const GAP = 10; // vertical gap between the two panels
const TITLE_H = 13; // header row above each plot (title + legend)

export class Charts {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  // Match the backing store to the canvas's laid-out CSS size so lines stay
  // crisp on HiDPI displays and we draw in CSS pixels.
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
  }

  draw(history) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const s = history.samples;
    const panelH = (this.h - GAP * 3) / 4;

    // Population & carnivores share an axis: carnivores are a subset of the
    // population, so plotting both against the population peak shows the
    // trophic balance directly.
    const popMax = history.max("population", 10);
    this.panel(0, panelH, "Population", String(popMax), [
      { color: "#6fd3c7", fill: "rgba(111,211,199,0.14)", label: "pop",
        values: s.map((d) => d.population / popMax) },
      { color: "#e2664f", label: "carn",
        values: s.map((d) => d.carnivores / popMax) },
    ]);

    // Average traits, each normalised to its gene range so the herbivore↔
    // carnivore drift (diet) and the body-plan drift (speed/size) coexist on
    // one 0–1 axis.
    this.panel(panelH + GAP, panelH, "Avg traits", "1.0", [
      { color: "#e2664f", label: "diet", values: s.map((d) => d.diet) },
      { color: "#8fb3ff", label: "speed", values: s.map((d) => normTrait("speed", d.speed)) },
      { color: "#d9b25f", label: "size", values: s.map((d) => normTrait("size", d.size)) },
    ]);

    // Species count: distinct lineage-hue clades (neutral/ancestry) plus the
    // ecological count clustered on the adaptive genome. Both share an axis
    // scaled to whichever peaks higher, so an ecological split that outruns the
    // colour drift — the two lines diverging — is visible even though the raw
    // numbers are small.
    const spMax = Math.max(history.max("species", 1), history.max("geneSpecies", 1));
    this.panel(2 * (panelH + GAP), panelH, "Species", String(spMax), [
      { color: "#b48ef0", fill: "rgba(180,142,240,0.14)", label: "hue",
        values: s.map((d) => (d.species || 0) / spMax) },
      { color: "#e0a85f", label: "eco",
        values: s.map((d) => (d.geneSpecies || 0) / spMax) },
    ]);

    // Reproductive isolation: the within-lineage share of recent sexual matings,
    // already a 0–1 quantity so it needs no scaling. It rises toward 1 as breeding
    // turns inward (assortative choice + courtship cost biting) — the behavioural
    // signature of speciation, alongside the structural clade count above. A null
    // (no matings on record yet) plots at the floor via clamp01.
    this.panel(3 * (panelH + GAP), panelH, "Isolation", "1.0", [
      { color: "#5fd98a", fill: "rgba(95,217,138,0.14)", label: "within-lineage",
        values: s.map((d) => (d.isolation == null ? 0 : d.isolation)) },
    ]);
  }

  // Draw one panel: a framed plot with a title, a right-aligned colour legend,
  // a top-axis value label, and one polyline per series (values in [0, 1]).
  panel(y, h, title, topLabel, series) {
    const ctx = this.ctx;
    const x0 = PAD;
    const w = this.w - PAD * 2;
    const yTop = y + TITLE_H;
    const plotH = h - TITLE_H;
    const yBot = yTop + plotH;

    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "alphabetic";

    // Header: title on the left, legend chips on the right.
    ctx.fillStyle = "#7c8aa0";
    ctx.textAlign = "left";
    ctx.fillText(title, x0, y + 10);
    ctx.textAlign = "right";
    let lx = x0 + w;
    for (let i = series.length - 1; i >= 0; i--) {
      ctx.fillStyle = series[i].color;
      ctx.fillText(series[i].label, lx, y + 10);
      lx -= ctx.measureText(series[i].label).width + 8;
    }

    // Plot frame + top-axis reference value.
    ctx.strokeStyle = "rgba(111,211,199,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, yTop + 0.5, w, plotH);
    ctx.fillStyle = "rgba(124,138,160,0.6)";
    ctx.textAlign = "left";
    ctx.fillText(topLabel, x0 + 3, yTop + 9);

    const n = series.length ? series[0].values.length : 0;
    if (n < 2) return;
    const dx = w / (n - 1);
    const px = (i) => x0 + i * dx;
    const py = (v) => yBot - clamp01(v) * plotH;

    for (const ser of series) {
      // Optional area fill under the line.
      if (ser.fill) {
        ctx.beginPath();
        ctx.moveTo(px(0), yBot);
        for (let i = 0; i < n; i++) ctx.lineTo(px(i), py(ser.values[i]));
        ctx.lineTo(px(n - 1), yBot);
        ctx.closePath();
        ctx.fillStyle = ser.fill;
        ctx.fill();
      }
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = px(i);
        const yv = py(ser.values[i]);
        if (i === 0) ctx.moveTo(x, yv);
        else ctx.lineTo(x, yv);
      }
      ctx.strokeStyle = ser.color;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  }
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
