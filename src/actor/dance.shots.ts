// Контрольные кадры танцев: каждый в двух местах связки — в начале и ближе к концу
// двух тактов, где у многих своя особая фигура.
import type { Shot } from '../core/capture';
import { DANCE_NAMES } from './dance';

const TEMPO = 96;
/** Кадр на доле beat: танец запускается с первого шага. */
const at = (name: (typeof DANCE_NAMES)[number], beat: number, tag: string): Shot => ({
  name: `50-dance-${name}-${tag}`,
  s: 0,
  pointer: [0.1, 0.86],
  frames: Math.round((beat / TEMPO) * 60 * 60),
  each: (rig, f) => {
    if (f === 0) rig.actor.dance?.(name, TEMPO);
  },
});

export const shots: Shot[] = DANCE_NAMES.flatMap((name) => [at(name, 1.4, 'a'), at(name, 6.4, 'b')]);
