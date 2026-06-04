// Entry point: wires the world, renderer, HUD, and the fixed-timestep loop.

import { World } from "./world.js";
import { Renderer } from "./renderer.js";
import { Creature } from "./creature.js";
import { makeRng } from "./rng.js";
import { History } from "./history.js";
import { Charts } from "./charts.js";
import { saveWorld, loadWorld, hasSavedWorld } from "./persistence.js";
import { ToolController, TOOLS, TOOL_LABELS } from "./tools.js";
import { phaseLabel } from "./daycycle.js";
import { seasonLabel, weatherLabel, windStrength, windLabel } from "./weather.js";

const FIXED_DT = 1 / 60; // simulation step, seconds
const MAX_FRAME = 0.1; // clamp huge gaps (e.g. tab was backgrounded)

const canvas = document.getElementById("world");
const renderer = new Renderer(canvas);
const charts = new Charts(document.getElementById("charts"));

let world;
let history;
let speed = 1;
let paused = false;
let accumulator = 0;
let lastTime = performance.now();

// Adopt a freshly built or restored world: swap it in, start a clean chart
// history, and reset the loop's timing so we don't fast-forward the new world.
function adopt(newWorld) {
  world = newWorld;
  history = new History();
  accumulator = 0;
  lastTime = performance.now();
}

function reset() {
  adopt(new World(makeRng()));
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
      // Feed the history sampler the sim-time actually advanced this tick, so
      // the charts span a consistent slice of world time at any speed.
      history.tick(FIXED_DT * speed, () => world.stats());
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
  drawCharts();
  requestAnimationFrame(loop);
}

let chartThrottle = 0;
function drawCharts() {
  if (chartThrottle++ % 20 === 0) charts.draw(history); // ~3 redraws/sec
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
    row("Carnivores", s.carnivores),
    row("Food", s.food),
    row("Scent", s.scent),
    row("Top gen", s.generation),
    row("Time", formatTime(s.time)),
    row("Daylight", `${phaseLabel(s.time)} ${Math.round(s.daylight * 100)}%`),
    row("Season", seasonLabel(s.time)),
    row("Weather", `${weatherLabel(s.time)} ${Math.round(s.climateFood * 100)}%`),
    row("Wind", windRow(s.time)),
    row("Avg energy", s.avgEnergy.toFixed(0)),
    row("Kills", s.kills),
    divider(),
    row("Avg speed", s.avg.speed.toFixed(1)),
    row("Avg sense", s.avg.sense.toFixed(0)),
    row("Avg size", s.avg.size.toFixed(2)),
    row("Avg wander", s.avg.wander.toFixed(2)),
    row("Avg diet", s.avg.diet.toFixed(2)),
    divider(),
    row("Food voice", s.avg.foodVoice.toFixed(2)),
    row("Alarm voice", s.avg.alarmVoice.toFixed(2)),
    row("Food trust", s.avg.foodTrust.toFixed(2)),
    row("Alarm trust", s.avg.alarmTrust.toFixed(2)),
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

// The wind reads as "Calm" until a storm actually stirs one up; once it blows,
// show the compass bearing it pushes toward and its strength.
function windRow(time) {
  const w = windStrength(time);
  if (w <= 0) return "Calm";
  return `${windLabel(time)} ${Math.round(w * 100)}%`;
}

// --- Controls ---

document.getElementById("pause").addEventListener("click", (e) => {
  paused = !paused;
  e.target.textContent = paused ? "Resume" : "Pause";
});

document.getElementById("reset").addEventListener("click", () => reset());

// Save / load the world to this browser's localStorage. Buttons flash a brief
// confirmation, and Load stays disabled whenever there's nothing saved.
const saveBtn = document.getElementById("save");
const loadBtn = document.getElementById("load");

function refreshLoadButton() {
  loadBtn.disabled = !hasSavedWorld();
}

function flash(btn, text) {
  const original = btn.dataset.label ?? btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => {
    btn.textContent = btn.dataset.label;
  }, 1000);
}

saveBtn.addEventListener("click", () => {
  const ok = saveWorld(world);
  flash(saveBtn, ok ? "Saved!" : "Failed");
  refreshLoadButton();
});

loadBtn.addEventListener("click", () => {
  const restored = loadWorld(makeRng());
  if (restored) {
    adopt(restored);
    flash(loadBtn, "Loaded!");
  } else {
    flash(loadBtn, "No save");
  }
});

refreshLoadButton();

// Cycle the creature colouring between trophic role and lineage clade.
const colourBtn = document.getElementById("colour");
const COLOUR_MODES = ["trophic", "lineage"];
const COLOUR_LABELS = { trophic: "Trophic", lineage: "Lineage" };
colourBtn.addEventListener("click", () => {
  const i = COLOUR_MODES.indexOf(renderer.colorMode);
  renderer.colorMode = COLOUR_MODES[(i + 1) % COLOUR_MODES.length];
  colourBtn.textContent = "Colour: " + COLOUR_LABELS[renderer.colorMode];
});

const speedInput = document.getElementById("speed");
const speedLabel = document.getElementById("speed-label");
speedInput.addEventListener("input", () => {
  speed = parseInt(speedInput.value, 10);
  speedLabel.textContent = speed + "×";
});

// Interactive editing: click or drag the world to paint food or seed creatures.
// The tools read `world` through a getter since it's swapped on reset / load.
const tools = new ToolController({
  canvas,
  renderer,
  getWorld: () => world,
});

// Cycle the active brush (food ↔ creature), mirroring the colour toggle.
const toolBtn = document.getElementById("tool");
toolBtn.addEventListener("click", () => {
  const i = TOOLS.indexOf(tools.tool);
  tools.setTool(TOOLS[(i + 1) % TOOLS.length]);
  toolBtn.textContent = "Tool: " + TOOL_LABELS[tools.tool];
});

// --- Boot ---

reset();
requestAnimationFrame(loop);
