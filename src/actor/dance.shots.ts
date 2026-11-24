// Контрольные кадры танцев.
//
// В обычный набор идут два кадра на танец. Раскадровки — отдельная группа: шестнадцать
// кадров через полдоли, второй круг связки, вся фигура с ногами. По ним видно само
// движение, а не только позы:
//   node scripts/shots.mjs strip            — все танцы
//   node scripts/shots.mjs strip-hypno      — один
//   node scripts/shots-sheet.mjs strip-hypno --cols=8 --cell=240
import type { Shot } from '../core/capture';
import { DANCE_NAMES } from './dance';

type Name = (typeof DANCE_NAMES)[number];

const TEMPO = 96;
const WARM = 30; // шагов до начала танца
const framesAt = (beat: number) => WARM + Math.round((beat / TEMPO) * 60 * 60);
const start = (name: Name): Shot['each'] => (rig, f) => {
  if (f === WARM) rig.actor.dance?.(name, TEMPO);
};

/** Кадр на доле beat. */
const at = (name: Name, beat: number, tag: string): Shot => ({
  name: `50-dance-${name}-${tag}`,
  s: 0,
  pointer: [0.1, 0.86],
  frames: framesAt(beat),
  each: start(name),
});

const FULL = { pos: [0.3, 1, 3.8], target: [0, 0.92, 0] };
const strip = (name: Name): Shot[] =>
  Array.from({ length: 16 }, (_, i) => ({
    name: `60-strip-${name}-${String(i).padStart(2, '0')}`,
    group: `strip-${name}`,
    s: 0,
    pointer: [0.1, 0.86] as [number, number],
    raw: 1,
    view: FULL,
    size: [300, 450] as [number, number],
    frames: framesAt(8 + i * 0.5),
    each: start(name),
  }));

export const shots: Shot[] = [
  ...DANCE_NAMES.flatMap((name) => [at(name, 9.1, 'a'), at(name, 14.1, 'b')]),
  ...DANCE_NAMES.flatMap(strip),
];
