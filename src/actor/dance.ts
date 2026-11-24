// Танцы: по одному на пластинку, каждый по теме своей песни.
//
// Это не разученная хореография из клипов, а свои короткие связки: фигуры задаются
// формулами от номера доли, без записанных движений. Танец пишет поверх «мелкой
// жизни» (actor/life.ts) в ту же структуру: руки — как позы жестов, тело и голова —
// добавками. Резкие смены поз сглаживает сам решатель рук (pose.ts), поэтому
// фигуру достаточно переключить на долю и попросить руку двигаться быстро.
//
// Координаты рук — как в pose.ts: метры, Y вверх, Z на зрителя, X в сторону СВОЕЙ
// руки (отрицательный — через середину тела). Плечо на высоте около 1.25, макушка — 1.55.
import type { ArmOver, Life } from './life';
import { AKIMBO, arm, type ArmPose } from './pose';

export type DanceName = 'hypno' | 'glitch' | 'blocks' | 'liar' | 'clinic' | 'peek' | 'robot' | 'sway';

type Fingers = ArmPose['fingers'];
const OPEN: Fingers = [0.05, 0, 0, 0.02, 0.05];
const FLAT: Fingers = [0.1, 0, 0, 0, 0];
const FIST: Fingers = [0.5, 0.85, 0.9, 0.92, 0.95];
const POINT: Fingers = [0.6, 0.02, 0.86, 0.9, 0.92]; // указательный
const TUBE: Fingers = [0.45, 0.58, 0.6, 0.64, 0.68]; // «бинокль»

const TAU = Math.PI * 2;
const PALM_OUT = -Math.PI / 2; // предплечье развёрнуто ладонью к зрителю
const frac = (x: number) => x - Math.floor(x);
/** Подскок раз на долю: 0 на доле, 1 между долями. */
const bounce = (b: number) => Math.abs(Math.sin(Math.PI * b));
/** Качание туда-обратно за span долей. */
const swing = (b: number, span: number) => Math.sin((TAU * b) / span);
/** Удар на долю: 1 в самый момент доли и быстро спадает. */
const hit = (b: number) => (1 - frac(b)) ** 3;

/** Поставить руку: вес, поза, и насколько резко в неё идти. */
function put(over: ArmOver, k: number, pose: Partial<ArmPose>, quick = 0): void {
  const full = arm(pose);
  over.w = Math.max(over.w, k);
  over.quick = Math.max(over.quick, quick * k);
  const p = over.pose;
  for (let i = 0; i < 3; i++) {
    p.hand[i] = full.hand[i];
    p.elbow[i] = full.elbow[i];
    p.wrist[i] = full.wrist[i];
  }
  for (let i = 0; i < 5; i++) p.fingers[i] = full.fingers[i];
  p.twist = full.twist;
  p.spread = full.spread;
  p.reach = 0;
  p.drum = 0;
  p.wave = full.wave;
  p.grasp = 0;
}

type Dance = (b: number, k: number, l: Life) => void;

const DANCES: Record<DanceName, Dance> = {
  // Гипноз: тело качается маятником, палец у виска чертит спираль, вторая рука
  // водит перед зрителем невидимым маятником. Веки приспущены.
  hypno(b, k, l) {
    const s = swing(b, 2);
    l.roll += s * 0.05 * k;
    l.headRoll -= s * 0.1 * k;
    l.bob += bounce(b) * 0.006 * k;
    l.lids = Math.max(l.lids, 0.32 * k);
    l.happy = Math.max(l.happy, 0.35 * k);
    const a = TAU * b;
    put(l.arm[1], k, {
      hand: [0.15 + Math.cos(a) * 0.035, 1.46 + Math.sin(a) * 0.035, 0.11],
      elbow: [0.8, -0.5, 0],
      twist: PALM_OUT,
      fingers: POINT,
    });
    put(l.arm[0], k, {
      hand: [0.09 + s * 0.11, 1.15 + Math.abs(s) * 0.02, 0.33],
      elbow: [0.5, -1, 0.2],
      wrist: [0, 0, -0.5],
      fingers: [0.55, 0.5, 0.9, 0.9, 0.9],
    });
  },

  // Сбой: четыре резкие позы по кругу, между ними дёрганье, как у зависшей картинки.
  glitch(b, k, l) {
    const n = Math.floor(b) % 4;
    l.bob -= hit(b) * 0.014 * k;
    l.turn += [0, 0.1, -0.14, 0.04][n] * k;
    l.headRoll += [0, -0.06, 0.05, 0.13][n] * k;
    l.headPitch += [0.08, -0.07, 0, 0][n] * k;
    // «Сбой»: изредка голову дёргает в сторону на долю секунды.
    if (Math.sin(b * 53.1) > 0.9) l.headYaw += 0.09 * k;
    l.happy = Math.max(l.happy, 0.25 * k);
    if (n === 0) {
      // Руки крестом перед грудью.
      for (const over of l.arm) put(over, k, { hand: [-0.07, 1.21, 0.17], elbow: [0.5, -1, 0.3], fingers: FIST }, 1);
    } else if (n === 1) {
      // Вразлёт.
      for (const over of l.arm) put(over, k, { hand: [0.45, 1.36, 0.03], elbow: [0.3, -1, -0.2], fingers: OPEN, spread: 0.2 }, 1);
    } else if (n === 2) {
      // Указывает в зрителя, вторая рука в бок.
      put(l.arm[1], k, { hand: [0.12, 1.25, 0.36], elbow: [0.5, -1, 0], fingers: POINT }, 1);
      put(l.arm[0], k, AKIMBO, 1);
    } else {
      // Обе к голове.
      for (const over of l.arm) put(over, k, { hand: [0.14, 1.47, 0.07], elbow: [1, -0.15, 0], twist: PALM_OUT, fingers: OPEN }, 1);
    }
  },

  // Фигурки: руки складываются в прямые углы, как падающие блоки, под народный притоп.
  blocks(b, k, l) {
    const n = Math.floor(b / 2) % 4;
    const UP: Partial<ArmPose> = { hand: [0.13, 1.63, 0], elbow: [1, 0, -0.3], fingers: FLAT, wrist: [0, 0, 0] };
    const SIDE: Partial<ArmPose> = { hand: [0.5, 1.27, 0.02], elbow: [0, -1, -0.3], fingers: FLAT, wrist: [0, 0, 0] };
    const OVER: Partial<ArmPose> = { hand: [-0.02, 1.6, 0.04], elbow: [1, 0.3, 0], fingers: FLAT, wrist: [0, 0, 0.3] };
    const LOW: Partial<ArmPose> = { hand: [0.36, 0.97, 0.1], elbow: [0.6, 0, -1], fingers: FLAT, wrist: [0, 0, 0] };
    const shapes: [Partial<ArmPose>, Partial<ArmPose>][] = [
      [UP, SIDE],
      [SIDE, SIDE],
      [SIDE, UP],
      [OVER, LOW],
    ];
    put(l.arm[0], k, shapes[n][0], 1);
    put(l.arm[1], k, shapes[n][1], 1);
    l.bob += bounce(b) * 0.013 * k;
    l.roll += (Math.floor(b) % 2 ? 1 : -1) * 0.035 * k;
    l.headYaw += [0.14, 0, -0.14, 0.08][n] * k;
    l.happy = Math.max(l.happy, 0.55 * k);
  },

  // Обманщица: грозит пальцем «нет-нет», рука в бок, бёдра и плечи ходят; раз в
  // два такта — руки вверх, «а вот и я».
  liar(b, k, l) {
    const wag = Math.sin(TAU * b);
    l.turn += swing(b, 2) * 0.1 * k;
    l.roll += swing(b, 2) * 0.045 * k;
    l.headRoll += Math.sin((TAU * b) / 2 + 1) * 0.08 * k;
    l.headYaw -= wag * 0.05 * k;
    l.bob += bounce(b) * 0.008 * k;
    l.happy = Math.max(l.happy, 0.6 * k);
    if (frac(b / 8) >= 0.75) {
      for (const over of l.arm) put(over, k, { hand: [0.33, 1.52, 0.1], elbow: [0.9, -0.4, 0], twist: PALM_OUT, fingers: OPEN, spread: 0.28 }, 0.8);
      l.turn += 0.12 * k;
      return;
    }
    put(l.arm[1], k, {
      hand: [0.2 + wag * 0.03, 1.4, 0.2],
      elbow: [0.6, -1, 0.1],
      twist: PALM_OUT,
      wrist: [0, wag * 0.45, 0.1],
      fingers: POINT,
    });
    put(l.arm[0], k, AKIMBO);
  },

  // Приём у врача: градусник ко лбу, пульс на запястье, массаж сердца, «не годен».
  clinic(b, k, l) {
    const n = Math.floor(b / 2) % 4;
    l.bob += bounce(b) * 0.006 * k;
    l.happy = Math.max(l.happy, 0.3 * k);
    if (n === 0) {
      put(l.arm[1], k, { hand: [0.03, 1.49, 0.12], elbow: [1, -0.3, 0.2], twist: PALM_OUT, fingers: OPEN }, 0.7);
      l.headPitch -= 0.06 * k;
      l.lids = Math.max(l.lids, 0.4 * k);
    } else if (n === 1) {
      put(l.arm[0], k, { hand: [0.08, 1.13, 0.3], elbow: [0.5, -1, 0], twist: Math.PI / 2, fingers: OPEN }, 0.7);
      put(l.arm[1], k, { hand: [-0.03, 1.16, 0.31], elbow: [0.7, -0.8, 0.1], fingers: [0.4, 0.2, 0.2, 0.6, 0.7] }, 0.7);
      l.headPitch += 0.13 * k;
    } else if (n === 2) {
      const pump = bounce(b * 2) * 0.06;
      for (const over of l.arm) put(over, k, { hand: [0.012, 1.07 + pump, 0.32], elbow: [0.8, -0.3, 0.3], fingers: FLAT }, 1);
      l.bob -= (0.06 - pump) * 0.2 * k;
      l.lean += 0.06 * k;
    } else {
      for (const over of l.arm) put(over, k, { hand: [-0.07, 1.25, 0.17], elbow: [0.5, -1, 0.3], fingers: FIST }, 1);
      l.headYaw += Math.sin(TAU * b * 2) * 0.12 * k;
    }
  },

  // Любительница людей: высматривает зрителя в «бинокль» из ладоней, потом машет ему.
  peek(b, k, l) {
    const scan = swing(b, 4);
    l.turn += scan * 0.22 * k;
    l.headYaw += scan * 0.2 * k;
    l.lean += 0.06 * k;
    l.bob += bounce(b) * 0.006 * k;
    l.happy = Math.max(l.happy, 0.5 * k);
    l.surprised = Math.max(l.surprised, 0.15 * k);
    const tube: Partial<ArmPose> = { hand: [0.045, 1.43, 0.13], elbow: [1, -0.25, 0.1], fingers: TUBE };
    put(l.arm[0], k, tube);
    if (frac(b / 8) >= 0.5) {
      put(l.arm[1], k, { hand: [0.28 + Math.sin(TAU * b) * 0.03, 1.43, 0.1], elbow: [0.6, -1, 0], twist: PALM_OUT, wrist: [0, Math.sin(TAU * b) * 0.3, 0.12], fingers: OPEN, spread: 0.14 });
    } else {
      put(l.arm[1], k, tube);
    }
  },

  // Машина: предплечья ходят под прямым углом, голова щёлкает из стороны в сторону;
  // в конце каждого второго такта руки сходятся у сердца.
  robot(b, k, l) {
    const n = Math.floor(b) % 2;
    l.bob -= hit(b) * 0.01 * k;
    l.lids = Math.max(l.lids, 0.12 * k);
    if (frac(b / 8) >= 0.75) {
      for (const over of l.arm) put(over, k, { hand: [0.015, 1.17, 0.15], elbow: [0.7, -0.7, 0.1], fingers: [0.2, 0.3, 0.36, 0.42, 0.5] }, 0.6);
      l.headRoll += 0.13 * k;
      l.happy = Math.max(l.happy, 0.9 * k);
      return;
    }
    const up: Partial<ArmPose> = { hand: [0.3, 1.5, 0.12], elbow: [1, -0.1, 0], twist: PALM_OUT, fingers: FLAT, wrist: [0, 0, 0] };
    const down: Partial<ArmPose> = { hand: [0.3, 1.02, 0.14], elbow: [1, -0.1, -0.2], fingers: FLAT, wrist: [0, 0, 0] };
    put(l.arm[0], k, n ? down : up, 1);
    put(l.arm[1], k, n ? up : down, 1);
    l.headYaw += (n ? 0.16 : -0.16) * k;
    l.turn += (n ? -0.06 : 0.06) * k;
    l.happy = Math.max(l.happy, 0.3 * k);
  },

  // Озорница: кулачки у плеч ходят вверх-вниз, бёдра качаются из стороны в сторону.
  sway(b, k, l) {
    const s = swing(b, 2);
    l.roll += s * 0.07 * k;
    l.turn += s * 0.06 * k;
    l.headRoll -= s * 0.1 * k;
    l.bob += bounce(b) * 0.012 * k;
    l.happy = Math.max(l.happy, 0.7 * k);
    put(l.arm[0], k, { hand: [0.17, 1.14 + s * 0.05, 0.13], elbow: [1, -0.5, 0], fingers: FIST });
    put(l.arm[1], k, { hand: [0.17, 1.14 - s * 0.05, 0.13], elbow: [1, -0.5, 0], fingers: FIST });
  },
};

/**
 * Наложить танец на то, что «мелкая жизнь» решила в этом кадре.
 * @param beats сколько долей прошло с начала песни (дробное)
 * @param k     0…1, насколько танец взял верх
 */
export function applyDance(name: DanceName, beats: number, k: number, live: Life): void {
  DANCES[name](beats, k, live);
  // Подпевает: рот приоткрывается на каждую полудолю.
  live.mouth = Math.max(live.mouth, (0.12 + 0.3 * bounce(beats * 2)) * k);
  live.calm = Math.max(live.calm, 0.6 * k);
  // За курсором следит вполглаза: занята.
  live.attend *= 1 - 0.5 * k;
}

export const DANCE_NAMES = Object.keys(DANCES) as DanceName[];
