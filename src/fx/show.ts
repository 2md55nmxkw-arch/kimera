// Шоу под музыку: пока играет пластинка, гримёрку закрывает задник, и сцена живёт
// в такт песне.
//
// Это своё оформление по мотивам песни, а не копия её клипа: рисунок клипа принадлежит
// авторам, и сам клип играет рядом, в плеере. Отсюда берутся только настроение и то,
// что нельзя присвоить, — у песни про гипноз крутится спираль.
//
// Устройство театральное. С колосников опускается задник — полотно за спиной Тето,
// перед декорацией. На нём узор, который целиком считается из секунды песни: доля,
// такт, восьмитактовый блок. Поэтому шоу не нужно ничего помнить, оно попадает в
// музыку после паузы и перемотки и одинаково на контрольных кадрах.
//
// Шоу «гипноз» (Mesmerizer) чередует два состояния по восемь тактов, как и танец:
//   · танец — лучи вокруг головы, кольца от центра на каждую долю, конфетти,
//     цвета меняются раз в два такта;
//   · транс — чёрно-белая спираль, свет гаснет, камера медленно наезжает.
// Новое состояние раскрывается кругом из центра.
//
// Про мигание. Доля песни — три раза в секунду, на этой частоте большие площади
// мигать не должны (от этого бывает плохо). Поэтому на долю двигаются только тонкие
// линии и близкие по светлоте цвета, а всё контрастное меняется раз в такт и реже.
// При «уменьшении движения» шоу не включается вовсе.
import * as THREE from 'three/webgpu';
import { abs, atan, exp, float, fract, fwidth, length, log, min, mix, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';

import { allocateId, tag } from '../core/gbuffer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Что пластинка знает о своём шоу. */
export interface ShowInfo {
  /** Какое шоу. Пока одно. */
  kind: 'hypno';
  /** Два цвета пластинки — они же цвета шоу. */
  colors: [string, string];
  /** Темп песни, ударов в минуту. */
  bpm: number;
  /** Секунда песни, с которой считаются такты (вступает бит). */
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
  reset(): void;
}

const INK = '#0b0b0c';
const PAPER = '#f4efe4';
const TAU = Math.PI * 2;
/** Задник: размер, где висит, и где на нём середина узора (за головой Тето). */
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
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
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
  let leaving = false; // пластинку сняли: полотно уходит, узор на нём пока прежний
  let down = 0; // 0…1: насколько задник опущен

  const u = {
    spin: uniform(0), // поворот спирали, обороты
    turn: uniform(0), // поворот лучей, доли пары лучей
    ring: uniform(0), // ход колец: раз в долю рождается новое
    centre: uniform(new THREE.Vector2()), // середина узора на полотне, метры от его середины
    kick: uniform(0), // удар доли: 1 на долю и быстро спадает
    iris: uniform(9), // радиус круга, которым раскрывается новое состояние, метры
    inner: uniform(0), // что внутри круга: 0 — транс, 1 — танец
    gain: uniform(1), // общая яркость
    c1: uniform(new THREE.Color(INK)), // лучи: два близких тона
    c2: uniform(new THREE.Color(INK)),
    c3: uniform(new THREE.Color(PAPER)), // кольца и круг за головой
    glow: uniform(new THREE.Color(PAPER)), // отсвет в середине спирали
  };
  const ink: N = vec3(...new THREE.Color(INK).toArray());
  const paper: N = vec3(...new THREE.Color(PAPER).toArray());

  // ── задник ────────────────────────────────────────────────────────────
  const cloth = new THREE.MeshBasicNodeMaterial();
  {
    const p: N = positionLocal.xy.sub(u.centre);
    const px: N = fwidth(positionLocal.x).add(1e-5); // метров в одной точке экрана
    const far: N = length(p);
    const r: N = far.mul(float(1).sub(u.kick.mul(0.03))); // на долю узор чуть раздаётся
    const around: N = atan(p.y, p.x).div(TAU);
    const soft = (value: N, width: N): N => smoothstep(float(0.5).sub(width), float(0.5).add(width), abs(fract(value).mul(2).sub(1)));

    // Транс: спираль в два рукава, к середине — отсвет цвета пластинки.
    const coil: N = soft(around.mul(2).add(log(r.add(0.04)).mul(0.85)).sub(u.spin), min(px.mul(1.9).div(r.add(0.02)), 0.5));
    const trance: N = mix(mix(ink, paper, coil), u.glow, exp(r.mul(-2.6)).mul(0.6));

    // Танец: лучи двух близких тонов, поверх — кольца и круг за головой.
    const rays: N = soft(around.mul(7).add(u.turn), min(px.mul(2.3).div(r.add(0.02)), 0.5));
    let dance: N = mix(u.c1, u.c2, rays);
    const reach = 2.6;
    for (let k = 0; k < 2; k++) {
      const at: N = fract(u.ring.add(k / 2)).mul(reach);
      const line: N = smoothstep(px.add(0.022), float(0.022), abs(r.sub(at))).mul(float(1).sub(at.div(reach)));
      dance = mix(dance, u.c3, line);
    }
    dance = mix(dance, u.c3, smoothstep(px.add(0.36), float(0.36), r));
    dance = mix(dance, ink, smoothstep(px.add(0.012), float(0.012), abs(r.sub(0.3))));

    // Новое состояние раскрывается кругом из середины; по кромке круга — линия.
    const inside: N = smoothstep(u.iris.add(px), u.iris, far);
    let color: N = mix(trance, dance, mix(float(1).sub(inside), inside, u.inner));
    color = mix(color, ink, smoothstep(px.add(0.02), float(0.02), abs(far.sub(u.iris))));
    // К краям полотно темнее: взгляд держится в середине.
    cloth.colorNode = color.mul(u.gain).mul(float(1).sub(smoothstep(1.1, 3, far).mul(0.4)));
  }
  const drop = new THREE.Mesh(new THREE.PlaneGeometry(WIDE, TALL), cloth);
  drop.position.set(0, MIDDLE, DEPTH);
  tag(drop, allocateId());
  root.add(drop);

  // ── конфетти ──────────────────────────────────────────────────────────
  const bits = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.05, 0.028),
    new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }),
    PIECES,
  );
  bits.frustumCulled = false;
  tag(bits, allocateId());
  root.add(bits);
  const tint = new THREE.Color();
  const paint = (colors: string[]) => {
    for (let i = 0; i < PIECES; i++) bits.setColorAt(i, tint.set(colors[i % colors.length]));
    if (bits.instanceColor) bits.instanceColor.needsUpdate = true;
  };
  paint([PAPER]);
  let flurry = 0; // 0…1: насколько конфетти сыплется

  const want = { c1: new THREE.Color(), c2: new THREE.Color(), c3: new THREE.Color() };
  const A = new THREE.Color();
  const B = new THREE.Color();
  const mat = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const size = new THREE.Vector3();

  const show: Show = {
    root,
    zoom: 0,
    set(next) {
      if (next) leaving = false;
      if (next === info) return;
      if (next) {
        A.set(next.colors[0]);
        B.set(next.colors[1]);
        (u.glow.value as THREE.Color).copy(A);
        paint([next.colors[0], next.colors[1], PAPER, next.colors[0], INK]);
      }
      // Пока полотно уходит, узор на нём остаётся прежним.
      if (next || down <= 0) info = next;
      else leaving = true;
    },
    reset() {
      info = null;
      leaving = false;
      down = 0;
      flurry = 0;
      show.zoom = 0;
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
      if (!root.visible || !info) return;

      drop.position.y = MIDDLE + (1 - settle(down)) * FLOWN;
      // Середина узора — там, где луч от камеры через голову Тето упирается в полотно.
      const along = (DEPTH - eye.z) / (0 - eye.z);
      (u.centre.value as THREE.Vector2).set(eye.x * (1 - along), eye.y + (HEAD - eye.y) * along - drop.position.y);

      const beat = ((song - info.drop) * info.bpm) / 60;
      const on = beat >= 0;
      const whole = Math.floor(beat);
      const part = beat - whole; // место внутри доли
      const block = Math.floor(beat / 32);
      const into = beat - block * 32; // доль от начала блока
      const dancing = on && block % 2 === 0;
      const kick = on ? Math.exp(-part * 5) : 0;

      u.kick.value = kick * live;
      // Спираль идёт ровно и на каждую долю чуть подталкивается.
      u.spin.value = song * 0.1 + (on ? (whole + easeOut(part)) * 0.035 : 0);
      // Лучи на долю проворачиваются на четверть пары и доезжают.
      u.turn.value = on ? (whole + easeOut(part * 1.6)) * 0.25 : 0;
      u.ring.value = on ? beat / 2 : 0;
      // До первого удара — транс во всё полотно; дальше каждое состояние раскрывается кругом.
      u.inner.value = dancing ? 1 : 0;
      u.iris.value = on ? easeOut(into / 1.6) * 4.4 : 9;

      // Цвета танца меняются раз в два такта: свой цвет, второй цвет, светлая смена.
      const scheme = on ? Math.floor(beat / 8) % 3 : 0;
      if (scheme === 0) {
        want.c1.copy(A);
        want.c2.copy(A).multiplyScalar(0.78);
        want.c3.copy(B);
      } else if (scheme === 1) {
        want.c1.copy(B);
        want.c2.copy(B).multiplyScalar(0.8);
        want.c3.copy(A);
      } else {
        want.c1.set(PAPER);
        want.c2.set(PAPER).multiplyScalar(0.86);
        want.c3.copy(A);
      }
      const k = 1 - Math.exp(-dt * 9);
      (u.c1.value as THREE.Color).lerp(want.c1, k);
      (u.c2.value as THREE.Color).lerp(want.c2, k);
      (u.c3.value as THREE.Color).lerp(want.c3, k);

      // Перед первым ударом музыка на миг смолкает — гаснет и полотно.
      const hush = smooth((info.drop - song) / 0.06) * smooth((song - (info.drop - 0.26)) / 0.06);
      u.gain.value = (0.3 + 0.7 * live) * (1 + 0.05 * kick * live) * (1 - 0.92 * hush);

      // Камера: в танце чуть вздрагивает на долю, в трансе медленно наезжает.
      const push = dancing ? 0.005 * kick + 0.018 * Math.exp(-into * 0.9) : on ? 0.022 * smooth(into / 30) : 0;
      show.zoom = push * live * smooth(down);

      // Контровой свет сцены (его только что поставила глава) уходит в цвет узора.
      const lit = live * smooth(down);
      rim.color.lerp(u.c3.value as THREE.Color, lit);
      rim.intensity += ((dancing ? 2.4 * (0.6 + 0.4 * kick) : 0.6) - rim.intensity) * lit;

      // Конфетти: только в танце. Каждый кусочек падает по своей дорожке, всё — от секунды песни.
      flurry = clamp01(flurry + ((dancing ? 1 : 0) * live > 0.5 ? dt : -dt) / 0.6);
      bits.visible = flurry > 0.001;
      if (bits.visible) {
        const tall = 3.1;
        for (let i = 0; i < PIECES; i++) {
          const speed = 0.45 + hash(i, 1) * 0.6;
          const fall = (song * speed + hash(i, 2) * tall) % tall;
          const sway = Math.sin(song * (1.3 + hash(i, 3) * 1.6) + hash(i, 4) * TAU);
          at.set((hash(i, 5) - 0.5) * 3.4 + sway * 0.07, 2.75 - fall + drop.position.y - MIDDLE, DEPTH + 0.08 + hash(i, 6) * 1.15);
          euler.set(song * (2 + hash(i, 7) * 4), song * (1 + hash(i, 8) * 3), hash(i, 9) * TAU + sway);
          const grow = smooth(flurry) * (0.7 + hash(i, 10) * 0.7);
          mat.compose(at, rot.setFromEuler(euler), size.setScalar(grow));
          bits.setMatrixAt(i, mat);
        }
        bits.instanceMatrix.needsUpdate = true;
      }
    },
  };
  show.reset();
  return show;
}
