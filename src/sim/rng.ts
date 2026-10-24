// Seeded random numbers (mulberry32). The generator state is a single 32-bit integer stored in the
// game state, so a saved game continues with exactly the same random sequence.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Current generator state, to store back into the game state. */
  readonly state: number;
}

export function createRng(state: number): Rng {
  let s = state >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    get state() {
      return s;
    },
  };
}
