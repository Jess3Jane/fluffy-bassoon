// A small, fast, seedable PRNG (mulberry32). Deterministic worlds make
// debugging and reproducing emergent behaviour far easier than Math.random.

export function makeRng(seed = (Date.now() >>> 0)) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Uniform in [min, max).
  rng.range = (min, max) => min + (max - min) * rng();
  // Integer in [0, n).
  rng.int = (n) => Math.floor(rng() * n);
  // Approximately-normal sample (sum of uniforms), mean 0, stddev ~1.
  rng.normal = () => (rng() + rng() + rng() + rng() - 2) / Math.sqrt(4 / 12);
  // True with probability p.
  rng.chance = (p) => rng() < p;

  return rng;
}
