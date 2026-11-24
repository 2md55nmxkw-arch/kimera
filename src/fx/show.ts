// Шоу под музыку: пока играет пластинка, гримёрку закрывает задник, и сцена живёт
// в такт песне.
//
// Это своё оформление по мотивам песни, а не копия её клипа: рисунок клипа принадлежит
// авторам, и сам клип играет рядом, в плеере. Отсюда берутся только настроение и то,
// что нельзя присвоить, — у песни про гипноз крутится спираль.
//
// Устройство театральное. С колосников опускается задник — полотно за спиной Тето,
// перед декорацией. На нём узор песни (fx/show-patterns.ts), который целиком считается
// из секунды песни. К узору — конфетти, контровой свет в его цвет и лёгкий наезд
// камеры; чего и сколько, каждый кадр говорит сам узор.
//
// Про мигание. Доля песни — около трёх раз в секунду, на этой частоте большие площади
// мигать не должны (от этого бывает плохо). Поэтому на долю двигаются только тонкие
// линии и близкие по светлоте цвета, а всё контрастное меняется раз в такт и реже.
// При «уменьшении движения» шоу не включается вовсе.
import * as THREE from 'three/webgpu';
import { float, fwidth, length, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';

import { allocateId, tag } from '../core/gbuffer';
import { PATTERNS, type Ask, type Beat, type Canvas, type Pattern, type ShowKind } from './show-patterns';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Что пластинка знает о своём шоу. */
export interface ShowInfo {
  /** Какой узор (fx/show-patterns.ts). */
  kind: ShowKind;
  /** Два цвета пластинки — они же цвета шоу. */
  colors: [string, string];
  /** Темп песни, ударов в минуту. */
  bpm: number;
  /** Секунда песни, с которой считаются такты (вступает бит). Не знаем — 0. */
  drop: number;
}

export interface Show {
  /** Всё, что шоу добавляет на сцену. */
  root: THREE.Object3D;
  /** Какая пластинка стоит (null — никакой): задник опускается или уходит. */
  set(info: ShowInfo | null): void;
  /**
   * Раз в кадр.
   * @param song  секунда песни
   * @param live  0…1: музыка идёт (на паузе шоу замирает и тускнеет)
   * @param still включено «уменьшение движения» — шоу не показываем
   * @param eye   где камера, мир
   */
  step(dt: number, song: number, live: number, still: boolean, eye: THREE.Vector3): void;
  /** На сколько камере наехать в этом кадре, доли. */
  zoom: number;
  /** 0…1: насколько задник опущен. Пока он опущен, линза на курсоре не нужна. */
  cover: number;
  reset(): void;
}

const INK = '#0b0b0c';
const PAPER = '#f4efe4';
const TAU = Math.PI * 2;
/** Задник: размер и где висит. */
const WIDE = 5.4;
const TALL = 3.5;
const DEPTH = -0.75;
const MIDDLE = 1.55; // высота середины полотна
const HEAD = 1.4; // высота головы Тето: середина узора встаёт за ней, откуда бы ни смотрела камера
const FLOWN = 3.8; // на сколько задник поднят, когда убран
const PIECES = 90; // конфетти

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
/** Доезжает с небольшим проскоком: полотно садится на место и чуть отыгрывает. */
const settle = (x: number) => {
  const u = clamp01(x) - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
};
/** Постоянное «случайное» число 0…1 для номера. */
const hash = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** @param rim контровой свет сцены: шоу красит его в цвет узора, по волосам идёт цветная кромка */
export function createShow(rim: THREE.DirectionalLight): Show {
  const root = new THREE.Group();
  let info: ShowInfo | null = null;
  let next: ShowInfo | null = null; // другая пластинка ждёт, пока узор погаснет
  let leaving = false; // пластинку сняли: полотно уходит, узор на нём пока прежний
  let down = 0; // 0…1: насколько задник опущен
  let shown = 1; // 0…1: узор виден (гаснет на смену пластинки)
  let flurry = 0; // 0…1: насколько конфетти сыплется
  let pattern: Pattern | null = null;

  const u = {
    centre: uniform(new THREE.Vector2()), // середина узора на полотне, метры от его середины
    kick: uniform(0), // удар доли: 1 на долю и быстро спадает
    gain: uniform(1), // общая яркость
    a: uniform(new THREE.Color(INK)), // цвета пластинки
    b: uniform(new THREE.Color(PAPER)),
  };
  const p: N = positionLocal.xy.sub(u.centre);
  const far: N = length(p);
  const canvas: Canvas = {
    p,
    far,
    px: fwidth(positionLocal.x).add(1e-5),
    kick: u.kick,
    a: u.a,
    b: u.b,
    ink: vec3(...new THREE.Color(INK).toArray()),
    paper: vec3(...new THREE.Color(PAPER).toArray()),
  };

  // ── задник ────────────────────────────────────────────────────────────
  // У каждого узора свой материал; собирается, когда узор понадобился впервые.
  const built = new Map<ShowKind, { material: THREE.Material; pattern: Pattern }>();
  const drop = new THREE.Mesh(new THREE.PlaneGeometry(WIDE, TALL));
  drop.position.set(0, MIDDLE, DEPTH);
  tag(drop, allocateId());
  root.add(drop);

  // ── конфетти ──────────────────────────────────────────────────────────
  const bits = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.028), new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }), PIECES);
  bits.frustumCulled = false;
  tag(bits, allocateId());
  root.add(bits);
  const tint = new THREE.Color();
  const A = new THREE.Color();
  const B = new THREE.Color();
  const paperColor = new THREE.Color(PAPER);

  /** Поставить пластинку: цвета, узор, конфетти. */
  const use = (to: ShowInfo) => {
    info = to;
    A.set(to.colors[0]);
    B.set(to.colors[1]);
    (u.a.value as THREE.Color).copy(A);
    (u.b.value as THREE.Color).copy(B);
    const colors = [to.colors[0], to.colors[1], PAPER, to.colors[0], INK];
    for (let i = 0; i < PIECES; i++) bits.setColorAt(i, tint.set(colors[i % colors.length]));
    if (bits.instanceColor) bits.instanceColor.needsUpdate = true;

    let made = built.get(to.kind);
    if (!made) {
      const fresh = PATTERNS[to.kind](canvas);
      const material = new THREE.MeshBasicNodeMaterial();
      // К краям полотно темнее: взгляд держится в середине.
      material.colorNode = fresh.color.mul(u.gain).mul(float(1).sub(smoothstep(1.1, 3, far).mul(0.4)));
      made = { material, pattern: fresh };
      built.set(to.kind, made);
    }
    drop.material = made.material;
    pattern = made.pattern;
  };

  const beat: Beat = { dt: 0, song: 0, lead: 0, beat: 0, whole: 0, part: 0, kick: 0, turns: 0, x: 0, A, B };
  const ask: Ask = { flurry: 0, zoom: 0, rim: 1, tint: 'b', dim: 0 };
  const mat = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const size = new THREE.Vector3();

  const show: Show = {
    root,
    zoom: 0,
    cover: 0,
    set(to) {
      if (to) leaving = false;
      if (!to) {
        next = null;
        if (down > 0) leaving = true;
        else info = null;
        return;
      }
      // Полотно ещё не опущено — ставим сразу; опущено — прежний узор сперва погаснет.
      if (!info || down <= 0) use(to);
      else next = to === info ? null : to;
    },
    reset() {
      info = null;
      next = null;
      leaving = false;
      pattern = null;
      down = 0;
      shown = 1;
      flurry = 0;
      show.zoom = 0;
      show.cover = 0;
      root.visible = false;
    },
    step(dt, song, live, still, eye) {
      const up = !info || leaving || still;
      down = clamp01(down + (up ? -dt : dt) / 0.75);
      if (down <= 0 && leaving) {
        info = null;
        leaving = false;
      }
      root.visible = down > 0.001;
      show.zoom = 0;
      show.cover = smooth(down);
      if (!root.visible || !info || !pattern) return;

      // Смена пластинки при опущенном полотне: узор гаснет, меняется, загорается.
      shown = clamp01(shown + (next ? -dt / 0.18 : dt / 0.3));
      if (next && shown <= 0) {
        use(next);
        next = null;
      }

      drop.position.y = MIDDLE + (1 - settle(down)) * FLOWN;
      // Середина узора — там, где луч от камеры через голову Тето упирается в полотно.
      const along = (DEPTH - eye.z) / (0 - eye.z);
      (u.centre.value as THREE.Vector2).set(eye.x * (1 - along), eye.y + (HEAD - eye.y) * along - drop.position.y);

      beat.dt = dt;
      beat.song = song;
      beat.lead = info.drop - song;
      beat.beat = ((song - info.drop) * info.bpm) / 60;
      beat.whole = Math.floor(beat.beat);
      beat.part = beat.beat - beat.whole;
      beat.kick = beat.lead <= 0 ? Math.exp(-beat.part * 5) : 0;
      // Танец идёт вдвое реже песни и связками по восемь долей (actor/dance.ts).
      beat.turns = (song * info.bpm) / 120;
      beat.x = beat.turns % 8;
      ask.flurry = 0;
      ask.zoom = 0;
      ask.rim = 1;
      ask.tint = 'b';
      ask.dim = 0;
      pattern.tick(beat, ask);

      u.kick.value = beat.kick * live;
      u.gain.value = (0.3 + 0.7 * live) * (1 + 0.05 * beat.kick * live) * (1 - ask.dim) * smooth(shown);
      const lit = live * smooth(down);
      show.zoom = ask.zoom * lit;
      // Контровой свет сцены (его только что поставила глава) уходит в цвет узора.
      const hue = ask.tint as Ask['tint']; // узор мог его сменить
      rim.color.lerp(hue === 'a' ? A : hue === 'b' ? B : paperColor, lit);
      rim.intensity += (ask.rim - rim.intensity) * lit;

      // Конфетти: каждый кусочек падает по своей дорожке, всё — от секунды песни.
      flurry = clamp01(flurry + (ask.flurry * live > 0.5 ? dt : -dt) / 0.6);
      bits.visible = flurry > 0.001;
      if (bits.visible) {
        const tall = 3.1;
        for (let i = 0; i < PIECES; i++) {
          const speed = 0.45 + hash(i, 1) * 0.6;
          const fall = (song * speed + hash(i, 2) * tall) % tall;
          const sway = Math.sin(song * (1.3 + hash(i, 3) * 1.6) + hash(i, 4) * TAU);
          at.set((hash(i, 5) - 0.5) * 3.4 + sway * 0.07, 2.75 - fall + drop.position.y - MIDDLE, DEPTH + 0.08 + hash(i, 6) * 1.15);
          euler.set(song * (2 + hash(i, 7) * 4), song * (1 + hash(i, 8) * 3), hash(i, 9) * TAU + sway);
          mat.compose(at, rot.setFromEuler(euler), size.setScalar(smooth(flurry) * (0.7 + hash(i, 10) * 0.7)));
          bits.setMatrixAt(i, mat);
        }
        bits.instanceMatrix.needsUpdate = true;
      }
    },
  };
  show.reset();
  return show;
}
