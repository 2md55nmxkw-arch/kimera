export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Плавный вход и выход на отрезке 0…1. */
export const smooth = (t: number): number => t * t * (3 - 2 * t);
