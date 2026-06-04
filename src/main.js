// Entry point: wires the world, renderer, HUD, and the fixed-timestep loop.

import { World } from "./world.js";
import { Renderer } from "./renderer.js";
import { Creature } from "./creature.js";
import { makeRng } from "./rng.js";

const FIXED_DT = 1 / 60; // simulation step, seconds
const MAX_FRAME = 0.1; // clamp huge gaps (e.g. tab was backgrounded)

const canvas = document.getElementById("world");
const renderer = new Renderer(canvas);

let world;
let speed = 1;
let paused = false;
let accumulator = 0;
let lastTime = performance.now();

function reset() {
  world = new World(makeRng());
  accumulator = 0;
  lastTime = performance.now();
}

function loop(now) {
  let frame = (now - lastTime) / 1000;
  lastTime = now;
  if (frame > MAX_FRAME) frame = MAX_FRAME;

  if (!paused) {
    accumulator += frame;
    // Run `speed` sim-steps per rendered frame's worth of time.
    let guard = 0;
    while (accumulator >= FIXED_DT && guard < 600) {
      for (let s = 0; s < speed; s++) world.update(FIXED_DT);
      accumulator -= FIXED_DT;
      guard++;
    }

    // Auto-reseed a tiny founder population if everything dies, so the world
    // never gets permanently stuck empty.
    if (world.creatures.length === 0) {
      for (let i = 0; i < 12; i++) {
        world.creatures.push(Creature.random(world, world.rng));
      }
    }
  }

  renderer.draw(world);
  updateHud();
  requestAnimationFrame(loop);
}

// --- HUD ---

const statsEl = document.getElementById("stats");
let hudThrottle = 0;

function updateHud() {
  hudThrottle++;
  if (hudThrottle % 10 !== 0) return; // ~6 updates/sec
  const s = world.stats();
  statsEl.innerHTML = [
    row("Population", s.population),
    row("Peak", s.peak),
    row("Food", s.food),
    row("Top gen", s.generation),
    row("Time", formatTime(s.time)),
    row("Avg energy", s.avgEnergy.toFixed(0)),
    divider(),
    row("Avg speed", s.avg.speed.toFixed(1)),
    row("Avg sense", s.avg.sense.toFixed(0)),
    row("Avg size", s.avg.size.toFixed(2)),
    row("Avg wander", s.avg.wander.toFixed(2)),
  ].join("");
}

function row(label, value) {
  return `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function divider() {
  return `<div class="row" style="opacity:.3">—————————</div>`;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// --- Controls ---

document.getElementById("pause").addEventListener("click", (e) => {
  paused = !paused;
  e.target.textContent = paused ? "Resume" : "Pause";
});

document.getElementById("reset").addEventListener("click", () => reset());

const speedInput = document.getElementById("speed");
const speedLabel = document.getElementById("speed-label");
speedInput.addEventListener("input", () => {
  speed = parseInt(speedInput.value, 10);
  speedLabel.textContent = speed + "×";
});

// Click to drop a small cluster of food.
canvas.addEventListener("click", (e) => {
  const { x, y } = renderer.screenToWorld(e.clientX, e.clientY);
  if (x < 0 || y < 0 || x > world.width || y > world.height) return;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 30;
    world.spawnFood(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
});

// --- Boot ---

reset();
requestAnimationFrame(loop);
