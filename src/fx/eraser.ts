// Ластик и следы на листе наброска.
//
// В главе с наброском зажатая кнопка превращает линзу в ластик: где она прошла,
// рисунок стёрт до бумаги и остаётся стёртым, пока кнопку держат. Отпустил — каждое
// стёртое место рисуется заново в том же порядке, что и весь набросок.
//
// Всё это помнит одна текстура вполовину экрана — «состояние листа»:
//   r — насколько место перерисовано: 1 — рисунок цел, 0 — только что стёрто;
//   g — бумагу здесь тёрли (она чуть светлее и глаже), сходит за четверть минуты;
//   b — крошка ластика: рождаются на кромке, пока ластик движется, и тают;
//   a — графитовое пятно там, где посетитель ткнул в Тето пальцем.
// Набросок читает её в skins/sketch.ts. Пока следов нет, проход не выполняется вовсе.
import * as THREE from 'three/webgpu';
import { Fn, clamp, dot, float, floor, fract, length, max, min, mix, sin, smoothstep, step, texture, uniform, uv, vec2, vec4 } from 'three/tsl';
import type { Frame, Part, Poke } from '../core/contracts';
import { hash21 } from '../skins/context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const REDRAW = 1.9; // за сколько секунд стёртое место рисуется заново
const RUB = 14; // сколько секунд заметно, что бумагу тёрли
const CRUMB = 7; // сколько живёт крошка
const SMUDGE = 20; // сколько держится пятно от тычка
const CELL = 4; // крошка занимает клетку в столько точек текстуры

// Чистый лист: рисунок цел, следов нет. Стоит в шейдере, пока ластик не создан.
const blank = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1);
blank.needsUpdate = true;
/** Состояние листа: что в каком канале — см. шапку файла. */
export const sheetState: N = texture(blank);

export interface Eraser extends Part {
  /** 0…1: насколько линза сейчас работает ластиком, а не окном в соседнюю шкуру. */
  readonly erase: number;
  /** То же, но отпускает медленно: пока не 0, чернильный след за линзой не показывается. */
  readonly hold: number;
}

/** @param index номер главы с наброском */
export function createEraser(renderer: THREE.WebGPURenderer, index: number): Eraser {
  const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  let read = new THREE.RenderTarget(2, 2, options);
  let write = new THREE.RenderTarget(2, 2, options);
  const prev: N = texture(read.texture);

  const u = {
    from: uniform(new THREE.Vector2(0.5, 0.5)), // где ластик был кадр назад, uv
    to: uniform(new THREE.Vector2(0.5, 0.5)),
    aspect: uniform(1),
    radius: uniform(0.2), // в долях высоты экрана
    strength: uniform(0),
    grow: uniform(0), // на сколько за кадр подрастает перерисовка
    rubKeep: uniform(1),
    crumbFade: uniform(0),
    crumbRate: uniform(0),
    smudgeKeep: uniform(1),
    clock: uniform(0),
    size: uniform(new THREE.Vector2(2, 2)), // размер текстуры в точках
    poke: uniform(new THREE.Vector3(0.5, 0.5, 0)), // x, y и «ткнули в этом кадре»
    wipe: uniform(1), // 1 — вернуть чистый лист
  };

  const material = new THREE.NodeMaterial();
  material.fragmentNode = Fn(() => {
    const p: N = uv();
    const old: N = prev.sample(p);
    const asp = vec2(u.aspect, 1);

    // Ластик — отрезок от прошлого положения к текущему, как и чернильный след.
    const pa: N = p.sub(u.from).mul(asp);
    const ba: N = u.to.sub(u.from).mul(asp);
    const h: N = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1);
    const d: N = length(pa.sub(ba.mul(h)));
    // Край неровный, как у настоящей резинки, а не циркульный круг.
    const wobble: N = sin(p.x.mul(91.0).add(p.y.mul(57.0))).mul(sin(p.y.mul(133.0).sub(p.x.mul(41.0)))).mul(0.04).add(1.0);
    const R: N = u.radius.mul(wobble);
    const rubbed: N = float(1).sub(smoothstep(R.mul(0.8), R, d)).mul(u.strength);

    const redrawn: N = mix(min(old.r.add(u.grow), 1.0), 0.0, rubbed);
    const worn: N = max(old.g.mul(u.rubKeep), rubbed);

    // Крошки: клетки на кромке ластика, изредка и только пока он движется.
    const grid: N = p.mul(u.size).div(CELL);
    const cell: N = floor(grid);
    const tick: N = floor(u.clock.mul(20.0));
    const dice: N = hash21(cell.add(vec2(tick.mul(7.3), tick.mul(3.1))));
    const rim: N = smoothstep(R.mul(0.62), R.mul(0.85), d).mul(float(1).sub(smoothstep(R.mul(0.95), R.mul(1.1), d)));
    const born: N = step(float(1).sub(u.crumbRate), dice).mul(rim).mul(u.strength);
    // У каждой крошки своя вытянутость и размер.
    const inCell: N = fract(grid).sub(0.5);
    const squash: N = hash21(cell.add(17.0)).mul(0.9).add(0.8);
    const body: N = float(1).sub(smoothstep(0.12, 0.4, length(inCell.mul(vec2(1.0, squash)))));
    const crumbs: N = max(old.b.sub(u.crumbFade), born.mul(body).mul(dice.mul(0.4).add(0.6)));

    const fromPoke: N = length(p.sub(u.poke.xy).mul(asp));
    const smudge: N = max(old.a.mul(u.smudgeKeep), float(1).sub(smoothstep(0.008, 0.06, fromPoke)).mul(u.poke.z));

    return mix(vec4(redrawn, worn, max(crumbs, 0.0), smudge), vec4(1, 0, 0, 0), u.wipe);
  })();

  const quad = new THREE.QuadMesh(material);
  const buffer = new THREE.Vector2();
  let state: unknown;
  let primed = false;
  let life = 0; // сколько секунд ещё есть что считать
  let dirty = true; // текстуру надо вернуть к чистому листу
  let poked: Poke | null = null;
  let erase = 0;
  let hold = 0;

  const pass = () => {
    state = THREE.RendererUtils.resetRendererState(renderer, state as never);
    prev.value = read.texture;
    renderer.setRenderTarget(write);
    quad.render(renderer);
    THREE.RendererUtils.restoreRendererState(renderer, state as never);
    sheetState.value = write.texture;
    [read, write] = [write, read];
  };

  return {
    get erase() {
      return erase;
    },
    get hold() {
      return hold;
    },
    reset() {
      primed = false;
      poked = null;
      erase = 0;
      hold = 0;
      life = 0;
      dirty = true;
    },
    poke(e) {
      // Пятно остаётся, только если попали в неё: по пустому листу тычок следа не даёт.
      if (e.zone) poked = e;
    },
    step({ dt, t, still, chapter, q, aspect, pointer, lens }: Frame) {
      // Ластик работает в главе с наброском, когда линза уже раскрылась.
      erase = chapter === index && q > 0.14 ? pointer.press : 0;
      hold = Math.max(erase, hold - dt / 1.3);

      renderer.getDrawingBufferSize(buffer);
      const w = Math.max(2, Math.round(buffer.x / 2));
      const h = Math.max(2, Math.round(buffer.y / 2));
      if (w !== read.width || h !== read.height) {
        read.setSize(w, h);
        write.setSize(w, h);
        u.size.value.set(w, h);
        dirty = true;
      }

      if (erase > 0.02 || poked) life = SMUDGE + 2;
      if (!dirty && life <= 0) return;

      if (!primed) {
        u.to.value.set(pointer.x, pointer.y);
        primed = true;
      }
      u.from.value.copy(u.to.value);
      u.to.value.set(pointer.x, pointer.y);
      const speed = dt > 1e-4 ? Math.hypot((u.to.value.x - u.from.value.x) * aspect, u.to.value.y - u.from.value.y) / dt : 0;

      u.aspect.value = aspect;
      u.radius.value = lens;
      u.strength.value = erase;
      // Пока кнопку держат, стёртое не возвращается; при «уменьшении движения» возвращается сразу.
      u.grow.value = (still ? 1 : dt / REDRAW) * (1 - Math.min(1, erase * 4));
      u.rubKeep.value = Math.exp(-dt / RUB);
      u.crumbFade.value = still ? 1 : dt / CRUMB;
      u.crumbRate.value = still ? 0 : 5e-3 * Math.min(1, speed * 3);
      u.smudgeKeep.value = Math.exp(-dt / SMUDGE);
      u.clock.value = t;
      if (poked) u.poke.value.set(poked.x, poked.y, 1);
      else u.poke.value.z = 0;
      poked = null;

      life -= dt;
      // Следы сошли — возвращаем ровно чистый лист и перестаём считать.
      const done = life <= 0;
      u.wipe.value = dirty || done ? 1 : 0;
      dirty = false;
      pass();
      if (done) life = 0;
    },
  };
}
