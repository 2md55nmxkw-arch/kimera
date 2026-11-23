// Контрольные кадры «мелкой жизни»: каждый жест в его высшей точке, обычной камерой.
// Жесты запускаются напрямую (actor.idle), а не ждут своей очереди по таймеру.
import type { Shot } from '../core/capture';
import type { IdleName } from './life';

const CORNER: [number, number] = [0.1, 0.86]; // линза в углу, персонаж открыт

/** Жест и момент после запуска, секунды, когда его снимать. */
const PEAKS: [IdleName, number][] = [
  ['yawn', 1.6],
  ['stretch', 1.6],
  ['hand', 1.5],
  ['hair', 1.0],
  ['knock', 1.06],
  ['wave', 1.2],
  ['wary', 2.5],
  ['sigh', 1.0],
  ['bored', 2.5],
];

// Стук идёт, только пока посетитель не шевелится (стоит тронуть мышь — она убирает
// руку), а тишина после сброса копится с нуля. Поэтому перед стуком даём ей постоять.
const LEAD: Partial<Record<IdleName, number>> = { knock: 45 };

export const shots: Shot[] = [
  ...PEAKS.map(([gesture, at]): Shot => {
    const lead = LEAD[gesture] ?? 0;
    return {
      name: `30-life-${gesture}`,
      s: 0,
      pointer: CORNER,
      frames: lead + Math.round(at * 60) + 1,
      idle: lead ? 30 : 0,
      each: (rig, f) => {
        if (f === lead) rig.actor.idle?.(gesture);
      },
    };
  }),
  {
    // Быстрый проход курсора мимо неё: волосы и юбку сносит ветром.
    name: '31-life-wind',
    s: 0,
    pointer: [0.95, 0.4],
    frames: 40,
    each: (rig, f, n) => {
      rig.pointer.tx = 0.95 - (f / n) * 0.75;
    },
  },
];
