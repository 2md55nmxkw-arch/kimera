// Стенд контрольных кадров (только dev-сборка).
//
// Каждый кадр из списка SHOTS получается одинаково при каждом запуске: состояние
// сбрасывается, случайные числа идут с одного зерна, время шагает ровно по 1/60 с.
// Команда `npm run shots` открывает страницу с ?shots=<набор> в безголовом Chrome,
// страница снимает все кадры и отдаёт их dev-серверу, тот кладёт PNG в shots/<набор>/.
// `npm run shots:compare` сравнивает два набора попиксельно.
//
// Меняешь картинку намеренно — пересними эталон. Добавляешь то, чего на кадрах
// не видно, — добавь сюда кадр, на котором видно.
//
// Тот же список служит ещё двум вещам:
//   ?freeze=<кадр> — страница замирает в состоянии кадра, с текстом и вёрсткой
//                    (`npm run page -- <кадр>` снимает её целиком);
//   ?perf=<набор>  — замер времени кадра (`npm run perf`).
import type * as THREE from 'three/webgpu';
import type { Actor } from '../actor';
import type { StepEnv } from './contracts';

export interface Rig {
  canvas: HTMLCanvasElement;
  backend: 'webgpu' | 'webgl';
  camera: THREE.PerspectiveCamera;
  actor: Actor;
  pointer: { x: number; y: number; tx: number; ty: number; press: number; pressTarget: number };
  /** Ручные подмены: своя камера и draw ≥ 0, останавливающий ход рисования наброска. */
  debugView: { draw: number; on: boolean; pos: number[]; target: number[] };
  u: { raw: { value: number } };
  resizeTo(width: number, height: number, dpr: number): void;
  resize(): void;
  reset(): void;
  step(dt: number, env: StepEnv): void;
  render(): void;
  /** Прокрутить страницу к главе, чтобы текст совпал с картинкой. */
  scrollTo(s: number): void;
  /** Дождаться, пока видеокарта дорисует кадр. */
  sync(): Promise<void>;
}

export interface Shot {
  name: string;
  s: number;
  /** Центр линзы, доли экрана от левого верхнего угла. */
  pointer: [number, number];
  press?: number;
  draw?: number;
  raw?: number;
  /** Сколько секунд указатель «никто не трогал». */
  idle?: number;
  /** Своя камера вместо обычной: откуда и куда смотреть, метры. */
  view?: { pos: number[]; target: number[] };
  size?: [number, number];
  /** Сколько шагов по 1/60 с отсчитать перед снимком (по умолчанию 150). */
  frames?: number;
  /** Вызывается перед каждым шагом: двигать указатель, запускать реакции. */
  each?(rig: Rig, frame: number, frames: number): void;
}

const CORNER: [number, number] = [0.1, 0.86]; // линза в углу, персонаж открыт

const BASE: Shot[] = [
  { name: '01-default-lens', s: 0, pointer: [0.62, 0.42] },
  { name: '02-default-clear', s: 0, pointer: CORNER },
  { name: '03-mosaic-lens', s: 1, pointer: [0.6, 0.36] },
  { name: '04-mosaic-clear', s: 1, pointer: CORNER },
  { name: '05-sketch-done', s: 2, pointer: [0.3, 0.72] },
  { name: '06-sketch-draw-30', s: 2, pointer: [0.3, 0.72], draw: 0.3 },
  { name: '07-sketch-draw-60', s: 2, pointer: [0.3, 0.72], draw: 0.6 },
  { name: '08-flood-default-mosaic', s: 0.36, pointer: [0.5, 0.5] },
  { name: '09-flood-mosaic-sketch', s: 1.4, pointer: [0.6, 0.4] },
  { name: '10-press', s: 0, pointer: [0.62, 0.42], press: 1 },
  {
    name: '11-poke-face',
    s: 0,
    pointer: CORNER,
    each: (rig, f, n) => {
      if (f === n - 24) rig.actor.react?.('face', 0.4);
    },
  },
  {
    name: '12-trail',
    s: 1,
    pointer: [0.25, 0.5],
    each: (rig, f, n) => {
      const k = f / n;
      rig.pointer.tx = 0.25 + k * 0.5;
      rig.pointer.ty = 0.5 + Math.sin(k * 6) * 0.2;
    },
  },
  { name: '13-raw', s: 0, pointer: CORNER, raw: 1 },
  { name: '15-ids', s: 0, pointer: CORNER, raw: 2 },
  { name: '14-narrow', s: 0, pointer: [0.5, 0.3], size: [540, 960] },
];

// Свои кадры модуль кладёт рядом с собой в файл «что-то.shots.ts»:
//   import type { Shot } from '../core/capture';
//   export const shots: Shot[] = [{ name: '20-stage-turn', … }];
// Они подхватываются сами, общий список править не нужно. Имена — с номером, чтобы
// порядок на сводном листе был постоянным.
const found = import.meta.glob<{ shots: Shot[] }>('../**/*.shots.ts', { eager: true });
export const SHOTS: Shot[] = [
  ...BASE,
  ...Object.keys(found)
    .sort()
    .flatMap((file) => found[file].shots),
];

const post = (path: string, body: BodyInit) => fetch(path, { method: 'POST', body });
const envOf = (shot: Shot): StepEnv => ({ s: shot.s, still: false, roam: false, idle: shot.idle ?? 0 });

/** Привести сцену в состояние кадра: сброс, указатель, отсчёт шагов. Размер буфера не трогает. */
function pose(rig: Rig, shot: Shot): void {
  rig.reset();
  const [x, y] = shot.pointer;
  const press = shot.press ?? 0;
  Object.assign(rig.pointer, { x, y, tx: x, ty: y, press, pressTarget: press });
  rig.debugView.draw = shot.draw ?? -1;
  rig.debugView.on = Boolean(shot.view);
  if (shot.view) Object.assign(rig.debugView, shot.view);
  rig.u.raw.value = shot.raw ?? 0;
  const frames = shot.frames ?? 150;
  for (let f = 0; f < frames; f++) {
    shot.each?.(rig, f, frames);
    rig.step(1 / 60, envOf(shot));
  }
}

/** Вернуть всё как было до съёмки. */
function restore(rig: Rig): void {
  rig.debugView.draw = -1;
  rig.debugView.on = false;
  rig.u.raw.value = 0;
  rig.reset();
  rig.resize();
}

/** Снять все кадры (или только названные) в набор `set`. */
export async function runShots(rig: Rig, set: string, only?: string[]): Promise<string[]> {
  const taken: string[] = [];
  for (const shot of SHOTS) {
    if (only && !only.includes(shot.name)) continue;
    const [w, h] = shot.size ?? [1280, 720];
    rig.resizeTo(w, h, 1);
    pose(rig, shot);
    rig.render();
    // Снимать холст нужно сразу после рендера, в той же задаче: потом кадр уйдёт на экран.
    const png = await (await fetch(rig.canvas.toDataURL('image/png'))).blob();
    await post(`/__shots/save?set=${set}&name=${shot.name}`, png);
    taken.push(shot.name);
  }
  restore(rig);
  await post(`/__shots/done?set=${set}`, JSON.stringify({ backend: rig.backend, gpu: await gpuName(), shots: taken }));
  return taken;
}

/**
 * Остановить страницу в состоянии кадра и оставить её на экране в размере окна:
 * так снимается вся страница целиком, с текстом и вёрсткой поверх холста.
 */
export function freezeAt(rig: Rig, name: string): void {
  const shot = SHOTS.find((s) => s.name === name);
  if (!shot) throw new Error(`нет кадра «${name}»; есть: ${SHOTS.map((s) => s.name).join(', ')}`);
  rig.resize();
  rig.scrollTo(shot.s);
  pose(rig, shot);
  rig.render();
}

// Кадры для замера: по одному на шкуру, линза в углу.
const PERF_SHOTS = ['02-default-clear', '04-mosaic-clear', '05-sketch-done'];

/**
 * Замерить время кадра в 1920×1080: шаг симуляции, рендер и ожидание видеокарты.
 * Это чистая стоимость кадра без привязки к частоте экрана: 16.7 мс — потолок для 60 к/с.
 */
export async function runPerf(rig: Rig, set: string): Promise<void> {
  const rows: { name: string; ms: number; cpu: number }[] = [];
  for (const name of PERF_SHOTS) {
    const shot = SHOTS.find((s) => s.name === name);
    if (!shot) continue;
    rig.resizeTo(1920, 1080, 1);
    pose(rig, shot);
    rig.render();
    await rig.sync();
    const frames = 60;
    let cpu = 0;
    const start = performance.now();
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      rig.step(1 / 60, envOf(shot));
      cpu += performance.now() - t0;
      rig.render();
      await rig.sync();
    }
    rows.push({ name, ms: (performance.now() - start) / frames, cpu: cpu / frames });
  }
  restore(rig);
  await post(`/__shots/perf?set=${set}`, JSON.stringify({ backend: rig.backend, gpu: await gpuName(), size: '1920x1080', rows }));
}

/** На чём на самом деле считалась картинка: по этой строке видно программный рендер. */
async function gpuName(): Promise<string> {
  const parts: string[] = [];
  try {
    const adapter = await (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu?.requestAdapter();
    const info = adapter?.info;
    parts.push(info ? `webgpu: ${[info.vendor, info.architecture, info.description].filter(Boolean).join(' ')}` : 'webgpu: нет адаптера');
  } catch (err) {
    parts.push(`webgpu: ${String(err)}`);
  }
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  parts.push(`webgl: ${gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? 'есть' : 'нет'}`);
  return parts.join(' | ');
}
