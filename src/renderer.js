// Canvas rendering. The world is drawn in world-space and scaled to fit the
// viewport while preserving aspect ratio (letterboxed if needed).

import { CONFIG } from "./config.js";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    // "trophic" colours by diet (green herbivore → red carnivore); "lineage"
    // colours by the heritable lineage marker so clades show as colour bands.
    this.colorMode = "trophic";
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";

    // Fit the world rectangle inside the viewport, centred.
    const sx = w / CONFIG.world.width;
    const sy = h / CONFIG.world.height;
    this.scale = Math.min(sx, sy);
    this.offsetX = (w - CONFIG.world.width * this.scale) / 2;
    this.offsetY = (h - CONFIG.world.height * this.scale) / 2;
  }

  // Convert a screen/client point into world coordinates.
  screenToWorld(clientX, clientY) {
    return {
      x: (clientX - this.offsetX) / this.scale,
      y: (clientY - this.offsetY) / this.scale,
    };
  }

  draw(world) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // World bounds backdrop.
    ctx.fillStyle = "#0c1119";
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.strokeStyle = "rgba(111, 211, 199, 0.15)";
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(0, 0, world.width, world.height);

    // Food.
    ctx.fillStyle = "#3f7d52";
    for (const f of world.food) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, CONFIG.food.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Creatures.
    for (const c of world.creatures) {
      this.drawCreature(ctx, c);
    }

    ctx.restore();
  }

  drawCreature(ctx, c) {
    const r = c.radius;
    // Energy drives brightness so starving creatures visibly fade.
    const energyFrac = Math.max(
      0.25,
      Math.min(1, c.energy / CONFIG.creature.maxEnergy),
    );
    const light = Math.round(35 + energyFrac * 35);
    const hue = this.colorMode === "lineage" ? c.lineageHue : c.hue;

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.heading);

    // Body.
    ctx.fillStyle = `hsl(${hue}, 65%, ${light}%)`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Heading indicator.
    ctx.fillStyle = `hsl(${hue}, 80%, ${light + 18}%)`;
    ctx.beginPath();
    ctx.moveTo(r * 0.4, 0);
    ctx.lineTo(r * 1.6, 0);
    ctx.lineTo(r * 0.4, r * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
