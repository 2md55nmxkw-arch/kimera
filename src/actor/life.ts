// Мелкая жизнь: то, что персонаж делает сам, когда его не трогают.
//
//   · взгляд — не прицел: зрачки мелко перескакивают, иногда она отводит глаза
//     (в сторону или на предмет из списка интересного) и возвращается к курсору;
//   · моргает по-разному: бывает дважды подряд, сонная — медленнее;
//   · изредка — короткий жест: переступила, зевнула, потянулась, посмотрела на
//     руку, поправила прядь;
//   · никто не трогает указатель — скучает, а потом подходит и стучит в «стекло»
//     экрана изнутри. Чем дольше тишина, тем реже стучит;
//   · в первые секунды может поздороваться — как, решает память (memory.ts).
//
// Как и реакции (react.ts), это только сценарии: числа для головы, лица и рук.
// К костям их прикладывают index.ts и pose.ts. Реакция на клик всегда главнее:
// пока она идёт или кнопка зажата, жесты не начинаются, а начатый сворачивается.
//
// Первые секунды после reset() здесь тишина: контрольные кадры снимаются через
// 2.5 с, и всё, что на них было до появления этого файла, остаётся прежним.
import * as THREE from 'three/webgpu';
import { rng } from '../core/random';
import { AKIMBO, GUARD_LEFT, GUARD_RIGHT, REST, arm, blankArm, mixArm, type ArmPose } from './pose';
import { hold, pulse, smoothstep } from './react';

/** Жесты, которые можно запустить по имени. bored — не жест, а состояние: «заскучала». */
export type IdleName = 'shift' | 'yawn' | 'stretch' | 'hand' | 'hair' | 'sigh' | 'knock' | 'wave' | 'wary' | 'bored';

/** Поза руки поверх позы главы. */
export interface ArmOver {
  /** 0…1: насколько поза жеста заменяет позу главы. */
  w: number;
  pose: ArmPose;
  /** 0…1: вести кисть к зрителю (стук в стекло) вместо точки из позы. */
  aim: number;
  /** На какую долю длины руки вытянуть её к зрителю. */
  aimReach: number;
  /** Сдвиг кисти в сторону своей руки и вверх, метры. */
  aimSide: number;
  aimUp: number;
  /** 0…1: рука двигается резче обычного. */
  quick: number;
  /** 0…1: поза записана относительно груди — корпус качнулся, кисть едет с ним (танцы). */
  ride: number;
}

export interface Life {
  // Взгляд.
  eyeYaw: number; // добавка к повороту глаз, в градусах шкалы lookAt
  eyePitch: number;
  gaze: number; // 0…1: глаза ушли с курсора на точку gazeAt
  gazeAt: THREE.Vector3; // мир
  gazeHead: number; // 0…1: насколько за взглядом идёт голова
  attend: number; // 1 — голова следит за курсором, 0 — нет
  // Лицо.
  blink: number;
  lids: number; // веки, прикрытые надолго: скука, зевок
  mouth: number; // открытый рот
  happy: number;
  relaxed: number;
  angry: number;
  surprised: number;
  sad: number;
  calm: number; // 0…1: насколько заглушить лицо позы главы
  // Тело: добавки, радианы и метры.
  headYaw: number;
  headPitch: number; // минус — голова назад
  headRoll: number; // плюс — к её левому плечу
  lean: number;
  turn: number;
  roll: number;
  shrug: number;
  bob: number;
  step: number; // шаг к зрителю
  /** [левая, правая] */
  arm: [ArmOver, ArmOver];
  /** В этом кадре костяшки коснулись «стекла». */
  knock: boolean;
}

/** Что жизни нужно знать о кадре. */
export interface LifeInput {
  /** Сколько секунд указатель никто не трогал. */
  idle: number;
  still: boolean;
  press: number;
  /** Идёт реакция на клик. */
  busy: boolean;
  /** Дробный номер главы. */
  chapter: number;
  /** Скорость указателя, высот экрана в секунду. */
  speed: number;
  /** Камера, мир. */
  eye: THREE.Vector3;
  /** Центр лица, мир. */
  face: THREE.Vector3;
  /** Кисти, мир: [левая, правая]. */
  hands: [THREE.Vector3, THREE.Vector3];
}

const zeroOver = (): ArmOver => ({ w: 0, pose: blankArm(), aim: 0, aimReach: 0.8, aimSide: 0, aimUp: 0, quick: 0, ride: 0 });
const zero = (): Life => ({
  eyeYaw: 0,
  eyePitch: 0,
  gaze: 0,
  gazeAt: new THREE.Vector3(),
  gazeHead: 0,
  attend: 1,
  blink: 0,
  lids: 0,
  mouth: 0,
  happy: 0,
  relaxed: 0,
  angry: 0,
  surprised: 0,
  sad: 0,
  calm: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  lean: 0,
  turn: 0,
  roll: 0,
  shrug: 0,
  bob: 0,
  step: 0,
  arm: [zeroOver(), zeroOver()],
  knock: false,
});

// Числа, которые у слоёв просто складываются.
const SUMS = ['lids', 'mouth', 'happy', 'relaxed', 'angry', 'surprised', 'sad', 'calm', 'headYaw', 'headPitch', 'headRoll', 'lean', 'turn', 'roll', 'shrug', 'bob', 'step'] as const;

function clear(l: Life): void {
  for (const k of SUMS) l[k] = 0;
  l.eyeYaw = l.eyePitch = l.gaze = l.gazeHead = l.blink = 0;
  l.attend = 1;
  l.knock = false;
  for (const a of l.arm) a.w = a.aim = a.quick = a.aimSide = a.aimUp = a.ride = 0;
}

// ── позы рук для жестов ───────────────────────────────────────────────────
// Координаты те же, что в pose.ts: метры, X — в сторону своей руки.
// Плечо стоит в (0.09, 1.22, −0.02), рука от плеча до запястья — 0.40 м, рот — на высоте 1.33.

/** Ладонь прикрывает зевок. */
const COVER = arm({
  hand: [0.05, 1.262, 0.13],
  elbow: [0.6, -0.9, 0.25],
  wrist: [0, -0.06, 0.2],
  fingers: [0.2, 0.06, 0.08, 0.12, 0.2],
  spread: 0.03,
});
/** Пальцы у виска: поправить прядь. */
const TUCK = arm({
  hand: [0.128, 1.315, 0.1],
  elbow: [0.55, -1, 0.3],
  twist: 1.2,
  wrist: [0, 0.05, 0.1],
  fingers: [0.3, 0.1, 0.22, 0.5, 0.62],
  spread: 0.05,
});
/** Кисть перед собой: рассматривает руку. */
const INSPECT = arm({
  hand: [0.105, 1.16, 0.22],
  elbow: [0.45, -1, 0],
  twist: 2.2,
  wrist: [0, 0, 0.18],
  fingers: [0.08, 0, 0.02, 0.05, 0.1],
  spread: 0.14,
});
/** Потягивается: руки собраны перед грудью… */
const GATHER = arm({
  hand: [0.035, 1.1, 0.2],
  elbow: [0.8, -0.6, 0],
  wrist: [0, 0, 0.3],
  fingers: [0.2, 0.25, 0.3, 0.35, 0.4],
  spread: 0.02,
});
/** …и вытянуты вперёд ладонями от себя. */
const PUSH = arm({
  hand: [0.022, 1.2, 0.37],
  elbow: [0.8, -0.5, 0],
  wrist: [0, 0, 1.0],
  fingers: [0.02, 0, 0, 0, 0.04],
  spread: 0.13,
});
/** Кулак для стука; сама точка задаётся через aim. */
const FIST = arm({
  hand: [0.16, 1.3, 0.3],
  elbow: [0.45, -1, -0.1],
  twist: 0.6,
  wrist: [0, 0, 0.1],
  fingers: [0.55, 0.78, 0.92, 0.96, 0.94],
  spread: 0,
});
/** Короткий привет рукой. Поза та же, что у главы Mosaic, только ниже. */
const HELLO = arm({
  hand: [0.25, 1.31, 0.12],
  elbow: [0.6, -1, 0],
  twist: -Math.PI / 2, // ладонью к тому, кому машет
  wrist: [0, 0, 0.12],
  fingers: [0.05, 0, 0, 0.03, 0.06],
  spread: 0.14,
});
/** Настороже: руки ближе к себе, кулаки. */
const WARY_LEFT = arm({ ...GUARD_LEFT, hand: [0.04, 1.06, 0.14], fingers: [0.4, 0.6, 0.68, 0.74, 0.78] });
const WARY_RIGHT = arm({ ...GUARD_RIGHT, hand: [0.04, 1.13, 0.125], fingers: [0.4, 0.55, 0.62, 0.7, 0.76] });

type Gesture = Exclude<IdleName, 'bored'>;

const DURATION: Record<Gesture, number> = {
  shift: 1.5,
  sigh: 2.3,
  yawn: 3.3,
  stretch: 3.4,
  hand: 3.4,
  hair: 2.7,
  knock: 4.6,
  wave: 2.9,
  wary: 5,
};

/** Через сколько секунд тишины она начинает скучать и когда стучит в первый раз. */
export const BORED_AT = 14;
export const KNOCK_AT = 24;
/** После первого стука — пауза, и каждая следующая вдвое длиннее. */
const KNOCK_GAP = 38;
const KNOCK_GAP_MAX = 300;
/** Столько секунд после сброса жизнь молчит (см. шапку файла). */
const QUIET_START = 2.6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (a: number, b: number, x: number) => smoothstep(a, b, x);

export function createLife() {
  const out = zero();
  const act = zero(); // слой жеста
  const rest: [ArmOver, ArmOver] = [zeroOver(), zeroOver()]; // руки от скуки

  let awake = 0; // секунд с загрузки или сброса
  let quiet = 0; // секунд тишины: не дольше, чем она сама на сцене
  let lastChapter = -1;
  let bored = 0; // 0…1
  let forcedBored = false;
  let perk = 1; // секунд с тех пор, как её «разбудили»
  let drowsy = 0; // 0…1: после зевка моргает медленно

  // Жест.
  let gesture: Gesture | null = null;
  let age = 0;
  let ageWas = 0; // возраст жеста кадр назад: по нему ловится миг удара
  let fade = 1; // 1 — идёт, к нулю — сворачивается
  let aborted = false;
  let side: 0 | 1 = 1; // какой рукой
  let last: IdleName | null = null;
  let nextIdle = 0;
  let knocks = 0;
  let nextKnock = KNOCK_AT;
  let knockGap = KNOCK_GAP;
  let stance = 0; // на какой ноге вес: −1…1, меняется жестом shift
  let stanceTo = 0;
  let greeting: 'wave' | 'wary' | null = null;
  let greetIn = 0;

  // Глаза.
  const sacc = { wait: 0, x: 0, y: 0, tx: 0, ty: 0 };
  const glance = { wait: 0, age: -1, dur: 0, w: 0, head: 0, at: new THREE.Vector3(), from: null as THREE.Vector3 | null };
  const blink = { wait: 2.5, phase: 0, speed: 7, again: -1 };
  // Интересное: то, на что она поглядывает сама, и то, на что её попросили посмотреть сейчас.
  const pool: { point: THREE.Vector3; weight: number }[] = [];
  const focus = { point: null as THREE.Vector3 | null, ttl: 0, w: 0 };
  const tmp = new THREE.Vector3();

  function reset() {
    awake = 0;
    quiet = 0;
    lastChapter = -1;
    bored = 0;
    forcedBored = false;
    perk = 1;
    drowsy = 0;
    gesture = null;
    age = 0;
    ageWas = 0;
    fade = 1;
    aborted = false;
    last = null;
    nextIdle = 9 + rng() * 8;
    knocks = 0;
    nextKnock = KNOCK_AT;
    knockGap = KNOCK_GAP;
    stance = 0;
    stanceTo = 0;
    greeting = null;
    greetIn = 0;
    Object.assign(sacc, { wait: QUIET_START + rng() * 0.6, x: 0, y: 0, tx: 0, ty: 0 });
    Object.assign(glance, { wait: 4.5 + rng() * 4, age: -1, dur: 0, w: 0, head: 0, from: null });
    Object.assign(blink, { wait: 2.5, phase: 0, speed: 7, again: -1 });
    focus.point = null;
    focus.ttl = 0;
    focus.w = 0;
    clear(out);
  }

  function start(name: Gesture, chapter: number) {
    gesture = name;
    age = 0;
    ageWas = 0;
    fade = 1;
    aborted = false;
    last = name;
    // Свободная рука: в главе Mosaic правая машет, поэтому зевок прикрывает левая.
    // Прядь и «посмотреть на руку» — всегда левая: правая в первой главе лежит на груди.
    side = name === 'hand' || name === 'hair' ? 0 : Math.round(chapter) === 1 && name === 'yawn' ? 0 : 1;
    if (name === 'shift') stanceTo = stanceTo > 0 ? -1 : 1;
  }

  /** Выбрать случайный жест: не тот, что был только что; сонной чаще хочется зевнуть. */
  function pick(): Gesture {
    const table: [Gesture, number][] = [
      ['shift', 3],
      ['hair', 2],
      ['hand', 2],
      ['yawn', 1.2 + bored * 2],
      ['stretch', 1.3 + bored],
    ];
    const open = table.filter(([name]) => name !== last);
    let r = rng() * open.reduce((sum, [, w]) => sum + w, 0);
    for (const [name, w] of open) {
      r -= w;
      if (r <= 0) return name;
    }
    return 'shift';
  }

  // ── сценарии жестов: пишут в слой act ──────────────────────────────────
  function play(a: number, inp: LifeInput) {
    const g = act;
    const A = g.arm[side];
    const other = g.arm[side ? 0 : 1];
    switch (gesture) {
      case 'shift': {
        // Переступила: таз коротко проседает, плечи отвечают. Сам перенос веса — в stance.
        const dip = Math.sin(Math.PI * clamp01(a / 1.1));
        g.bob = -0.007 * dip;
        g.shrug = 0.02 * dip;
        g.turn = (stanceTo > 0 ? 1 : -1) * 0.03 * dip;
        break;
      }
      case 'sigh': {
        // Вздох: плечи вверх на вдохе, потом всё опадает, глаза на секунду закрыты.
        const inhale = hold(a, 0, 1.0, 0.45);
        const exhale = hold(a, 0.85, 2.3, 0.4);
        g.shrug = 0.085 * inhale - 0.02 * exhale;
        g.lean = -0.03 * inhale + 0.035 * exhale;
        g.headPitch = -0.04 * inhale + 0.09 * exhale;
        g.lids = 0.85 * hold(a, 0.8, 1.7, 0.22);
        g.mouth = 0.14 * hold(a, 0.9, 1.5, 0.2);
        break;
      }
      case 'yawn': {
        // Зевок: рот открывается, глаза зажмурены, голова чуть назад, ладонь прикрывает рот.
        const open = hold(a, 0.25, 2.3, 0.6);
        const cover = hold(a, 0.05, 2.75, 0.5);
        g.mouth = 0.9 * open * (1 + Math.sin(a * 21) * 0.03);
        g.lids = hold(a, 0.45, 2.55, 0.4);
        g.headPitch = -0.13 * open;
        g.headRoll = (side ? -1 : 1) * 0.05 * open;
        g.shrug = 0.07 * hold(a, 0.2, 1.9, 0.5);
        g.lean = -0.035 * open;
        g.calm = cover;
        g.relaxed = 0.5 * hold(a, 2.3, 3.3, 0.3);
        A.w = cover;
        mixArm(A.pose, COVER, COVER, 0);
        // Ладонь едет за головой, когда та запрокидывается.
        A.pose.hand[1] += 0.012 * open;
        A.pose.hand[2] -= 0.008 * open;
        break;
      }
      case 'stretch': {
        // Потягивается: руки вперёд ладонями от себя, плечи к ушам, глаза зажмурены.
        const up = hold(a, 0, 2.75, 0.5);
        const push = ease(0.45, 1.05, a) * (1 - ease(2.2, 2.7, a));
        const strain = hold(a, 0.8, 2.4, 0.3);
        for (const [i, o] of g.arm.entries()) {
          o.w = up;
          mixArm(o.pose, GATHER, PUSH, push);
          // Кисти не в одной точке: левая чуть ниже и дальше, будто пальцы сцеплены.
          o.pose.hand[1] += i === 0 ? -0.012 : 0.012;
          o.pose.hand[2] += i === 0 ? 0.012 : 0;
          o.pose.hand[1] += Math.sin(a * 17 + i) * 0.002 * strain;
        }
        g.shrug = 0.13 * strain + 0.03 * up;
        g.lean = 0.04 * push - 0.03 * hold(a, 2.5, 3.3, 0.3);
        g.bob = 0.008 * strain;
        g.headRoll = 0.11 * strain;
        g.headPitch = -0.05 * strain;
        g.lids = hold(a, 0.7, 2.5, 0.25);
        g.mouth = 0.12 * strain;
        g.calm = up;
        g.relaxed = 0.6 * hold(a, 2.4, 3.4, 0.3);
        break;
      }
      case 'hand': {
        // Рассматривает руку: подняла, повернула, пальцы пробежали волной.
        const up = hold(a, 0, 3.0, 0.55);
        A.w = up;
        mixArm(A.pose, INSPECT, INSPECT, 0);
        const flip = ease(1.35, 1.95, a) * (1 - ease(2.5, 3.0, a));
        A.pose.twist += flip * 1.9;
        A.pose.wrist[2] -= flip * 0.25;
        for (let f = 1; f < 5; f++) {
          // Волна от мизинца к указательному, пока смотрит на ладонь.
          const ph = a - 0.7 - (4 - f) * 0.09;
          if (ph > 0 && ph < 0.5) A.pose.fingers[f] += Math.sin((ph / 0.5) * Math.PI) * 0.45;
          A.pose.fingers[f] += flip * (0.25 + f * 0.07);
        }
        g.gaze = hold(a, 0.3, 2.85, 0.25);
        g.gazeAt.copy(inp.hands[side]);
        g.gazeAt.y += 0.06;
        g.gazeHead = 0.55;
        g.headRoll = 0.05 * up;
        g.calm = 0.6 * up;
        g.relaxed = 0.3 * up;
        break;
      }
      case 'hair': {
        // Поправляет прядь у виска: два коротких движения пальцами назад, взгляд в сторону.
        const up = hold(a, 0, 2.35, 0.5);
        A.w = up;
        mixArm(A.pose, TUCK, TUCK, 0);
        const stroke = pulse(a - 0.75, 0.16, 0.2) + pulse(a - 1.35, 0.16, 0.22);
        A.pose.hand[1] += 0.012 - 0.03 * stroke;
        A.pose.hand[2] -= 0.035 * stroke;
        A.pose.wrist[2] += 0.25 * stroke;
        A.pose.fingers[1] += 0.2 * stroke;
        A.pose.fingers[2] += 0.2 * stroke;
        g.headRoll = 0.07 * up;
        g.headYaw = -0.06 * up;
        g.gaze = hold(a, 0.25, 2.1, 0.25);
        g.gazeAt.copy(inp.face).addScaledVector(tmp.copy(inp.eye).sub(inp.face).normalize(), 0.8);
        g.gazeAt.x -= 0.45;
        g.gazeAt.y -= 0.3;
        g.gazeHead = 0.15;
        g.lids = 0.2 * up;
        g.calm = 0.5 * up;
        g.relaxed = 0.35 * up;
        break;
      }
      case 'knock': {
        // Подошла к «стеклу», два коротких удара костяшками, наклон головы: «есть кто?»
        const near = hold(a, 0, 3.9, 0.7);
        const raise = hold(a, 0.2, 3.35, 0.45);
        // Удар: быстрый выпад и отскок. Второй — через треть секунды.
        const hit = pulse(a - 1.0, 0.055, 0.07) + pulse(a - 1.32, 0.055, 0.07);
        const peer = hold(a, 1.5, 3.5, 0.35);
        g.step = 0.2 * near;
        g.lean = 0.1 * near + 0.02 * hit;
        g.bob = -0.006 * near;
        A.w = raise;
        mixArm(A.pose, FIST, FIST, 0);
        A.pose.wrist[2] += 0.32 * hit;
        A.aim = raise;
        A.aimReach = 0.74 + 0.2 * Math.min(1, hit);
        A.aimSide = 0.1;
        A.aimUp = 0.085;
        A.quick = hold(a, 0.9, 1.6, 0.05);
        g.knock = (a >= 1.055 && ageWas < 1.055) || (a >= 1.375 && ageWas < 1.375);
        g.headRoll = 0.16 * peer + 0.03 * raise;
        g.headPitch = 0.03 * near;
        g.gaze = hold(a, 0.3, 3.7, 0.25);
        g.gazeAt.copy(inp.eye);
        g.gazeHead = 1;
        g.surprised = 0.3 * peer;
        g.happy = 0.25 * hold(a, 2.2, 3.6, 0.3);
        g.calm = near;
        break;
      }
      case 'wave': {
        // Узнала: короткий привет рукой и улыбка.
        const up = hold(a, 0, 2.45, 0.4);
        A.w = up;
        mixArm(A.pose, HELLO, HELLO, 0);
        const swing = Math.sin((a - 0.3) * 11.5) * hold(a, 0.3, 2.1, 0.25);
        A.pose.hand[0] += swing * 0.03;
        A.pose.wrist[1] += swing * 0.34;
        A.pose.spread += 0.05;
        g.happy = 0.8 * hold(a, 0.1, 2.7, 0.3);
        g.calm = hold(a, 0, 2.9, 0.3);
        g.headRoll = -0.08 * up;
        g.shrug = 0.04 * up;
        g.bob = 0.008 * pulse(a - 0.15, 0.08, 0.2);
        break;
      }
      case 'wary': {
        // Помнит, что её доводили: голова в сторону, глаза — на гостя, руки ближе к себе.
        const w = hold(a, 0, 5, 0.6) * (1 - 0.45 * ease(3.2, 4.4, a));
        A.w = other.w = 0.92 * w;
        mixArm(g.arm[0].pose, WARY_LEFT, WARY_LEFT, 0);
        mixArm(g.arm[1].pose, WARY_RIGHT, WARY_RIGHT, 0);
        g.headYaw = 0.36 * w;
        g.headPitch = 0.04 * w;
        g.headRoll = -0.04 * w;
        g.lean = -0.045 * w;
        g.turn = 0.07 * w;
        g.shrug = 0.055 * w;
        g.angry = 0.42 * w;
        g.lids = 0.22 * w;
        g.calm = w;
        break;
      }
    }
  }

  // ── глаза ──────────────────────────────────────────────────────────────
  function lookAround(dt: number, inp: LifeInput, free: boolean) {
    // Микросаккады: зрачок не стоит на месте, а мелко перескакивает около цели.
    sacc.wait -= dt;
    if (sacc.wait <= 0) {
      sacc.wait = 0.4 + rng() * 1.5;
      const big = rng() < 0.25 ? 1.7 : 1;
      sacc.tx = (rng() * 2 - 1) * 5 * big;
      sacc.ty = (rng() * 2 - 1) * 3 * big;
    }
    const jump = 1 - Math.exp(-dt * 45);
    sacc.x += (sacc.tx - sacc.x) * jump;
    sacc.y += (sacc.ty - sacc.y) * jump;

    // Быстрое движение курсора забирает внимание: взгляд в сторону обрывается.
    const caught = inp.speed > 0.7;
    if (glance.age < 0) {
      glance.wait -= dt;
      if (caught) glance.wait = Math.max(glance.wait, 1.4);
      if (glance.wait <= 0 && free) {
        glance.age = 0;
        // Заскучала — смотрит по сторонам дольше.
        glance.dur = bored > 0.5 ? 1.2 + rng() * 1.8 : 0.45 + rng() * 0.65;
        glance.head = bored > 0.5 ? 0.45 : 0.22;
        // Куда: на что-нибудь интересное из списка или просто мимо.
        const total = pool.reduce((sum, p) => sum + p.weight, 0);
        let r = rng() * (total + 1);
        glance.from = null;
        for (const p of pool) {
          r -= p.weight;
          if (r <= 0) {
            glance.from = p.point;
            break;
          }
        }
        if (!glance.from) {
          // Мимо: вбок и чуть вниз (задумалась), реже — вверх.
          const sideways = (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.4);
          const upward = rng() < 0.3 ? 0.15 + rng() * 0.2 : -0.1 - rng() * 0.3;
          glance.at.copy(inp.face).addScaledVector(tmp.copy(inp.eye).sub(inp.face).normalize(), 0.9);
          glance.at.x += sideways;
          glance.at.y += upward;
        }
        // Переводя взгляд, люди часто моргают.
        if (rng() < 0.55 && blink.phase === 0) blink.phase = 1;
      }
    } else {
      glance.age += dt;
      if (glance.from) glance.at.copy(glance.from);
      if (caught || !free) glance.age = Math.max(glance.age, glance.dur);
      if (glance.age > glance.dur + 0.3) {
        glance.age = -1;
        glance.wait = bored > 0.5 ? 1.5 + rng() * 3 : 5 + rng() * 8;
      }
    }
    const on = glance.age >= 0 && glance.age < glance.dur ? 1 : 0;
    glance.w += (on - glance.w) * (1 - Math.exp(-dt * 16));
    if (glance.w < 0.002) glance.w = 0;

    // Просьба «посмотри сюда» (actor.interest с весом от 1) держится, пока её повторяют.
    focus.ttl -= dt;
    const focused = focus.point && focus.ttl > 0 && free ? 1 : 0;
    focus.w += (focused - focus.w) * (1 - Math.exp(-dt * 10));
    if (focus.w < 0.002) focus.w = 0;
  }

  function blinking(dt: number, sleepy: number) {
    blink.wait -= dt;
    if (blink.wait <= 0) {
      blink.phase = 1;
      blink.wait = (2 + rng() * 4) * (1 - 0.3 * sleepy);
      // Сонная моргает медленнее; каждый пятый раз — дважды подряд.
      blink.speed = 7 - 2.6 * sleepy;
      if (rng() < 0.2) blink.again = 1 / blink.speed + 0.07;
    }
    if (blink.again >= 0) {
      blink.again -= dt;
      if (blink.again < 0) blink.phase = 1;
    }
    blink.phase = Math.max(0, blink.phase - dt * blink.speed);
    return Math.sin(blink.phase * Math.PI);
  }

  reset();

  return {
    reset,
    /** Идёт жест (не считая просто скуки). */
    get busy() {
      return gesture !== null;
    },
    get bored() {
      return bored;
    },

    /**
     * Точка, на которую ей может быть интересно посмотреть (мир).
     * Вес от 1 — «посмотри сейчас»: взгляд уходит туда и держится, пока вызов
     * повторяют (после последнего — ещё около секунды). Вес меньше 1 — точка
     * попадает в список, из которого она сама изредка выбирает, куда глянуть;
     * чем больше вес, тем чаще. Вес 0 убирает точку из списка. Вектор хранится
     * по ссылке: предмет может двигаться.
     */
    interest(point: THREE.Vector3 | null, weight = 1) {
      if (!point) {
        focus.point = null;
        return;
      }
      if (weight >= 1) {
        focus.point = point;
        focus.ttl = 1.2;
        return;
      }
      const i = pool.findIndex((p) => p.point === point);
      if (weight <= 0) {
        if (i >= 0) pool.splice(i, 1);
      } else if (i >= 0) pool[i].weight = weight;
      else pool.push({ point, weight });
    },

    /**
     * Запустить жест по имени. Не начнётся, пока идёт другой жест.
     * @returns получилось ли
     */
    trigger(name: IdleName, chapter = 0): boolean {
      if (name === 'bored') {
        forcedBored = true;
        return true;
      }
      if (gesture && !aborted) return false;
      start(name, chapter);
      return true;
    },

    /** Поздороваться в первые секунды: как — решает память. */
    greet(how: 'wave' | 'wary' | null) {
      greeting = how;
      greetIn = 1.1;
    },

    update(dt: number, inp: LifeInput): Life {
      clear(out);
      awake += dt;

      // Тишина считается от последнего движения указателя, но не дольше, чем она сама
      // на сцене: на телефоне указателя нет вовсе, и «никто не трогал» там с самого начала.
      // Прокрутка — тоже признак жизни по ту сторону стекла.
      const scrolled = lastChapter >= 0 && Math.abs(inp.chapter - lastChapter) > 1e-4;
      lastChapter = inp.chapter;
      const before = quiet;
      quiet = scrolled || inp.press > 0.05 || inp.busy ? 0 : Math.min(inp.idle, quiet + dt);
      if (quiet < before - 0.5) {
        // Зашевелились: стук начинается с начала, скука проходит.
        if (bored > 0.4 || gesture === 'knock') perk = 0;
        forcedBored = false;
        knocks = 0;
        nextKnock = KNOCK_AT;
        knockGap = KNOCK_GAP;
      }
      perk += dt;

      const still = inp.still;
      // Свободна ли она для своих дел: не идёт реакция на клик и кнопка не зажата.
      const free = !still && !inp.busy && inp.press < 0.05;

      const wantBored = !still && (forcedBored || quiet >= BORED_AT) ? 1 : 0;
      const wasBored = bored;
      bored += (wantBored - bored) * (1 - Math.exp(-dt * (wantBored ? 1.3 : 5)));
      if (bored < 0.002) bored = 0;
      drowsy = Math.max(0, drowsy - dt / 6);

      // ── что начать ───────────────────────────────────────────────────────
      if (gesture) {
        ageWas = age;
        age += dt;
        // Кликнули, зажали кнопку или (для стука) зашевелились — жест сворачивается.
        if (!free || (gesture === 'knock' && quiet < 0.5 && age > 0.2 && age < 3.4)) aborted = true;
        if (aborted) fade = Math.max(0, fade - dt * 5);
        if (age >= DURATION[gesture] || fade <= 0) {
          if (gesture === 'yawn' && !aborted) drowsy = 1;
          gesture = null;
          aborted = false;
          nextIdle = Math.max(nextIdle, 10 + rng() * 13);
        }
      } else if (free) {
        nextIdle -= dt;
        if (inp.speed > 1) nextIdle = Math.max(nextIdle, 1.5); // пока перед лицом машут, не до того
        if (greeting && awake >= greetIn) {
          start(greeting, inp.chapter);
          greeting = null;
        } else if (wantBored && wasBored < 0.03 && awake > QUIET_START) {
          start('sigh', inp.chapter); // скука начинается со вздоха
          stanceTo = stanceTo > 0 ? -1 : 1;
        } else if (quiet >= nextKnock) {
          start('knock', inp.chapter);
          knocks++;
          nextKnock = quiet + knockGap;
          knockGap = Math.min(KNOCK_GAP_MAX, knockGap * 2);
        } else if (nextIdle <= 0 && awake > QUIET_START) {
          start(pick(), inp.chapter);
          nextIdle = 10 + rng() * 13;
        }
      }
      if (!free) greeting = null; // до приветствия успели ткнуть — не до него

      // ── скука: поза и лицо ────────────────────────────────────────────────
      if (bored > 0) {
        const b = bored;
        out.attend = 1 - 0.6 * b;
        out.lids = 0.3 * b;
        out.calm = 0.7 * b;
        out.headRoll = 0.075 * b;
        out.headPitch = 0.035 * b;
        out.lean = -0.012 * b;
        out.angry = 0.1 * b;
        // Левая рука в бок, правая повисла: в главах, где она занята, жест главы гаснет.
        rest[0].w = b;
        mixArm(rest[0].pose, AKIMBO, AKIMBO, 0);
        rest[1].w = b;
        mixArm(rest[1].pose, REST, REST, 0);
      } else {
        rest[0].w = rest[1].w = 0;
      }
      // «Ой, вы здесь»: глаза распахнулись.
      if (perk < 0.9) out.surprised += 0.4 * hold(perk, 0, 0.9, 0.15);

      // Перенос веса живёт дольше жеста: переступила — так и стоит.
      stance += (stanceTo - stance) * (1 - Math.exp(-dt * 3.2));
      out.roll += stance * 0.062;
      out.turn += stance * 0.015;

      // ── жест ─────────────────────────────────────────────────────────────
      clear(act);
      if (gesture) {
        play(age, inp);
        for (const k of SUMS) out[k] += act[k] * fade;
        out.knock = act.knock && !aborted;
      }
      for (let i = 0; i < 2; i++) {
        const b = rest[i];
        const g = act.arm[i];
        const o = out.arm[i];
        const wg = g.w * fade;
        // Два слоя (скука, жест) сводятся в одну позу с одним весом.
        o.w = 1 - (1 - b.w) * (1 - wg);
        if (o.w > 1e-4) {
          if (b.w > 1e-4) mixArm(o.pose, b.pose, wg > 1e-4 ? g.pose : b.pose, wg / o.w);
          else mixArm(o.pose, g.pose, g.pose, 0);
        }
        o.aim = g.aim * fade;
        o.aimReach = g.aimReach;
        o.aimSide = g.aimSide;
        o.aimUp = g.aimUp;
        o.quick = g.quick * fade;
      }

      // ── глаза ────────────────────────────────────────────────────────────
      if (still) {
        sacc.x = sacc.y = sacc.tx = sacc.ty = 0;
        glance.w = 0;
        glance.age = -1;
        focus.w = 0;
      } else {
        lookAround(dt, inp, free && awake > QUIET_START);
      }
      // Жест со своим взглядом главнее, потом просьба «посмотри сюда», потом взгляд в сторону.
      const gw = act.gaze * fade;
      const fw = focus.point ? focus.w * (1 - gw) : 0;
      const lw = glance.w * (1 - gw) * (1 - fw);
      out.gaze = gw + fw + lw;
      if (out.gaze > 1e-4) {
        out.gazeAt.set(0, 0, 0).addScaledVector(act.gazeAt, gw).addScaledVector(glance.at, lw);
        if (focus.point) out.gazeAt.addScaledVector(focus.point, fw);
        out.gazeAt.divideScalar(out.gaze);
        out.gazeHead = (act.gazeHead * gw + 0.6 * fw + glance.head * lw) / out.gaze;
      }
      // С закрытыми глазами дёргать зрачками незачем.
      const open = 1 - clamp01(out.lids);
      out.eyeYaw = sacc.x * open;
      out.eyePitch = sacc.y * open;

      out.blink = blinking(dt, Math.max(bored, drowsy)) * (out.lids > 0.6 ? 0 : 1);
      return out;
    },
  };
}

export type LifeDirector = ReturnType<typeof createLife>;
