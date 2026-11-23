// Прокрутка → глава. У каждой главы своя полоса прокрутки, центрированная на её
// секции; внутри полосы линза появляется, держится и к концу заливает экран
// следующей шкурой.
import { clamp, smooth } from './math';

/**
 * @param scroll положение прокрутки в главах (0 — первая секция точно в окне)
 * @param count  сколько всего глав
 */
export function chapterAt(scroll: number, count: number): { s: number; chapter: number; q: number } {
  const s = clamp(scroll, 0, count - 1);
  const band = s + 0.5;
  const chapter = Math.min(Math.floor(band), count - 1);
  // В последней главе заливать нечем: линза остаётся линзой.
  const q = chapter === count - 1 ? Math.min(band - chapter, 0.6) : band - chapter;
  return { s, chapter, q };
}

/**
 * Радиус линзы за одну главу: появляется из точки, держится, а к концу главы
 * заливает экран.
 * @param rest  радиус в покое
 * @param flood на сколько вырасти, чтобы закрыть весь экран
 */
export function lensRadius(q: number, rest: number, flood: number): number {
  if (q < 0.15) return rest * smooth(q / 0.15);
  if (q < 0.62) return rest;
  return rest + flood * smooth((q - 0.62) / 0.38);
}
