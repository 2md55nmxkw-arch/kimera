// Случайные числа с зерном. Всё случайное в анимации берётся отсюда, а не из
// Math.random: тогда контрольный кадр с тем же зерном получается тем же самым.
let state = 1;

/** Начать последовательность заново. */
export function reseed(seed: number): void {
  state = seed >>> 0 || 1;
}

/** Число от 0 до 1 (mulberry32). */
export function rng(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let x = state;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
