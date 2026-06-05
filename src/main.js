// Entry point: wires the world, renderer, HUD, and the fixed-timestep loop.

import { World } from "./world.js";
import { Renderer } from "./renderer.js";
import { Camera, CameraController } from "./camera.js";
import { Creature } from "./creature.js";
import { CONFIG } from "./config.js";
import { GENES } from "./genome.js";
import { clamp01 } from "./math.js";
import { makeRng } from "./rng.js";
import { History } from "./history.js";
import { Charts } from "./charts.js";
import { saveWorld, loadWorld, hasSavedWorld } from "./persistence.js";
import { ToolController, TOOLS, TOOL_LABELS } from "./tools.js";
import { phaseLabel } from "./daycycle.js";
import { kindLabel } from "./plants.js";
import { seasonLabel, weatherLabel, windStrength, windLabel } from "./weather.js";

const FIXED_DT = 1 / 60; // simulation step, seconds
const MAX_FRAME = 0.1; // clamp huge gaps (e.g. tab was backgrounded)

const canvas = document.getElementById("world");
const camera = new Camera();
const renderer = new Renderer(canvas, camera);
const charts = new Charts(document.getElementById("charts"));

let world;
let history;
let speed = 1;
let paused = false;
let accumulator = 0;
let lastTime = performance.now();

// The id of the creature the inspector is focused on, or null. Held by id (not
// by reference) so it survives the creature list reordering, and is re-resolved
// to the live object each frame — which naturally clears the selection the
// moment the creature dies or the world is swapped out.
let selectedId = null;

// Adopt a freshly built or restored world: swap it in, start a clean chart
// history, and reset the loop's timing so we don't fast-forward the new world.
function adopt(newWorld) {
  world = newWorld;
  history = new History();
  accumulator = 0;
  lastTime = performance.now();
  // A fresh or restored world has its own creatures, so any prior selection is
  // meaningless — drop it (ids never repeat across a reset, but a loaded world
  // could in principle reuse one, so clear explicitly rather than risk a stale
  // match latching onto an unrelated creature).
  select(null);
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

  // Resolve the selection from its id to the live creature (or null if it has
  // since died / left the world), and hand it to the renderer to highlight. Drop
  // a vanished selection's id so we stop scanning for it every frame.
  const selected = resolveSelection();
  if (selected == null) selectedId = null;
  renderer.selected = selected;

  renderer.draw(world);
  updateHud();
  updateInspector(selected);
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

// The HUD layout, declared as collapsible groups so the ~35 stat rows fold into
// labelled <details> sections instead of one flat wall (mirroring how the
// inspector groups the genome). Each row is a [label, read] pair, `read` taking
// the live `world.stats()` snapshot and returning the formatted value text.
//
// Why declarative rather than rebuilding innerHTML each tick: `updateHud` runs
// ~6×/sec, and a fresh innerHTML would reset every <details> back to its default
// open/closed state on each refresh — collapsing a group would last a sixth of a
// second. So the skeleton DOM is built once (`buildHud`) and each refresh only
// rewrites the value spans (`updateHud`), which both preserves the open/closed
// state a viewer sets and avoids reflowing the whole panel every tick.
const HUD_GROUPS = [
  {
    name: "Population",
    open: true,
    rows: [
      ["Population", (s) => s.population],
      ["Peak", (s) => s.peak],
      ["Species", (s) => s.species],
      ["Eco species", (s) => (s.geneSpecies == null ? "—" : s.geneSpecies)],
      ["Isolation", (s) => isolationRow(s.isolation)],
      ["Carnivores", (s) => s.carnivores],
      ["Top gen", (s) => s.generation],
      ["Avg energy", (s) => s.avgEnergy.toFixed(0)],
      ["Kills", (s) => s.kills],
    ],
  },
  {
    name: "World & climate",
    open: true,
    rows: [
      ["Food", (s) => `${s.food} (${s.foodByKind[0]}/${s.foodByKind[1]})`],
      [
        "Plant yield",
        (s) =>
          `${kindLabel(0)} ${Math.round(s.kindYield[0] * 100)}% / ${kindLabel(1)} ${Math.round(s.kindYield[1] * 100)}%`,
      ],
      ["Scent", (s) => s.scent],
      ["Time", (s) => formatTime(s.time)],
      ["Daylight", (s) => `${phaseLabel(s.time)} ${Math.round(s.daylight * 100)}%`],
      ["Season", (s) => seasonLabel(s.time)],
      ["Weather", (s) => `${weatherLabel(s.time)} ${Math.round(s.climateFood * 100)}%`],
      ["Wind", (s) => windRow(s.time)],
    ],
  },
  {
    name: "Traits & niche",
    open: false,
    rows: [
      ["Avg speed", (s) => s.avg.speed.toFixed(1)],
      ["Avg sense", (s) => s.avg.sense.toFixed(0)],
      ["Avg size", (s) => s.avg.size.toFixed(2)],
      ["Avg wander", (s) => s.avg.wander.toFixed(2)],
      ["Avg diet", (s) => s.avg.diet.toFixed(2)],
      ["Avg forage", (s) => s.avg.forage.toFixed(2)],
      ["Avg hunt", (s) => s.avg.hunt.toFixed(2)],
      ["Warmth pref", (s) => s.avg.warmthPref.toFixed(2)],
      ["Wetness pref", (s) => s.avg.wetnessPref.toFixed(2)],
      ["Climate sort", (s) => climateSortRow(s)],
      ["Biome", (s) => (s.biomeSort == null ? "—" : s.biomeSort.toFixed(2))],
      ["Canopy", (s) => (s.canopy == null ? "—" : s.canopy.toFixed(2))],
      ["Canopy sort", (s) => canopySortRow(s)],
    ],
  },
  {
    name: "Social",
    open: false,
    rows: [
      ["Food voice", (s) => s.avg.foodVoice.toFixed(2)],
      ["Alarm voice", (s) => s.avg.alarmVoice.toFixed(2)],
      ["Food trust", (s) => s.avg.foodTrust.toFixed(2)],
      ["Alarm trust", (s) => s.avg.alarmTrust.toFixed(2)],
      ["Kinship", (s) => s.avg.kinship.toFixed(2)],
      ["Mating", (s) => s.avg.mating.toFixed(2)],
      ["Mate choice", (s) => s.avg.mateChoice.toFixed(2)],
    ],
  },
];

// The value spans to refresh, paired with their `read` function. Filled by
// `buildHud`; `updateHud` walks it to rewrite only the text.
let hudCells = [];

// Build the HUD skeleton once: a <details> group per section, each holding its
// rows, with every value span collected into `hudCells` so refreshes touch only
// text. Safe to call again (e.g. on a hot reload) — it clears first.
function buildHud() {
  statsEl.textContent = "";
  hudCells = [];
  for (const group of HUD_GROUPS) {
    const details = document.createElement("details");
    details.className = "group";
    details.open = group.open;
    const summary = document.createElement("summary");
    summary.textContent = group.name;
    details.appendChild(summary);
    for (const [label, read] of group.rows) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      const labelEl = document.createElement("span");
      labelEl.className = "label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "value";
      rowEl.append(labelEl, valueEl);
      details.appendChild(rowEl);
      hudCells.push([valueEl, read]);
    }
    statsEl.appendChild(details);
  }
}

function updateHud() {
  hudThrottle++;
  if (hudThrottle % 10 !== 0) return; // ~6 updates/sec
  const s = world.stats();
  for (const [el, read] of hudCells) el.textContent = read(s);
}

function row(label, value) {
  return `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Realised reproductive isolation: the within-lineage share of recent sexual
// matings, shown as a percentage once any are on record (and "—" before then,
// rather than a misleading 0% when no creature has bred sexually yet).
function isolationRow(isolation) {
  if (isolation == null) return "—";
  return `${Math.round(isolation * 100)}%`;
}

// Spatial climate sorting: the correlation between where a creature stands in
// the microclimate (warmer/cooler, wetter/drier than average) and the climate it
// prefers, one figure per axis. Positive means clades have settled into the
// regions that suit them — warm-adapted in the warm south, cold-adapted in the
// cool north — so the figures climb as the population sorts itself across space.
// "—" until there are enough creatures with some spread to define it.
function climateSortRow(s) {
  const fmt = (v) => (v == null ? "—" : v.toFixed(2));
  return `w ${fmt(s.climateSortWarmth)} / ${fmt(s.climateSortWetness)}`;
}

// The realised spatial canopy sort: the standing larder's mean canopy investment
// on harsh (barren) ground vs. benign (fertile), and their difference. The
// condition-dependent germination curve selects for *heavier* canopy where
// seedlings struggle, so a positive difference means the larder has actually
// sorted along that gradient. Shows the two means with the signed gap; "—" for an
// empty bucket (no plants on that kind of ground yet).
function canopySortRow(s) {
  const fmt = (v) => (v == null ? "—" : v.toFixed(2));
  const gap =
    s.canopySort == null
      ? "—"
      : `${s.canopySort >= 0 ? "+" : ""}${s.canopySort.toFixed(2)}`;
  return `${fmt(s.canopyHarsh)}/${fmt(s.canopyBenign)} (${gap})`;
}

// The wind reads as "Calm" until a storm actually stirs one up; once it blows,
// show the compass bearing it pushes toward and its strength.
function windRow(time) {
  const w = windStrength(time);
  if (w <= 0) return "Calm";
  return `${windLabel(time)} ${Math.round(w * 100)}%`;
}

// --- Inspector ---
//
// A click with the Inspect tool selects the creature under the pointer; this
// side panel then reads out that one individual's live state and full genome,
// so the rich per-creature genetics the aggregate stats only average over
// become tangible. The selection is held by id and re-resolved each frame.

const inspectorEl = document.getElementById("inspector");
const inspectorTitle = document.getElementById("inspector-title");
const inspectorSwatch = document.getElementById("inspector-swatch");
const inspectorBody = document.getElementById("inspector-body");

// Set (or clear) the inspector selection. Passing a creature focuses on it;
// passing null deselects. Updates the renderer highlight immediately so a click
// feels responsive even between HUD refreshes.
function select(creature) {
  selectedId = creature ? creature.id : null;
  renderer.selected = creature ?? null;
  updateInspector(creature ?? null);
}

// Find the live, still-alive creature matching the current selection id, or null
// if it has died or the world was swapped. O(n) but only while something is
// selected, and only once per frame.
function resolveSelection() {
  if (selectedId == null) return null;
  for (const c of world.creatures) {
    if (c.id === selectedId && c.alive) return c;
  }
  return null;
}

// The diet gene reads as a trophic role for a quick human label, splitting the
// herbivore↔carnivore axis at the same `carnivoreThreshold` the simulation uses
// to decide who can hunt, with a middle "omnivore" band.
function trophicRole(diet) {
  const t = CONFIG.creature.carnivoreThreshold;
  if (diet < t) return "Herbivore";
  if (diet > 0.6) return "Carnivore";
  return "Omnivore";
}

// Repaint the inspector for `creature`, or hide it when nothing is selected.
function updateInspector(creature) {
  if (!creature) {
    inspectorEl.hidden = true;
    return;
  }
  inspectorEl.hidden = false;

  const g = creature.genome;
  inspectorTitle.textContent = `Creature #${creature.id}`;
  // The swatch shows the clade colour the lineage view paints by, so the panel
  // ties back to the on-canvas colouring.
  inspectorSwatch.style.background = `hsl(${g.lineageHue.toFixed(0)}, 65%, 55%)`;

  const energyPct = Math.round((creature.energy / CONFIG.creature.maxEnergy) * 100);
  const rows = [
    section("Vitals"),
    row("Role", trophicRole(g.diet)),
    row("Generation", creature.generation),
    row("Age", `${creature.age.toFixed(0)}s`),
    row("Energy", energyBar(creature.energy)),
    row("Energy %", `${energyPct}%`),
    row("Position", `${creature.x.toFixed(0)}, ${creature.y.toFixed(0)}`),
    section("Body & senses"),
    geneRow("speed", g.speed),
    geneRow("sense", g.sense),
    geneRow("size", g.size),
    geneRow("turnRate", g.turnRate),
    geneRow("metabolismEff", g.metabolismEff),
    geneRow("wander", g.wander),
    section("Diet & niche"),
    geneRow("diet", g.diet),
    geneRow("forage", g.forage),
    geneRow("hunt", g.hunt),
    geneRow("warmthPref", g.warmthPref),
    geneRow("wetnessPref", g.wetnessPref),
    section("Social"),
    geneRow("foodVoice", g.foodVoice),
    geneRow("alarmVoice", g.alarmVoice),
    geneRow("foodTrust", g.foodTrust),
    geneRow("alarmTrust", g.alarmTrust),
    geneRow("kinship", g.kinship),
    geneRow("mating", g.mating),
    geneRow("mateChoice", g.mateChoice),
  ];
  inspectorBody.innerHTML = rows.join("");
}

function section(label) {
  return `<div class="isect">${label}</div>`;
}

// A genome row: the gene's value, plus a thin bar showing where it sits within
// its legal [min, max] envelope, so an at-a-glance "high / low for this trait"
// reads without knowing each gene's range. Genes carrying a known range get the
// bar; anything else (none today) falls back to the raw number.
function geneRow(name, value) {
  const range = GENES[name];
  if (!range) return row(name, fmtGene(value));
  const [min, max] = range;
  const frac = max > min ? (value - min) / (max - min) : 0;
  return `<div class="row"><span class="label">${name}</span><span class="value">${geneMeter(frac)} ${fmtGene(value)}</span></div>`;
}

// Format a gene value: large-magnitude genes (speed, sense) read as whole
// numbers, the smaller ones (the [0,1] traits, plus size/turnRate/metabolismEff)
// to two decimals, so the numbers stay legible rather than uniformly noisy.
function fmtGene(v) {
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
}

// A tiny inline bar (filled blocks out of a fixed width) for a [0,1] fraction:
// the filled run in accent, the remaining track dim, so where the gene sits in
// its range reads at a glance.
function geneMeter(frac) {
  const width = 6;
  const filled = Math.round(clamp01(frac) * width);
  return `<span class="meter"><span class="mfill">${"▰".repeat(filled)}</span>${"▱".repeat(width - filled)}</span>`;
}

// A wider energy bar against the species cap, coloured from red (starving) to
// teal (full), so the inspected creature's condition reads at a glance.
function energyBar(energy) {
  const frac = clamp01(energy / CONFIG.creature.maxEnergy);
  const hue = Math.round(frac * 150); // 0 red → 150 green-teal
  const pct = Math.round(frac * 100);
  return `<span class="ebar"><span class="efill" style="width:${pct}%;background:hsl(${hue},70%,50%)"></span></span>`;
}

document.getElementById("inspector-close").addEventListener("click", () => select(null));

// Esc clears the selection, a familiar "dismiss" shortcut.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selectedId != null) select(null);
});

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
  // The Inspect brush reports the creature under the pointer (or null on empty
  // ground), which selects it / clears the selection.
  onPick: (creature) => select(creature),
});

// Cycle the active brush (food → creature → inspect), mirroring the colour
// toggle. The canvas cursor follows the brush — a pointer for Inspect, the
// painting crosshair otherwise — so the active mode reads off the cursor too.
const toolBtn = document.getElementById("tool");
toolBtn.addEventListener("click", () => {
  const i = TOOLS.indexOf(tools.tool);
  tools.setTool(TOOLS[(i + 1) % TOOLS.length]);
  toolBtn.textContent = "Tool: " + TOOL_LABELS[tools.tool];
  canvas.style.cursor = tools.tool === "inspect" ? "pointer" : "crosshair";
});

// --- Camera ---
//
// Pan/zoom over the world, layered on top of the renderer's fit-to-viewport
// transform. The controller owns the wheel, middle/right-drag, two-finger
// pinch/pan, and arrow keys; the on-screen +/−/reset cluster covers touch and
// discoverability. The editing brushes keep the single primary-button stroke.
const cameraControls = new CameraController({
  canvas,
  camera,
  renderer,
  getWorld: () => world,
});

// How hard each on-screen +/- button click zooms — a bigger step than a wheel
// notch so a tap moves a useful amount.
const CAMERA_BUTTON_STEP = 1.4;

document
  .getElementById("zoom-in")
  .addEventListener("click", () => cameraControls.zoomCentre(CAMERA_BUTTON_STEP));
document
  .getElementById("zoom-out")
  .addEventListener("click", () => cameraControls.zoomCentre(1 / CAMERA_BUTTON_STEP));
document.getElementById("zoom-reset").addEventListener("click", () => camera.reset());

// --- Boot ---

buildHud();
reset();
requestAnimationFrame(loop);
