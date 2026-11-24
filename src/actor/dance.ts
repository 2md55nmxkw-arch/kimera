// Танцы: по одному на пластинку, каждый по теме своей песни.
//
// Это не разученная хореография из клипов, а свои связки на восемь долей. Связка —
// список ключевых поз: к какой доле в какую позу прийти и за сколько долей до неё
// начать движение. Между ключами всё — кисть, локоть, разворот предплечья, пальцы,
// корпус, голова — переходит плавно: разгон, ход, торможение к самой доле. Поверх
// ключей идёт «качка»: пружинят колени, ходят бёдра, машет кисть — то, что не даёт
// позе застыть.
//
// Мгновенных переключений здесь быть не должно: любая ступенька — это рывок на экране.
//
// Координаты рук — как в pose.ts: метры, Y вверх, Z на зрителя, X в сторону СВОЕЙ
// руки (отрицательный — через середину тела). Плечо — в точке SHOULDER, от него до
// запястья не больше 0.40 м. Позы записаны относительно груди: корпус качнулся —
// руки едут вместе с ним (ArmOver.ride).
import type { ArmOver, Life } from './life';
import { AKIMBO, arm, type ArmPose } from './pose';

export type DanceName = 'hypno' | 'glitch' | 'blocks' | 'liar' | 'clinic' | 'peek' | 'robot' | 'sway';

type V3 = [number, number, number];
type Fingers = ArmPose['fingers'];

const TAU = Math.PI * 2;
const SHOULDER: V3 = [0.085, 1.22, -0.02];
const REACH = 0.385; // чуть меньше длины руки: совсем прямая рука выглядит палкой
const PALM_OUT = -Math.PI / 2; // предплечье развёрнуто ладонью к зрителю
const PALM_UP = Math.PI / 2;
/** Насколько резво рука догоняет цель (см. solveArm): цель уже плавная, догонять можно быстро. */
const QUICK = 0.5;

const SOFT: Fingers = [0.2, 0.2, 0.26, 0.32, 0.4];
const OPEN: Fingers = [0.05, 0, 0, 0.02, 0.05];
const FLAT: Fingers = [0.1, 0, 0, 0, 0];
const FIST: Fingers = [0.5, 0.85, 0.9, 0.92, 0.95];
const POINT: Fingers = [0.6, 0.02, 0.86, 0.9, 0.92]; // указательный
const PEACE: Fingers = [0.7, 0, 0.02, 0.9, 0.92]; // «виктория»
const TUBE: Fingers = [0.45, 0.58, 0.6, 0.64, 0.68]; // «бинокль»
const PAW: Fingers = [0.35, 0.55, 0.58, 0.6, 0.62]; // кошачья лапка

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Разгон и торможение без толчков: в начале и в конце нет ни скорости, ни ускорения. */
const smoother = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);
/** 1 на самой доле, 0 посередине между долями. */
const dip = (b: number) => 0.5 + 0.5 * Math.cos(TAU * b);
/** Качание туда-обратно за span долей. */
const swing = (b: number, span = 2, shift = 0) => Math.sin((TAU * (b - shift)) / span);
/** Плавное окно: открывается с доли from, закрывается с доли to. */
const win = (x: number, from: number, to: number, soft = 0.35) =>
  smoother(clamp01((x - from) / soft)) * (1 - smoother(clamp01((x - to) / soft)));

/** Точка для кисти от плеча: в свою сторону, вверх, вперёд. Дальше длины руки не уйдёт. */
function at(out: number, up: number, fwd: number, reach = REACH): V3 {
  const len = Math.hypot(out, up, fwd);
  const s = len > reach ? reach / len : 1;
  return [SHOULDER[0] + out * s, SHOULDER[1] + up * s, SHOULDER[2] + fwd * s];
}

/** Поза руки для танца: кисть, куда смотрит локоть, остальное по желанию. */
const P = (hand: V3, elbow: V3, more: Partial<ArmPose> = {}): ArmPose =>
  arm({ hand, elbow, wrist: [0, 0, 0], fingers: SOFT, ...more });

// ── тело ────────────────────────────────────────────────────────────────

interface Body {
  turn: number;
  roll: number;
  lean: number;
  bob: number;
  shrug: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  happy: number;
  lids: number;
  surprised: number;
}
const BODY = ['turn', 'roll', 'lean', 'bob', 'shrug', 'headYaw', 'headPitch', 'headRoll', 'happy', 'lids', 'surprised'] as const;
const noBody = (): Body => ({ turn: 0, roll: 0, lean: 0, bob: 0, shrug: 0, headYaw: 0, headPitch: 0, headRoll: 0, happy: 0, lids: 0, surprised: 0 });

/** Всё, что танец говорит о кадре: [левая, правая] рука и тело. */
interface Figure {
  l: ArmPose;
  r: ArmPose;
  body: Body;
}

// ── связка ──────────────────────────────────────────────────────────────

interface Key {
  /** К какой доле прийти в эту позу. */
  at: number;
  /** За сколько долей до неё начать движение (по умолчанию полдоли). */
  move?: number;
  /** Руки; не названа — остаётся как была. */
  l?: ArmPose;
  r?: ArmPose;
  both?: ArmPose;
  body?: Partial<Body>;
}

/** «Качка» поверх ключей: x — доля внутри связки, b — доля от начала песни. */
type Groove = (x: number, b: number, f: Figure) => void;

interface Routine {
  beats: number;
  keys: { at: number; move: number; figure: Figure }[];
  groove: Groove;
}

function routine(beats: number, keys: Key[], groove: Groove): Routine {
  // Рука, не названная в ключе, держит позу предыдущего; у первого ключа — последнего.
  let l = arm({});
  let r = arm({});
  for (const k of keys) {
    l = k.both ?? k.l ?? l;
    r = k.both ?? k.r ?? r;
  }
  return {
    beats,
    groove,
    keys: keys.map((k, i) => {
      l = k.both ?? k.l ?? l;
      r = k.both ?? k.r ?? r;
      // Движение не может начаться раньше, чем закончилось предыдущее.
      const gap = i ? k.at - keys[i - 1].at : k.at + beats - keys[keys.length - 1].at;
      return { at: k.at, move: Math.min(k.move ?? 0.5, gap), figure: { l, r, body: { ...noBody(), ...k.body } } };
    }),
  };
}

/**
 * Кисть идёт не по прямой, а по дуге вокруг плеча: так она не режет через грудь.
 * Посреди пути дуга ещё и выгибается к зрителю — руки носят перед собой, а не в
 * плоскости плеч; без этого локоть на полпути не знает, куда смотреть, и перекидывается.
 */
function arc(out: V3, a: V3, b: V3, t: number): void {
  arcFlat(out, a, b, t);
  const far = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  out[2] += Math.sin(Math.PI * t) * Math.min(0.1, far * 0.25);
}

function arcFlat(out: V3, a: V3, b: V3, t: number): void {
  const ax = a[0] - SHOULDER[0];
  const ay = a[1] - SHOULDER[1];
  const az = a[2] - SHOULDER[2];
  const bx = b[0] - SHOULDER[0];
  const by = b[1] - SHOULDER[1];
  const bz = b[2] - SHOULDER[2];
  const ra = Math.hypot(ax, ay, az);
  const rb = Math.hypot(bx, by, bz);
  const cos = ra > 1e-4 && rb > 1e-4 ? (ax * bx + ay * by + az * bz) / (ra * rb) : 1;
  if (cos > 0.9995 || cos < -0.95) {
    for (let i = 0; i < 3; i++) out[i] = lerp(a[i], b[i], t);
    return;
  }
  const angle = Math.acos(cos);
  const wa = Math.sin((1 - t) * angle) / Math.sin(angle) / ra;
  const wb = Math.sin(t * angle) / Math.sin(angle) / rb;
  const r = lerp(ra, rb, t);
  out[0] = SHOULDER[0] + (ax * wa + bx * wb) * r;
  out[1] = SHOULDER[1] + (ay * wa + by * wb) * r;
  out[2] = SHOULDER[2] + (az * wa + bz * wb) * r;
}

function mixPose(out: ArmPose, a: ArmPose, b: ArmPose, t: number): void {
  arc(out.hand, a.hand, b.hand, t);
  for (let i = 0; i < 3; i++) {
    out.elbow[i] = lerp(a.elbow[i], b.elbow[i], t);
    out.wrist[i] = lerp(a.wrist[i], b.wrist[i], t);
  }
  for (let i = 0; i < 5; i++) out.fingers[i] = lerp(a.fingers[i], b.fingers[i], t);
  out.twist = lerp(a.twist, b.twist, t);
  out.spread = lerp(a.spread, b.spread, t);
  out.reach = out.drum = out.wave = out.grasp = 0;
}

/** Поза между двумя: для недоведённых движений («заело»). */
function between(a: ArmPose, b: ArmPose, t: number): ArmPose {
  const out = arm({ hand: [0, 0, 0], elbow: [0, 0, 0], wrist: [0, 0, 0], fingers: [0, 0, 0, 0, 0] });
  mixPose(out, a, b, t);
  return out;
}

/** Фигура связки на доле b. Возвращает долю внутри связки. */
function sample(rt: Routine, b: number, f: Figure): number {
  const n = rt.keys.length;
  const x = ((b % rt.beats) + rt.beats) % rt.beats;
  let j = 0;
  while (j < n && rt.keys[j].at <= x) j++;
  const next = rt.keys[j % n];
  const prev = rt.keys[(j - 1 + n) % n];
  const end = j < n ? next.at : next.at + rt.beats;
  const t = smoother(clamp01((x - (end - next.move)) / next.move));
  mixPose(f.l, prev.figure.l, next.figure.l, t);
  mixPose(f.r, prev.figure.r, next.figure.r, t);
  for (const k of BODY) f.body[k] = lerp(prev.figure.body[k], next.figure.body[k], t);
  return x;
}

// ── позы, общие для нескольких танцев ───────────────────────────────────

const HIP = AKIMBO; // рука в бок
const STRAIGHT = 0.398; // рука совсем прямая: для «палок» и углов
const SIDE = P(at(1, 0.02, 0.03, STRAIGHT), [0, -0.3, -1], { fingers: FLAT }); // в сторону
const UP = P(at(0.02, 1, 0.02, STRAIGHT), [1, 0, -0.2], { fingers: FLAT }); // вверх
/** Плечо в сторону, предплечье вверх, ладонь к зрителю. */
const GOAL = P(at(0.205, 0.185, 0.03), [1, -0.3, -0.1], { twist: PALM_OUT, fingers: OPEN, spread: 0.2 });
/** Палец в зрителя. */
const POINT_AT = P(at(-0.04, 0.02, 0.38), [0.4, -1, 0], { fingers: POINT });
/** Ладони в стороны у пояса: «ну а что?». */
const SHRUG = P(at(0.25, -0.15, 0.13), [0.15, -1, -0.3], { twist: PALM_UP, fingers: OPEN, spread: 0.3, wrist: [0, 0, 0.25] });
/** Обе руки вверх и чуть в стороны. */
const CHEER = P(at(0.1, 0.37, 0.03), [1, 0, -0.2], { twist: PALM_OUT, fingers: OPEN, spread: 0.2 });

/** Колени пружинят на каждую долю; depth — насколько глубоко, метры. */
function bounce(b: number, f: Figure, depth = 0.022): void {
  f.body.bob -= 0.012 + depth * dip(b);
}

/** Бёдра ходят из стороны в сторону за две доли, плечи и голова — чуть следом. */
function hips(b: number, f: Figure, k = 1): void {
  f.body.roll += swing(b) * 0.15 * k;
  f.body.turn += swing(b, 2, 0.15) * 0.08 * k;
  f.body.headRoll -= swing(b, 2, 0.3) * 0.07 * k;
}

// ── танцы ───────────────────────────────────────────────────────────────

// Гипноз: пальцы у висков крутят спирали, голова идёт по кругу, тело качается
// маятником; потом — лунатик: руки вперёд, корпус поворачивается то туда, то сюда.
const SPIRAL = P([0.17, 1.4, 0.07], [1, -0.55, 0], { fingers: POINT, twist: PALM_OUT });
const SLEEPWALK = P(at(-0.005, 0.01, 0.378), [0.35, -1, 0], { fingers: [0.25, 0.15, 0.2, 0.25, 0.3], wrist: [0, 0, -0.4] });

const hypno = routine(
  8,
  [
    { at: 0, move: 0.8, both: SPIRAL, body: { lids: 0.35, happy: 0.3 } },
    { at: 4, move: 0.8, both: SLEEPWALK, body: { lids: 0.55, lean: 0.05, headRoll: 0.12 } },
    { at: 5, move: 0.9, body: { lids: 0.55, lean: 0.05, turn: 0.42, headRoll: -0.12 } },
    { at: 6, move: 0.9, body: { lids: 0.55, lean: 0.05, turn: 0, headRoll: 0.12 } },
    { at: 7, move: 0.9, body: { lids: 0.55, lean: 0.05, turn: -0.42, headRoll: -0.12 } },
  ],
  (x, b, f) => {
    f.body.happy += 0.3;
    bounce(b, f, 0.014);
    // Спирали: кисти кружат в разные стороны, голова — по кругу, тело — маятником.
    const spell = win(x, 0, 3.1);
    const a = TAU * b;
    f.l.hand[0] += Math.cos(a) * 0.04 * spell;
    f.l.hand[1] += Math.sin(a) * 0.04 * spell;
    f.r.hand[0] += Math.cos(a) * 0.04 * spell;
    f.r.hand[1] -= Math.sin(a) * 0.04 * spell;
    f.body.roll += swing(b) * 0.16 * spell;
    f.body.headRoll += Math.sin(a / 2) * 0.16 * spell;
    f.body.headPitch += Math.cos(a / 2) * 0.07 * spell;
    // Лунатик: руки покачиваются по очереди.
    const walk = win(x, 4, 7.2);
    const step = swing(b) * 0.05 * walk;
    f.l.hand[1] += step;
    f.r.hand[1] -= step;
    f.body.roll += swing(b) * 0.07 * walk;
  },
);

// Сбой: позы щёлкают быстро и чётко, а на некоторых «заедает» — движение
// откатывается на треть и проигрывается ещё раз.
const CROSS = P([-0.08, 1.24, 0.16], [0.6, -0.9, 0.3], { fingers: FIST });
const TO_HEAD = P([0.12, 1.47, 0.07], [1, -0.1, 0.1], { twist: PALM_OUT, fingers: OPEN });
const LOW = P(at(0.3, -0.22, 0.03), [0, -0.5, -1], { fingers: OPEN, spread: 0.3 });
const SNAP = 0.38;

const glitch = routine(
  8,
  [
    { at: 0, move: SNAP, both: CROSS, body: { headPitch: 0.12, lean: 0.05 } },
    { at: 1, move: SNAP, both: GOAL, body: { headRoll: -0.12, turn: 0.1 } },
    { at: 1.4, move: 0.22, both: between(GOAL, CROSS, 0.35), body: { headRoll: -0.04, turn: 0.04, headPitch: 0.05 } },
    { at: 1.62, move: 0.22, both: GOAL, body: { headRoll: -0.12, turn: 0.1 } },
    { at: 2, move: SNAP, l: HIP, r: POINT_AT, body: { turn: -0.16, lean: 0.06, headRoll: 0.06 } },
    { at: 3, move: SNAP, both: TO_HEAD, body: { headRoll: 0.14, surprised: 0.5 } },
    { at: 4, move: SNAP, both: CROSS, body: { headPitch: 0.12, lean: 0.05 } },
    { at: 5, move: SNAP, both: GOAL, body: { headRoll: 0.12, turn: -0.1 } },
    { at: 6, move: SNAP, l: POINT_AT, r: HIP, body: { turn: 0.16, lean: 0.06, headRoll: -0.06 } },
    { at: 6.4, move: 0.22, l: between(POINT_AT, GOAL, 0.3), r: HIP, body: { turn: 0.08, lean: 0.02 } },
    { at: 6.62, move: 0.22, l: POINT_AT, r: HIP, body: { turn: 0.16, lean: 0.06, headRoll: -0.06 } },
    { at: 7, move: SNAP, both: LOW, body: { headPitch: -0.1, shrug: 0.08 } },
  ],
  (x, b, f) => {
    f.body.happy += 0.3;
    bounce(b, f, 0.026);
    f.body.roll += swing(b, 4) * 0.06;
    // «Зависла»: голова мелко трясётся, пока руки у висков.
    f.body.headYaw += Math.sin(TAU * 3 * b) * 0.07 * win(x, 3.1, 3.6, 0.2);
  },
);

// Фигурки: народная пляска — руки сложены перед грудью, приседает, раскрывается в
// стороны, — а потом руки складываются в прямые углы, как падающие блоки: Г,
// обратная Г, Т и палка.
const FOLD_UNDER = P([-0.1, 1.185, 0.17], [1, -0.25, 0.35], { fingers: FLAT });
const FOLD_OVER = P([-0.1, 1.24, 0.15], [1, -0.2, 0.35], { fingers: FLAT });
const WIDE = P(at(0.36, 0.1, 0.1), [0, -1, -0.2], { twist: PALM_OUT, fingers: OPEN, spread: 0.25 });

const blocks = routine(
  8,
  [
    { at: 0, move: 0.6, l: FOLD_UNDER, r: FOLD_OVER, body: { lean: 0.03 } },
    { at: 2, both: WIDE, body: { headPitch: -0.08, happy: 0.4 } },
    { at: 3, l: FOLD_UNDER, r: FOLD_OVER, body: { lean: 0.03 } },
    { at: 4, l: UP, r: SIDE, body: { headYaw: 0.2, roll: 0.08 } },
    { at: 5, l: SIDE, r: UP, body: { headYaw: -0.2, roll: -0.08 } },
    { at: 6, both: SIDE, body: {} },
    { at: 7, both: UP, body: { headPitch: -0.1 } },
  ],
  (x, b, f) => {
    f.body.happy += 0.55;
    // Пока руки сложены — пляска: глубже приседает, плечи ходят из стороны в сторону.
    const folk = win(x, 0, 1.4) + win(x, 3, 3.5, 0.25);
    bounce(b, f, 0.03 + 0.03 * folk);
    hips(b, f, folk);
    f.body.turn += swing(b) * 0.1 * folk;
  },
);

// Обманщица: грозит пальцем то одной рукой, то другой, потом «тсс» — палец к
// губам, — и разводит руками: «а я что? я ничего».
const WAG = P([0.17, 1.37, 0.17], [0.5, -1, 0.1], { twist: PALM_OUT, fingers: POINT });
const HUSH = P([0.02, 1.275, 0.15], [0.45, -1, 0.15], { fingers: POINT });

const liar = routine(
  8,
  [
    { at: 0, move: 0.6, l: HIP, r: WAG, body: { turn: 0.1, headRoll: -0.08 } },
    { at: 2, move: 0.6, l: WAG, r: HIP, body: { turn: -0.1, headRoll: 0.08 } },
    { at: 4, move: 0.6, l: HIP, r: HUSH, body: { lean: 0.12, headRoll: 0.1, turn: 0.06, lids: 0.25 } },
    { at: 6, move: 0.6, both: SHRUG, body: { shrug: 0.1, headRoll: -0.14, headPitch: -0.05 } },
  ],
  (x, b, f) => {
    f.body.happy += 0.65;
    hips(b, f);
    bounce(b, f, 0.02);
    // «Нет-нет»: кисть качается дважды на долю.
    const wagR = win(x, 0, 1.3);
    const wagL = win(x, 2, 3.3);
    const wag = Math.sin(TAU * 2 * b);
    f.r.wrist[1] += wag * 0.5 * wagR;
    f.r.hand[0] += wag * 0.025 * wagR;
    f.l.wrist[1] += wag * 0.5 * wagL;
    f.l.hand[0] += wag * 0.025 * wagL;
    f.body.headYaw -= wag * 0.04 * (wagR + wagL);
    // Плечи пожимаются на каждую долю.
    const shrug = win(x, 6, 7.3) * (1 - dip(b));
    f.body.shrug += shrug * 0.07;
    f.l.hand[1] += shrug * 0.03;
    f.r.hand[1] += shrug * 0.03;
  },
);

// Приём у врача: жар — рука ко лбу, то одна, то другая; пульс на запястье, голова
// считает; палец чертит в воздухе кардиограмму — ровно, зубец, ровно; «не годен» —
// руки крестом.
const FEVER = P([-0.005, 1.475, 0.12], [1, -0.25, 0.2], { twist: PALM_OUT, fingers: [0.2, 0.05, 0.05, 0.08, 0.12] });
const PULSE_ARM = P([0.05, 1.1, 0.27], [0.5, -1, 0], { twist: PALM_UP, fingers: [0.2, 0.25, 0.3, 0.35, 0.4] });
const PULSE_TAKE = P([-0.045, 1.135, 0.265], [0.7, -0.7, 0.15], { fingers: [0.4, 0.15, 0.15, 0.6, 0.7], wrist: [0, 0, -0.3] });
const REFUSE = P([-0.09, 1.27, 0.17], [0.5, -1, 0.3], { fingers: FLAT });
/** Кардиограмма: точка линии, от своего плеча вбок и вверх. */
const trace = (out: number, up: number): ArmPose => P(at(out, up, 0.2), [0.3, -1, 0], { twist: PALM_OUT, fingers: POINT });

const clinic = routine(
  8,
  [
    { at: 0, move: 0.4, l: HIP, r: FEVER, body: { headPitch: -0.08, lids: 0.4, roll: 0.06 } },
    { at: 1, move: 0.6, l: FEVER, r: HIP, body: { headPitch: -0.08, lids: 0.4, roll: -0.06 } },
    { at: 2, move: 0.6, l: PULSE_ARM, r: PULSE_TAKE, body: { headPitch: 0.14, lean: 0.04 } },
    { at: 4, move: 0.6, l: HIP, r: trace(0.3, 0.02), body: { headYaw: -0.22, turn: -0.1 } },
    { at: 4.6, move: 0.5, r: trace(0.15, 0.02), body: { headYaw: -0.12, turn: -0.05 } },
    { at: 5, move: 0.4, r: trace(0.08, 0.27), body: { headYaw: -0.06, headPitch: -0.1 } },
    { at: 5.4, move: 0.4, r: trace(0.0, -0.1), body: { headYaw: 0, headPitch: 0.08 } },
    { at: 5.8, move: 0.4, r: trace(-0.07, 0.02), body: { headYaw: 0.06 } },
    { at: 6.4, move: 0.5, r: trace(-0.2, 0.02), body: { headYaw: 0.18, turn: 0.08 } },
    { at: 7, move: 0.5, both: REFUSE, body: { headRoll: 0.08 } },
  ],
  (x, b, f) => {
    f.body.happy += 0.35;
    hips(b, f, 0.5);
    bounce(b, f, 0.018);
    // Считает пульс: кивок на каждую полудолю.
    f.body.headPitch += (1 - dip(b * 2)) * 0.05 * win(x, 2.1, 3.3);
    // «Нет»: качает головой.
    f.body.headYaw += Math.sin(TAU * 2 * b) * 0.12 * win(x, 7, 7.5, 0.25);
  },
);

// Любительница людей: высматривает из-под ладони — влево, вправо; берёт «бинокль»
// и подаётся к зрителю; «вон один! и вон!» — показывает в стороны; и зовёт: ладонь
// у рта, вторая рука машет над головой.
const VISOR = P([0.035, 1.47, 0.13], [1, -0.05, 0.15], { fingers: FLAT });
const SPYGLASS = P([0.035, 1.375, 0.15], [0.6, -1, 0.1], { fingers: TUBE });
const THERE = P(at(0.36, 0.13, 0.08), [0, -1, -0.3], { fingers: POINT });
const CALL = P([0.09, 1.33, 0.13], [0.8, -0.6, 0.2], { fingers: FLAT });
const HELLO = P(at(0.16, 0.34, 0.05), [0.8, -0.6, -0.1], { twist: PALM_OUT, fingers: OPEN, spread: 0.2 });

const peek = routine(
  8,
  [
    { at: 0, move: 0.6, l: HIP, r: VISOR, body: { turn: 0.24, headYaw: 0.22, lean: 0.06 } },
    { at: 1, move: 0.7, body: { turn: -0.24, headYaw: -0.22, lean: 0.06 } },
    { at: 2, move: 0.6, both: SPYGLASS, body: { lean: 0.04 } },
    { at: 3, move: 0.6, body: { lean: 0.17, surprised: 0.4 } },
    { at: 4, l: THERE, r: HIP, body: { headYaw: 0.3, turn: 0.1, surprised: 0.3, roll: 0.08 } },
    { at: 5, l: HIP, r: THERE, body: { headYaw: -0.3, turn: -0.1, surprised: 0.3, roll: -0.08 } },
    { at: 6, move: 0.6, l: CALL, r: HELLO, body: { headRoll: -0.06, headPitch: -0.05 } },
  ],
  (x, b, f) => {
    const hello = win(x, 6, 7.3);
    f.body.happy += 0.55 + 0.3 * win(x, 4, 7.4);
    bounce(b, f, 0.018 + 0.014 * hello);
    hips(b, f, 0.4 + 0.6 * hello);
    // Машет: вся рука ходит из стороны в сторону раз на долю, кисть — следом.
    const wag = Math.sin(TAU * b);
    f.r.hand[0] += wag * 0.1 * hello;
    f.r.wrist[1] += Math.sin(TAU * (b - 0.12)) * 0.3 * hello;
  },
);

// Машина: предплечья ходят под прямым углом — через прямую руку, в два щелчка, —
// голова поворачивается следом, как на шарнире. Потом руки складываются над
// головой в большое сердце, оно качается; сердце у груди стучит — и объятия.
const ARM_UP = P(at(0.205, 0.185, 0.03), [1, -0.3, -0.1], { twist: PALM_OUT, fingers: FLAT });
const ARM_DOWN = P(at(0.205, -0.185, 0.05), [1, 0.7, 0], { fingers: FLAT });
const ARM_OUT = P(at(1, 0, 0.03, STRAIGHT), [0, 0, -1], { fingers: FLAT });
const BIG_HEART = P([0.03, 1.565, 0.04], [1, 0.25, -0.1], { wrist: [0, 0, -0.5] });
const HEART = P([0.015, 1.17, 0.15], [0.7, -0.7, 0.1], { fingers: [0.2, 0.3, 0.36, 0.42, 0.5] });
const HUG = P(at(0.36, 0.1, 0.1), [0, -1, -0.2], { twist: PALM_OUT, fingers: OPEN, spread: 0.25 });
const TICK = 0.25;

const robot = routine(
  8,
  [
    { at: 0, move: TICK, l: ARM_DOWN, r: ARM_UP, body: { headYaw: -0.22, turn: -0.06 } },
    { at: 0.75, move: TICK, both: ARM_OUT, body: {} },
    { at: 1, move: TICK, l: ARM_UP, r: ARM_DOWN, body: { headYaw: 0.22, turn: 0.06 } },
    { at: 1.75, move: TICK, both: ARM_OUT, body: {} },
    { at: 2, move: TICK, l: ARM_DOWN, r: ARM_UP, body: { headYaw: -0.22, turn: -0.06 } },
    { at: 2.75, move: TICK, both: ARM_OUT, body: {} },
    { at: 3, move: TICK, l: ARM_UP, r: ARM_DOWN, body: { headYaw: 0.22, turn: 0.06 } },
    { at: 4, move: 0.6, both: BIG_HEART, body: { headRoll: 0.1, happy: 0.6 } },
    { at: 6, move: 0.6, both: HEART, body: { headRoll: -0.12, happy: 0.6, lean: 0.04 } },
    { at: 7, move: 0.5, both: HUG, body: { happy: 0.6, headPitch: -0.06 } },
    { at: 7.75, move: TICK, both: ARM_OUT, body: {} },
  ],
  (x, b, f) => {
    f.body.happy += 0.3;
    f.body.lids += 0.12 * win(x, 0, 3);
    bounce(b, f, 0.016);
    // Большое сердце качается из стороны в сторону вместе с корпусом.
    const love = win(x, 4, 5.4);
    const s = swing(b);
    f.l.hand[0] += s * 0.06 * love;
    f.r.hand[0] -= s * 0.06 * love;
    hips(b, f, win(x, 4, 7.4));
    // Сердце стучит: два толчка на долю, второй слабее — плечи вздрагивают.
    const thump = dip(b * 2) ** 3 * (0.6 + 0.4 * dip(b)) * win(x, 6, 6.6, 0.25);
    f.l.hand[2] += thump * 0.04;
    f.r.hand[2] += thump * 0.04;
    f.body.shrug += thump * 0.05;
  },
);

// Озорница: кошачьи лапки ходят по очереди, бёдра качаются; потом «виктория» у
// глаза — правой, левой, — и обе руки вверх, качаются, как дворники.
const PAW_HIGH = P([0.14, 1.35, 0.15], [0.7, -0.8, 0], { fingers: PAW, wrist: [0, 0, -0.7] });
const PAW_LOW = P([0.14, 1.25, 0.17], [0.7, -0.8, 0], { fingers: PAW, wrist: [0, 0, -0.7] });
const VICTORY = P([0.155, 1.385, 0.12], [1, -0.55, 0], { twist: PALM_OUT, fingers: PEACE, spread: 0.4 });

const sway = routine(
  8,
  [
    { at: 0, l: PAW_HIGH, r: PAW_LOW, body: { roll: 0.15, headRoll: -0.14 } },
    { at: 1, l: PAW_LOW, r: PAW_HIGH, body: { roll: -0.15, headRoll: 0.14 } },
    { at: 2, l: PAW_HIGH, r: PAW_LOW, body: { roll: 0.15, headRoll: -0.14 } },
    { at: 3, l: PAW_LOW, r: PAW_HIGH, body: { roll: -0.15, headRoll: 0.14 } },
    { at: 4, l: HIP, r: VICTORY, body: { roll: -0.08, headRoll: -0.14, turn: 0.1, happy: 0.3 } },
    { at: 5, l: VICTORY, r: HIP, body: { roll: 0.08, headRoll: 0.14, turn: -0.1, happy: 0.3 } },
    { at: 6, both: CHEER, body: { headPitch: -0.05 } },
  ],
  (x, b, f) => {
    f.body.happy += 0.7;
    bounce(b, f, 0.03);
    f.body.turn += swing(b, 2, 0.15) * 0.08;
    // «Дворники»: поднятые руки качаются вместе, корпус за ними.
    const wipe = win(x, 6, 7.3);
    const s = swing(b);
    f.l.hand[0] += s * 0.09 * wipe;
    f.r.hand[0] -= s * 0.09 * wipe;
    f.body.roll += s * 0.1 * wipe;
    f.body.headRoll -= swing(b, 2, 0.2) * 0.1 * wipe;
  },
);

const ROUTINES: Record<DanceName, Routine> = { hypno, glitch, blocks, liar, clinic, peek, robot, sway };

// ── выход ───────────────────────────────────────────────────────────────

const blank = (): ArmPose => arm({ hand: [0, 0, 0], elbow: [0, 0, 0], wrist: [0, 0, 0], fingers: [0, 0, 0, 0, 0] });
const now: Figure = { l: blank(), r: blank(), body: noBody() };

/** Поставить руку: вес и поза. */
function put(over: ArmOver, k: number, pose: ArmPose): void {
  over.w = Math.max(over.w, k);
  over.quick = Math.max(over.quick, QUICK * k);
  over.ride = Math.max(over.ride, k);
  const p = over.pose;
  for (let i = 0; i < 3; i++) {
    p.hand[i] = pose.hand[i];
    p.elbow[i] = pose.elbow[i];
    p.wrist[i] = pose.wrist[i];
  }
  for (let i = 0; i < 5; i++) p.fingers[i] = pose.fingers[i];
  p.twist = pose.twist;
  p.spread = pose.spread;
  p.reach = p.drum = p.wave = p.grasp = 0;
}

/**
 * Наложить танец на то, что «мелкая жизнь» решила в этом кадре.
 * @param beats сколько долей прошло с начала песни (дробное)
 * @param k     0…1, насколько танец взял верх
 */
export function applyDance(name: DanceName, beats: number, k: number, live: Life): void {
  const rt = ROUTINES[name];
  const x = sample(rt, beats, now);
  rt.groove(x, beats, now);
  put(live.arm[0], k, now.l);
  put(live.arm[1], k, now.r);

  const y = now.body;
  live.turn += y.turn * k;
  live.roll += y.roll * k;
  live.lean += y.lean * k;
  live.bob += y.bob * k;
  live.shrug += y.shrug * k;
  live.headYaw += y.headYaw * k;
  live.headPitch += y.headPitch * k;
  live.headRoll += y.headRoll * k;
  live.happy = Math.max(live.happy, clamp01(y.happy) * k);
  live.lids = Math.max(live.lids, clamp01(y.lids) * k);
  live.surprised = Math.max(live.surprised, clamp01(y.surprised) * k);

  // Подпевает: рот приоткрывается на каждую полудолю.
  live.mouth = Math.max(live.mouth, (0.1 + 0.3 * (1 - dip(beats * 2))) * k);
  live.calm = Math.max(live.calm, 0.6 * k);
  // За курсором следит вполглаза: занята.
  live.attend *= 1 - 0.5 * k;
}

export const DANCE_NAMES = Object.keys(ROUTINES) as DanceName[];
