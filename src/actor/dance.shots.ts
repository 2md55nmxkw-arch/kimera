// Контрольные кадры танцев.
//
// В обычный набор идут два кадра на танец. Раскадровки — отдельная группа: шестнадцать
// кадров через полдоли, второй круг связки, вся фигура с ногами. По ним видно само
// движение, а не только позы:
//   node scripts/shots.mjs strip            — все танцы
//   node scripts/shots.mjs strip-hypno      — один
//   node scripts/shots-sheet.mjs strip-hypno --cols=8 --cell=240
import { RECORDS } from '../content/records';
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

// Танец из файла (если дорожка собрана). Тоже отдельные группы:
//   node scripts/shots.mjs file-all    — первые 26 секунд песни общим планом, через 0.8 с
//   node scripts/shots.mjs file-site   — восемь моментов так, как это видно на сайте
const FILE = RECORDS[0].motion!;
const filed = (times: number[], group: string, site = false): Shot[] =>
  times.map((time, i) => ({
    name: `61-${group}-${String(i).padStart(2, '0')}`,
    group,
    s: 0,
    pointer: [0.1, 0.86] as [number, number],
    // Общим планом, без шкур — или так, как это видно на сайте.
    ...(site ? { size: [640, 360] as [number, number] } : { raw: 1, view: FULL, size: [300, 450] as [number, number] }),
    frames: WARM + Math.round(time * 60),
    prepare: (rig) => rig.actor.prepare?.(FILE) ?? Promise.resolve(null),
    each: (rig, f) => {
      if (f === WARM) rig.actor.dance?.('hypno', 92.5, FILE);
    },
  }));
const every = (from: number, step: number, count = 16) => Array.from({ length: count }, (_, i) => from + i * step);

// Шоу под музыку (fx/show.ts): пластинка ставится без плеера, время песни идёт само.
//   node scripts/shots.mjs show    — Mesmerizer: двенадцать моментов и общий план
//   node scripts/shots.mjs shows   — остальные семь, по три-четыре фигуры танца на каждую
const staged = (record: number, times: number[], group: string | undefined, name: (i: number) => string, wide = false): Shot[] =>
  times.map((time, i) => ({
    name: name(i),
    ...(group ? { group } : {}),
    s: 0,
    pointer: [0.1, 0.86] as [number, number],
    ...(wide ? { raw: 1, view: { pos: [0.4, 2.5, 6.4], target: [0, 1.25, -1.3] } } : {}),
    size: [640, 360] as [number, number],
    frames: WARM + Math.round(time * 60),
    prepare: (rig) => (record === 0 ? rig.actor.prepare?.(FILE) : null) ?? Promise.resolve(null),
    each: (rig, f) => {
      if (f === WARM) rig.record(record);
    },
  }));
/** Секунда песни, на которой танец пластинки проходит долю x своей связки (второй круг). */
const loopTime = (record: number, x: number) => ((8 + x) * 120) / RECORDS[record].show.bpm;
// Какие доли связки показывать: по ним видно, как узор отвечает на фигуры танца.
const MOMENTS: [number, string, number[]][] = [
  [1, 'glitch', [0.5, 1.5, 3.4, 5.5]],
  [2, 'blocks', [1, 4.6, 6.6, 7.6]],
  [3, 'liar', [1, 2.9, 4.9, 6.9]],
  [4, 'clinic', [0.5, 3, 5.2, 7.4]],
  [5, 'crowd', [0.6, 3.6, 4.5, 7]],
  [6, 'machine', [1.5, 5, 6.5, 7.5]],
  [7, 'cute', [0.5, 1.5, 4.5, 7]],
];

export const shots: Shot[] = [
  ...DANCE_NAMES.flatMap((name) => [at(name, 9.1, 'a'), at(name, 14.1, 'b')]),
  // Шоу в обычном наборе: танец с лучами и транс со спиралью.
  ...staged(0, [4.2, 15], undefined, (i) => `70-show-${i ? 'trance' : 'dance'}`),
  ...MOMENTS.flatMap(([record, kind, xs]) => staged(record, [loopTime(record, xs[1])], undefined, () => `71-show-${kind}`)),
  ...DANCE_NAMES.flatMap(strip),
  ...filed(every(0.4, 0.8, 32), 'file-all'),
  ...filed([0.9, 3.2, 5.6, 8, 10.4, 12, 16, 23.5], 'file-site', true),
  ...staged(0, [0.5, 1.35, 1.9, 4.2, 6.8, 9.6, 12.1, 12.9, 15, 19, 22.5, 26], 'show', (i) => `62-show-${String(i).padStart(2, '0')}`),
  ...staged(0, [0.3, 4.2, 15, 22.5], 'show', (i) => `63-show-wide-${i}`, true),
  ...MOMENTS.flatMap(([record, kind, xs]) =>
    staged(record, xs.map((x) => loopTime(record, x)), 'shows', (i) => `64-shows-${record}-${kind}-${i}`),
  ),
];
