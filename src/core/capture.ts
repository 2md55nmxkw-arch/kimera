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
import type * as THREE from 'three/webgpu';
import type { Actor } from '../actor';
import type { StepEnv } from './contracts';

export interface Rig {
  canvas: HTMLCanvasElement;
  backend: 'webgpu' | 'webgl';
  camera: THREE.PerspectiveCamera;
  actor: Actor;
  pointer: { x: number; y: number; tx: number; ty: number; press: number; pressTarget: number };
  /** Ручные подмены: draw ≥ 0 останавливает ход рисования наброска. */
  debugView: { draw: number };
  u: { raw: { value: number } };
  resizeTo(width: number, height: number, dpr: number): void;
  resize(): void;
  reset(): void;
  step(dt: number, env: StepEnv): void;
  render(): void;
}

export interface Shot {
  name: string;
  s: number;
  /** Центр линзы, доли экрана от левого верхнего угла. */
  pointer: [number, number];
  press?: number;
  draw?: number;
  raw?: number;
  size?: [number, number];
  /** Сколько шагов по 1/60 с отсчитать перед снимком (по умолчанию 150). */
  frames?: number;
  /** Вызывается перед каждым шагом: двигать указатель, запускать реакции. */
  each?(rig: Rig, frame: number, frames: number): void;
}

const CORNER: [number, number] = [0.1, 0.86]; // линза в углу, персонаж открыт

export const SHOTS: Shot[] = [
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

const post = (path: string, body: BodyInit) => fetch(path, { method: 'POST', body });

/** Снять все кадры (или только названные) в набор `set`. */
export async function runShots(rig: Rig, set: string, only?: string[]): Promise<string[]> {
  const taken: string[] = [];
  for (const shot of SHOTS) {
    if (only && !only.includes(shot.name)) continue;
    const [w, h] = shot.size ?? [1280, 720];
    rig.resizeTo(w, h, 1);
    rig.reset();
    const [x, y] = shot.pointer;
    const press = shot.press ?? 0;
    Object.assign(rig.pointer, { x, y, tx: x, ty: y, press, pressTarget: press });
    rig.debugView.draw = shot.draw ?? -1;
    rig.u.raw.value = shot.raw ?? 0;

    const frames = shot.frames ?? 150;
    for (let f = 0; f < frames; f++) {
      shot.each?.(rig, f, frames);
      rig.step(1 / 60, { s: shot.s, still: false, roam: false });
    }
    rig.render();
    // Снимать холст нужно сразу после рендера, в той же задаче: потом кадр уйдёт на экран.
    const png = await (await fetch(rig.canvas.toDataURL('image/png'))).blob();
    await post(`/__shots/save?set=${set}&name=${shot.name}`, png);
    taken.push(shot.name);
  }

  rig.debugView.draw = -1;
  rig.u.raw.value = 0;
  rig.reset();
  rig.resize();
  await post(`/__shots/done?set=${set}`, JSON.stringify({ backend: rig.backend, gpu: await gpuName(), shots: taken }));
  return taken;
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
