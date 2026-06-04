// localStorage persistence for the world. A thin, defensive wrapper around the
// browser store: every call is wrapped so a disabled/full/private-mode store, a
// corrupt blob, or an incompatible save version can never crash the sim — the
// functions just report failure and the caller carries on with the live world.

import { World } from "./world.js";

const KEY = "fluffy-bassoon:world";

// Some environments (private browsing, disabled storage) throw on any access.
// Probe once and treat an unavailable store as "no save".
function store() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Serialize `world` and write it under our key. Returns true on success.
export function saveWorld(world) {
  const ls = store();
  if (!ls) return false;
  try {
    ls.setItem(KEY, JSON.stringify(world.serialize()));
    return true;
  } catch (e) {
    console.warn("Fluffy Bassoon: save failed", e);
    return false;
  }
}

// Read the saved world and rebuild it, driven by `rng`. Returns the restored
// World, or null if there's nothing saved / the data is unusable.
export function loadWorld(rng) {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return null;
    return World.deserialize(JSON.parse(raw), rng);
  } catch (e) {
    console.warn("Fluffy Bassoon: load failed", e);
    return null;
  }
}

// Whether a (non-empty) save exists, used to enable/disable the Load button.
export function hasSavedWorld() {
  const ls = store();
  if (!ls) return false;
  try {
    return ls.getItem(KEY) != null;
  } catch {
    return false;
  }
}

// Drop the saved world, e.g. when the user resets.
export function clearSavedWorld() {
  const ls = store();
  if (!ls) return false;
  try {
    ls.removeItem(KEY);
    return true;
  } catch (e) {
    console.warn("Fluffy Bassoon: clear failed", e);
    return false;
  }
}
