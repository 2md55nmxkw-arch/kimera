// Узоры шоу: что нарисовано на заднике под каждую песню (само шоу — fx/show.ts).
//
// Узор — это формула цвета от точки полотна плюс несколько величин, которые раз в
// кадр считаются из секунды песни. Своей памяти у узора нет: он попадает в музыку
// после паузы и перемотки и одинаков на контрольных кадрах.
//
// Каждый узор придуман по теме своей песни и ходит в ногу с её танцем (actor/dance.ts):
// танец — связка на восемь долей, узор знает, какая фигура сейчас идёт. Это своё
// оформление, а не копия клипов: из песни берётся тема, рисунок — наш.
//
// Правило про мигание (см. fx/show.ts): на долю двигается только мелкое и неконтрастное.
import * as THREE from 'three/webgpu';
import { abs, atan, cos, dot, exp, float, floor, fract, length, log, max, min, mix, mod, select, sign, sin, smoothstep, sqrt, step, uniform, vec2 } from 'three/tsl';

import { hash21 } from '../skins/context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export type ShowKind = 'hypno' | 'glitch' | 'blocks' | 'liar' | 'clinic' | 'crowd' | 'machine' | 'cute';

/** Что узору дано: место на полотне и общие величины. */
export interface Canvas {
  /** Метры от середины узора (она за головой Тето): x — вправо на экране, y — вверх. */
  p: N;
  /** Расстояние от середины. */
  far: N;
  /** Метров в одной точке экрана: ширина сглаженного края. */
  px: N;
  /** Удар доли песни: 1 на долю и быстро спадает. */
  kick: N;
  /** Два цвета пластинки. */
  a: N;
  b: N;
  ink: N;
  paper: N;
}

/** Что известно о кадре. */
export interface Beat {
  dt: number;
  /** Секунда песни. */
  song: number;
  /** Сколько секунд до вступления бита (отрицательное — уже вступил). */
  lead: number;
  /** Доля песни от вступления бита: целая часть и место внутри доли. */
  beat: number;
  whole: number;
  part: number;
  kick: number;
  /** Сколько долей танца прошло (он идёт вдвое реже песни) и место в его связке, 0…8. */
  turns: number;
  x: number;
  /** Цвета пластинки. */
  A: THREE.Color;
  B: THREE.Color;
}

/** Что узор просит у сцены в этом кадре. */
export interface Ask {
  /** Конфетти, 0…1. */
  flurry: number;
  /** Наезд камеры, доли. */
  zoom: number;
  /** Сила контрового света и его цвет. */
  rim: number;
  tint: 'a' | 'b' | 'paper';
  /** 0…1: приглушить полотно. */
  dim: number;
}

export interface Pattern {
  color: N;
  tick(t: Beat, ask: Ask): void;
}

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
/** Окно внутри связки: открывается с доли from, закрывается с доли to. */
const win = (x: number, from: number, to: number, soft = 0.3) => smooth((x - from) / soft) * (1 - smooth((x - to) / soft));
/** Вспышка фигуры: выскакивает на доле k и держится почти до следующей. */
const pop = (x: number, k: number) => win(x, k, k + 0.82, 0.16);

/** 1 там, где d меньше edge; край шириной px. */
const below = (d: N, edge: N | number, px: N): N => float(1).sub(smoothstep(float(edge), float(edge).add(px), d));
/** Полосы 0/1 по дробной части value; width — ширина края. */
const wave = (value: N, width: N): N => smoothstep(float(0.5).sub(width), float(0.5).add(width), abs(fract(value).mul(2).sub(1)));
const turned = (p: N, angle: N): N => vec2(p.x.mul(cos(angle)).sub(p.y.mul(sin(angle))), p.x.mul(sin(angle)).add(p.y.mul(cos(angle))));
/** Расстояние до прямоугольника с полуразмерами half. */
const boxDist = (p: N, half: N): N => {
  const q: N = abs(p).sub(half);
  return length(max(q, 0)).add(min(max(q.x, q.y), 0));
};
const dot2 = (v: N): N => dot(v, v);
/** До ближайшей линии сетки с шагом cell, метры. */
const toGrid = (p: N, cell: number): N => {
  const near = (v: N): N => float(0.5).sub(abs(fract(v.div(cell)).sub(0.5))).mul(cell);
  return min(near(p.x), near(p.y));
};

/**
 * Значения по ключам связки: каждый ключ — [доля, числа…]; к ключу идут move долей,
 * до того держится предыдущий. Связка замкнута: после последнего ключа — первый.
 */
function keyed(x: number, keys: number[][], move: number, out: number[]): void {
  let j = 0;
  while (j < keys.length && keys[j][0] <= x) j++;
  const next = keys[j % keys.length];
  const prev = keys[(j - 1 + keys.length) % keys.length];
  const end = j < keys.length ? next[0] : next[0] + 8;
  const u = clamp01((x - (end - move)) / move);
  const t = u * u * u * (u * (u * 6 - 15) + 10);
  for (let i = 1; i < next.length; i++) out[i - 1] = prev[i] + (next[i] - prev[i]) * t;
}

export const PATTERNS: Record<ShowKind, (c: Canvas) => Pattern> = {
  // ── Гипноз (Mesmerizer) ────────────────────────────────────────────────
  // Два состояния по восемь тактов, как и танец из файла: лучи, кольца и круг за
  // головой — и чёрно-белая спираль. Новое состояние раскрывается кругом из середины.
  hypno({ p, far, px, kick, a, ink, paper }) {
    const spin = uniform(0); // поворот спирали, обороты
    const turn = uniform(0); // поворот лучей, доли пары лучей
    const ring = uniform(0); // ход колец: раз в долю рождается новое
    const iris = uniform(9); // радиус круга, которым раскрывается новое состояние
    const inner = uniform(0); // что внутри круга: 0 — транс, 1 — танец
    const c1 = uniform(new THREE.Color()); // лучи: два близких тона
    const c2 = uniform(new THREE.Color());
    const c3 = uniform(new THREE.Color()); // кольца и круг за головой
    const want = [new THREE.Color(), new THREE.Color(), new THREE.Color()];

    const r: N = far.mul(float(1).sub(kick.mul(0.03))); // на долю узор чуть раздаётся
    const around: N = atan(p.y, p.x).div(TAU);
    const coil: N = wave(around.mul(2).add(log(r.add(0.04)).mul(0.85)).sub(spin), min(px.mul(1.9).div(r.add(0.02)), 0.5));
    const trance: N = mix(mix(ink, paper, coil), a, exp(r.mul(-2.6)).mul(0.6));

    const rays: N = wave(around.mul(7).add(turn), min(px.mul(2.3).div(r.add(0.02)), 0.5));
    let dance: N = mix(c1, c2, rays);
    for (let k = 0; k < 2; k++) {
      const at: N = fract(ring.add(k / 2)).mul(2.6);
      dance = mix(dance, c3, below(abs(r.sub(at)), 0.022, px).mul(float(1).sub(at.div(2.6))));
    }
    dance = mix(dance, c3, below(r, 0.36, px));
    dance = mix(dance, ink, below(abs(r.sub(0.3)), 0.012, px));

    const inside: N = below(far, iris, px);
    let color: N = mix(trance, dance, mix(float(1).sub(inside), inside, inner));
    color = mix(color, ink, below(abs(far.sub(iris)), 0.02, px));

    return {
      color,
      tick(t, ask) {
        const on = t.lead <= 0;
        const block = Math.floor(t.beat / 32);
        const into = t.beat - block * 32; // доль от начала блока
        const dancing = on && block % 2 === 0;
        // Спираль идёт ровно и на каждую долю чуть подталкивается.
        spin.value = t.song * 0.1 + (on ? (t.whole + easeOut(t.part)) * 0.035 : 0);
        // Лучи на долю проворачиваются на четверть пары и доезжают.
        turn.value = on ? (t.whole + easeOut(t.part * 1.6)) * 0.25 : 0;
        ring.value = on ? t.beat / 2 : 0;
        inner.value = dancing ? 1 : 0;
        iris.value = on ? easeOut(into / 1.6) * 4.4 : 9;

        // Цвета танца меняются раз в два такта: свой цвет, второй цвет, светлая смена.
        const scheme = on ? Math.floor(t.beat / 8) % 3 : 0;
        if (scheme === 0) {
          want[0].copy(t.A);
          want[1].copy(t.A).multiplyScalar(0.78);
          want[2].copy(t.B);
        } else if (scheme === 1) {
          want[0].copy(t.B);
          want[1].copy(t.B).multiplyScalar(0.8);
          want[2].copy(t.A);
        } else {
          want[0].set('#f4efe4');
          want[1].set('#f4efe4').multiplyScalar(0.86);
          want[2].copy(t.A);
        }
        const k = 1 - Math.exp(-t.dt * 9);
        (c1.value as THREE.Color).lerp(want[0], k);
        (c2.value as THREE.Color).lerp(want[1], k);
        (c3.value as THREE.Color).lerp(want[2], k);

        // Перед первым ударом музыка на миг смолкает — гаснет и полотно.
        ask.dim = t.lead > 0 ? smooth(t.lead / 0.06) * smooth((0.26 - t.lead) / 0.06) * 0.92 : 0;
        // Камера: в танце чуть вздрагивает на долю, в трансе медленно наезжает.
        ask.zoom = dancing ? 0.005 * t.kick + 0.018 * Math.exp(-into * 0.9) : on ? 0.022 * smooth(into / 30) : 0;
        ask.rim = dancing ? 2.4 * (0.6 + 0.4 * t.kick) : 0.6;
        ask.tint = scheme === 0 ? 'b' : 'a';
        ask.flurry = dancing ? 1 : 0;
      },
    };
  },

  // ── Сбой (Override) ────────────────────────────────────────────────────
  // Тёмный экран в точку, полоса предупреждающей штриховки, вокруг головы — кольцо
  // «загрузки» на всю связку. Когда танец «заедает», строки экрана разъезжаются.
  glitch({ p, far, px, a, b }) {
    const tear = uniform(0); // насколько разъехались строки
    const seed = uniform(0); // меняется раз в долю танца: другие строки, другие плитки
    const scroll = uniform(0);
    const load = uniform(0); // сколько кольца уже набежало, 0…1

    const row: N = floor(p.y.mul(14));
    const q: N = vec2(p.x.add(hash21(vec2(row, seed)).sub(0.5).mul(tear).mul(0.9)), p.y);
    const dots: N = below(length(fract(q.div(0.12)).sub(0.5)), 0.16, px.div(0.12));
    let color: N = mix(b, mix(b, a, 0.35), dots);
    const belt: N = below(abs(q.y.add(0.44)), 0.17, px);
    color = mix(color, mix(b, a, wave(q.x.add(q.y).mul(1.6).sub(scroll), px.mul(4.6))), belt);
    // Редкие «битые» плитки.
    color = mix(color, a, step(0.94, hash21(floor(q.mul(vec2(2.6, 5.2))).add(seed))).mul(0.8));
    // Кольцо загрузки: бежит по часовой от верхней точки.
    const along: N = fract(atan(p.x, p.y).div(TAU));
    color = mix(color, mix(b, a, 0.3), below(abs(far.sub(0.46)), 0.022, px));
    color = mix(color, a, below(abs(far.sub(0.46)), 0.022, px).mul(step(along, load)));
    // Строки развёртки.
    color = color.mul(sin(p.y.mul(190)).mul(0.07).add(0.93));

    return {
      color,
      tick(t, ask) {
        const jam = win(t.x, 1.25, 1.62, 0.07) + win(t.x, 6.25, 6.62, 0.07);
        seed.value = Math.floor(t.turns);
        tear.value = 0.04 + 0.9 * jam + 0.3 * win(t.x, 3.1, 3.6, 0.1);
        scroll.value = t.song * 0.4;
        load.value = t.x / 8;
        ask.zoom = 0.004 * t.kick + 0.012 * jam;
        ask.rim = 1.8 * (0.6 + 0.4 * t.kick);
        ask.tint = 'a';
      },
    };
  },

  // ── Фигурки (Tetoris) ──────────────────────────────────────────────────
  // Клетчатое поле, по столбцам падают кубики и ложатся в стопки. Когда Тето руками
  // складывает фигуру — Г, обратную Г, Т, палку, — та же фигура встаёт у неё за спиной.
  blocks({ p, px, a, b, ink }) {
    const fall = uniform(0); // на сколько клеток всё упало
    const grow = uniform(0); // фигура за спиной: 0 — нет, 1 — в полный размер
    const cells = [0, 1, 2, 3].map(() => uniform(new THREE.Vector2()));
    const flip = uniform(0); // раз в связку цвета меняются местами
    const SIZE = 0.24;
    const BIG = 0.3;
    const SHAPES: Record<number, number[][]> = {
      4: [[0, 1], [0, 0], [0, -1], [1, -1]],
      5: [[0, 1], [0, 0], [0, -1], [-1, -1]],
      6: [[-1, 0], [0, 0], [1, 0], [0, -1]],
      7: [[0, 1.5], [0, 0.5], [0, -0.5], [0, -1.5]],
    };

    const id: N = floor(p.div(SIZE));
    const f: N = fract(p.div(SIZE)).sub(0.5);
    const tile: N = below(max(abs(f.x), abs(f.y)), 0.43, px.div(SIZE));
    const column: N = id.x;
    const dropped: N = mod(floor(fall.add(hash21(vec2(column, 3)).mul(10))), 10);
    const long: N = floor(hash21(vec2(column, 7)).mul(3)).add(1);
    const fromTop: N = float(4).sub(id.y);
    const piece: N = step(dropped, fromTop).mul(step(fromTop, dropped.add(long).sub(1)));
    const heap: N = step(id.y, float(-4).add(floor(hash21(vec2(column, 11)).mul(3))));
    const ground: N = mix(b, a, flip);
    const brick: N = mix(a, b, flip);
    let color: N = mix(mix(ground, brick, 0.1), ground, tile);
    color = mix(color, brick, max(piece, heap).mul(tile));
    let shape: N = float(0);
    for (const cell of cells) shape = max(shape, below(max(abs(p.x.sub(cell.x.mul(BIG))), abs(p.y.sub(cell.y.mul(BIG)))), grow.mul(BIG * 0.46), px));
    color = mix(color, ink, shape.mul(step(0.02, grow)));

    return {
      color,
      tick(t, ask) {
        fall.value = t.whole + easeOut(t.part * 2.5);
        flip.value += ((Math.floor(t.turns / 8) % 2) - flip.value) * (1 - Math.exp(-t.dt * 8));
        const k = Math.floor(t.x);
        const figure = SHAPES[k];
        grow.value = figure ? pop(t.x, k) : 0;
        if (figure) figure.forEach(([cx, cy], i) => (cells[i].value as THREE.Vector2).set(cx, cy));
        ask.flurry = t.x >= 4 ? 1 : 0;
        ask.zoom = 0.004 * t.kick + 0.01 * grow.value;
        ask.rim = 1.6;
        ask.tint = 'a';
      },
    };
  },

  // ── Обманщица (Liar Dancer) ────────────────────────────────────────────
  // Арлекинские ромбы и два прожектора. Грозит пальцем — луч стоит на этой руке;
  // «тсс» — зал темнеет, лучи сходятся в одно пятно; разводит руками — разбегаются.
  liar({ p, px, a, b, paper }) {
    const slide = uniform(0);
    const one = uniform(new THREE.Vector2());
    const two = uniform(new THREE.Vector2());
    const wide = uniform(0.36);
    const dark = uniform(0);
    const now = [0, 0, 0, 0, 0, 0];
    const KEYS = [
      [0, -0.5, 0.18, 0.5, -0.42, 0.36, 0],
      [2, 0.5, 0.18, -0.5, -0.42, 0.36, 0],
      [4, 0, 0, 0, 0, 0.21, 1],
      [6, -0.85, 0.05, 0.72, 0.05, 0.42, 0],
    ];

    const d: N = vec2(p.x.add(p.y), p.x.sub(p.y)).mul(2.1).add(vec2(slide, 0));
    const edge: N = px.mul(6);
    const check: N = abs(wave(d.x.mul(0.5), edge).sub(wave(d.y.mul(0.5), edge)));
    const hall: N = mix(a, a.mul(0.7), check).mul(mix(float(1), float(0.4), dark));
    const lit: N = mix(b, mix(b, paper, 0.45), check);
    const beam: N = max(below(length(p.sub(one)), wide, px.add(0.03)), below(length(p.sub(two)), wide, px.add(0.03)));
    const color: N = mix(hall, lit, beam);

    return {
      color,
      tick(t, ask) {
        keyed(t.x, KEYS, 0.6, now);
        // «Нет-нет»: луч покачивается вместе с пальцем.
        const wag = Math.sin(TAU * 2 * t.x) * 0.05 * (win(t.x, 0, 1.3) + win(t.x, 2, 3.3));
        (one.value as THREE.Vector2).set(now[0] + wag, now[1]);
        (two.value as THREE.Vector2).set(now[2], now[3]);
        wide.value = now[4];
        dark.value = now[5];
        slide.value = (Math.floor(t.turns) + easeOut((t.turns % 1) * 1.6)) * 0.5;
        ask.flurry = win(t.x, 6, 7.6) > 0.5 ? 1 : 0;
        ask.zoom = 0.004 * t.kick + 0.014 * now[5];
        ask.rim = 1.5 * (1 - 0.6 * now[5]);
        ask.tint = 'b';
      },
    };
  },

  // ── Клиника (Igaku) ────────────────────────────────────────────────────
  // Миллиметровка, по ней бежит кардиограмма: зубец на каждую долю танца. За головой
  // крест, он бьётся как сердце, а на «не годен» поворачивается в косой.
  clinic({ p, px, a, b, ink }) {
    const scroll = uniform(0);
    const pen = uniform(0); // до этого места линия уже начерчена
    const twist = uniform(0);
    const throb = uniform(1);

    let color: N = mix(a, b, below(toGrid(p, 0.07), 0.003, px).mul(0.16).add(below(toGrid(p, 0.35), 0.005, px).mul(0.2)));
    const bump = (u: N, at: number, width: number, tall: number): N => exp(u.sub(at).div(width).mul(u.sub(at).div(width)).negate()).mul(tall);
    const pulse = (u: N): N => bump(u, 0.15, 0.035, 0.12).sub(bump(u, 0.345, 0.012, 0.15)).add(bump(u, 0.38, 0.014, 1)).sub(bump(u, 0.42, 0.014, 0.25)).add(bump(u, 0.62, 0.05, 0.25));
    const phase: N = p.x.mul(1.15).add(scroll);
    const tall = 0.3;
    const y0: N = pulse(fract(phase)).mul(tall).sub(0.52);
    const slope: N = pulse(fract(phase.add(0.004))).mul(tall).sub(0.52).sub(y0).div(0.004 / 1.15);
    const off: N = abs(p.y.sub(y0)).div(sqrt(slope.mul(slope).add(1)));
    const trace: N = below(off, 0.012, px).mul(mix(float(0.22), float(1), step(p.x, pen)));
    color = mix(color, mix(b, ink, 0.4), trace);
    color = mix(color, b, below(abs(p.x.sub(pen)), 0.004, px).mul(0.5));
    const q: N = turned(p, twist).div(throb);
    const cross: N = below(max(min(abs(q.x), abs(q.y)).sub(0.11), max(abs(q.x), abs(q.y)).sub(0.36)), 0, px);
    color = mix(color, b, cross);

    return {
      color,
      tick(t, ask) {
        scroll.value = t.turns;
        pen.value = -1.6 + ((t.turns / 4) % 1) * 2.7;
        twist.value = (Math.PI / 4) * win(t.x, 6.75, 7.85, 0.2);
        throb.value = 1 + 0.07 * Math.exp(-(t.turns % 1) * 6);
        ask.zoom = 0.003 * t.kick;
        ask.rim = 1.2;
        ask.tint = 'b';
      },
    };
  },

  // ── Любительница людей (Hito Mania) ────────────────────────────────────
  // Толпа человечков рядами. Высматривает — по толпе ходит кольцо; «бинокль» — видно
  // только в два круга, крупнее; «вон один!» — человечек под лучом загорается; в конце
  // цвета переворачиваются и вся толпа пляшет.
  crowd({ p, px, a, b, ink, paper }) {
    const near = uniform(1); // приближение в «бинокле»
    const drift = uniform(0);
    const hop = uniform(0);
    const sway = uniform(0);
    const scope = uniform(0); // «бинокль»: 0…1
    const at = uniform(new THREE.Vector2()); // куда она смотрит
    const ring = uniform(0);
    const found = uniform(0);
    const turnover = uniform(0);
    const now = [0, 0];
    const KEYS = [
      [0, 0.55, 0.05],
      [1, -0.7, 0.05],
      [4, 0.62, 0.02],
      [5, -0.72, 0.02],
    ];
    const W = 0.34;
    const H = 0.46;

    const z: N = p.div(near);
    const row: N = floor(z.y.div(H));
    const odd: N = mod(row, 2);
    const gx: N = z.x.div(W).add(odd.mul(0.5)).add(drift.mul(odd.mul(2).sub(1)));
    const who: N = hash21(vec2(floor(gx), row));
    const local: N = vec2(fract(gx).sub(0.5).mul(W), fract(z.y.div(H)).sub(0.5).mul(H).sub(sin(sway.add(who.mul(TAU))).mul(hop).mul(0.03)));
    const fine: N = px.div(near);
    const person: N = max(below(length(local.sub(vec2(0, 0.1))), 0.058, fine), below(boxDist(local.sub(vec2(0, -0.075)), vec2(0.045, 0.06)).sub(0.035), 0, fine));
    const ground: N = mix(a, b, turnover);
    const folk: N = mix(mix(a, ink, 0.45), a, turnover);
    let color: N = mix(ground, folk, person);
    color = mix(color, mix(b, paper, 0.2), person.mul(below(length(p.sub(at)), 0.24, px)).mul(found));
    const glass: N = max(below(length(p.sub(vec2(-0.27, 0))), 0.34, px), below(length(p.sub(vec2(0.27, 0))), 0.34, px));
    color = mix(color, ink, float(1).sub(glass).mul(scope));
    color = mix(color, b, below(abs(length(p.sub(at)).sub(0.3)), 0.014, px).mul(ring));

    return {
      color,
      tick(t, ask) {
        keyed(t.x, KEYS, 0.55, now);
        (at.value as THREE.Vector2).set(now[0], now[1]);
        const party = win(t.x, 6, 7.6);
        sway.value = t.turns * TAU;
        hop.value = 1 + 2 * party;
        drift.value = t.turns * 0.06;
        ring.value = win(t.x, 0, 1.8, 0.2);
        scope.value = win(t.x, 2, 3.85, 0.25);
        near.value = 1 + 0.45 * smooth((t.x - 3) / 0.6) * (1 - smooth((t.x - 3.85) / 0.25));
        found.value = pop(t.x, 4) + pop(t.x, 5);
        turnover.value = party;
        ask.flurry = party > 0.5 ? 1 : 0;
        ask.zoom = 0.004 * t.kick + 0.016 * scope.value * smooth((t.x - 3) / 0.6);
        ask.rim = 1.5;
        ask.tint = 'b';
      },
    };
  },

  // ── Машина (Machine Love) ──────────────────────────────────────────────
  // Шестерни проворачиваются на зубец вместе с её руками — в два щелчка. Потом за
  // спиной вырастает сердце и стучит, от него расходится волна.
  machine({ p, px, a, b, ink, paper }) {
    const notch = uniform(0); // на сколько зубцов провернулось
    const heart = uniform(0); // размер сердца, 0…1
    const thump = uniform(0);
    const ripple = uniform(0);

    const gear = (cx: number, cy: number, radius: number, teeth: number, way: number, shift: number): N => {
      const q: N = p.sub(vec2(cx, cy));
      const r: N = length(q);
      const tooth: N = wave(atan(q.y, q.x).div(TAU).mul(teeth).add(notch.mul(way)).add(shift), min(px.mul(teeth / 3).div(r.add(0.02)), 0.5));
      const body: N = below(r, float(radius).add(tooth.mul(radius * 0.16)), px);
      const hub: N = below(r, radius * 0.2, px);
      const groove: N = below(abs(r.sub(radius * 0.62)), radius * 0.07, px);
      return body.mul(float(1).sub(hub)).mul(float(1).sub(groove.mul(0.6)));
    };
    const works: N = max(max(gear(-0.95, -0.1, 0.45, 12, 1, 0), gear(-0.336, 0.33, 0.3, 8, -1, 0.5)), gear(0.66, -0.3, 0.375, 10, 1, 0.25));
    let color: N = mix(mix(a, paper, 0.3), mix(a, ink, 0.3), works);

    // Сердце: остриё внизу, растёт от него.
    const size: N = heart.mul(0.95).mul(thump.mul(0.07).add(1)).add(1e-4);
    const h: N = vec2(abs(p.x), p.y.add(0.52)).div(size);
    const top: N = length(h.sub(vec2(0.25, 0.75))).sub(Math.SQRT2 / 4);
    const k: N = max(h.x.add(h.y), 0).mul(0.5);
    const side: N = sqrt(min(dot2(h.sub(vec2(0, 1))), dot2(h.sub(vec2(k, k))))).mul(sign(h.x.sub(h.y)));
    const away: N = select(h.x.add(h.y).greaterThan(1), top, side).mul(size);
    color = mix(color, b, below(away, 0, px).mul(step(0.02, heart)));
    color = mix(color, mix(b, paper, 0.4), below(abs(away.sub(ripple)), 0.015, px).mul(step(0.001, ripple)).mul(float(1).sub(ripple.div(0.6))));

    return {
      color,
      tick(t, ask) {
        // Пока руки ходят под прямым углом — два щелчка на долю; дальше шестерни идут ровно.
        const n = Math.floor(t.x);
        const f = t.x - n;
        notch.value = t.x < 4 ? 2 * n + easeOut((f - 0.5) / 0.25) + easeOut((f - 0.75) / 0.25) : 8 + (t.x - 4);
        heart.value = win(t.x, 4, 7.7);
        const lub = t.turns % 1;
        thump.value = Math.exp(-lub * 9) + (lub > 0.28 ? 0.6 * Math.exp(-(lub - 0.28) * 9) : 0);
        ripple.value = t.x >= 6 && t.x < 7 ? (t.x - 6) * 0.6 : 0;
        ask.flurry = t.x >= 7 ? 1 : 0;
        ask.zoom = 0.004 * t.kick + 0.012 * heart.value * thump.value;
        ask.rim = 1.4;
        ask.tint = 'b';
      },
    };
  },

  // ── Озорница (Ochame Kinou) ────────────────────────────────────────────
  // Горошек дышит через один, как её лапки. Лапки топают отпечатками то слева, то
  // справа, на «виктории» вспыхивают искры, а под конец веером ходят карамельные полосы.
  cute({ p, px, a, b, paper }) {
    const breath = uniform(0); // −1…1: какой горошек сейчас крупнее
    const left = uniform(0); // отпечаток слева на экране (её правая лапка)
    const right = uniform(0);
    const sparkLeft = uniform(0);
    const sparkRight = uniform(0);
    const wipe = uniform(0);
    const fan = uniform(0);
    const CELL = 0.26;

    const row: N = floor(p.y.div(CELL));
    const gx: N = p.x.div(CELL).add(mod(row, 2).mul(0.5));
    const parity: N = mod(floor(gx).add(row), 2).mul(2).sub(1);
    const f: N = vec2(fract(gx).sub(0.5), fract(p.y.div(CELL)).sub(0.5)).mul(CELL);
    let color: N = mix(a, mix(a, paper, 0.55), below(length(f), float(0.05).add(parity.mul(breath).mul(0.022)), px));

    const hinge: N = p.add(vec2(0, 1.25));
    const candy: N = wave(atan(hinge.x, hinge.y).div(TAU).add(wipe).mul(18), min(px.mul(6).div(length(hinge).add(0.05)), 0.5));
    color = mix(color, mix(mix(a, paper, 0.5), mix(a, b, 0.25), candy), fan);

    const paw = (cx: number, grow: N): N => {
      const q: N = p.sub(vec2(cx, 0.02)).div(grow.add(1e-3));
      const fine: N = px.div(grow.add(1e-3));
      let print: N = below(length(vec2(q.x, q.y.add(0.07).mul(1.2))), 0.15, fine);
      for (const [tx, ty] of [[-0.17, 0.07], [-0.065, 0.18], [0.065, 0.18], [0.17, 0.07]]) print = max(print, below(length(q.sub(vec2(tx, ty))), 0.052, fine));
      return print.mul(step(0.02, grow));
    };
    color = mix(color, b, max(paw(-0.78, left), paw(0.62, right)));

    const spark = (cx: number, grow: N): N => {
      const q: N = abs(p.sub(vec2(cx, 0.3))).div(grow.mul(0.28).add(1e-3));
      return below(sqrt(q.x).add(sqrt(q.y)), 1, 0.08).mul(step(0.02, grow));
    };
    color = mix(color, paper, max(spark(-0.72, sparkLeft), spark(0.6, sparkRight)));

    return {
      color,
      tick(t, ask) {
        const paws = win(t.x, 0, 3.9, 0.2);
        breath.value = Math.cos(Math.PI * t.x) * (0.3 + 0.7 * paws);
        // Левую лапку она поднимает на чётных долях — на экране это справа.
        right.value = pop(t.x, 0) + pop(t.x, 2);
        left.value = pop(t.x, 1) + pop(t.x, 3);
        sparkLeft.value = pop(t.x, 4);
        sparkRight.value = pop(t.x, 5);
        fan.value = win(t.x, 6, 7.7);
        wipe.value = Math.sin(Math.PI * t.x) * 0.035;
        ask.flurry = fan.value > 0.5 ? 1 : 0;
        ask.zoom = 0.004 * t.kick + 0.008 * (sparkLeft.value + sparkRight.value);
        ask.rim = 1.4;
        ask.tint = 'a';
      },
    };
  },
};
