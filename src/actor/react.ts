// Реакции на клик по персонажу. Здесь только «сценарии» — что и когда происходит
// с головой, лицом и руками после тычка; к костям это прикладывают actor.ts и pose.ts.
//
// Каждая реакция — короткая функция от времени, прошедшего с клика.
// Повторные клики в одно место копятся: четыре тычка в лицо — обида,
// три поглаживания по макушке — радость.

export type Zone = 'face' | 'top' | 'drillL' | 'drillR' | 'body' | 'handL' | 'handR';

export interface Reaction {
  // Добавки к голове и телу, радианы и метры.
  headYaw: number;
  headPitch: number; // минус — голова назад и вверх
  headRoll: number; // плюс — к её левому плечу
  lean: number;
  shrug: number;
  bob: number; // вертикальный подскок таза
  // Лицо.
  blink: number;
  angry: number;
  happy: number;
  relaxed: number;
  surprised: number;
  calm: number; // 0…1: насколько заглушить лицо самой позы
  // Поведение.
  ignore: number; // 0…1: не смотреть на курсор
  awayYaw: number; // куда отвернуться, когда обижена
  guard: number; // руки к груди
  akimbo: number; // руки в боки
  push: [number, number]; // [левая, правая]: ладонь навстречу зрителю
  kick: [number, number]; // [левый, правый] локон: толчок пружинам
}

const zero = (): Reaction => ({
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  lean: 0,
  shrug: 0,
  bob: 0,
  blink: 0,
  angry: 0,
  happy: 0,
  relaxed: 0,
  surprised: 0,
  calm: 0,
  ignore: 0,
  awayYaw: 0,
  guard: 0,
  akimbo: 0,
  push: [0, 0],
  kick: [0, 0],
});

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Резкий всплеск: быстро вверх за attack, потом затухает. */
const pulse = (t: number, attack: number, decay: number) =>
  t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay);
/** Плато от a до b с мягкими краями. */
const hold = (t: number, a: number, b: number, fade: number) =>
  smoothstep(a, a + fade, t) * (1 - smoothstep(b - fade, b, t));

type Kind = Zone | 'sulk' | 'joy';

const DURATION: Record<Kind, number> = {
  face: 1.5,
  top: 1.7,
  drillL: 1.3,
  drillR: 1.3,
  body: 1.6,
  handL: 1.1,
  handR: 1.1,
  sulk: 3.6,
  joy: 2.3,
};

export function createReactor() {
  const out = zero();
  let kind: Kind | null = null;
  let age = 0;
  let side = 0; // с какой стороны от центра зоны пришёлся клик, −1…1
  let clock = 0;
  const recent: { zone: Zone; at: number }[] = [];

  return {
    /** Сейчас идёт реакция (нужно, чтобы не подмешивать испуг от зажатия). */
    get busy() {
      return kind !== null;
    },

    /** Забыть всё: текущую реакцию и недавние клики. */
    reset() {
      kind = null;
      age = 0;
      side = 0;
      clock = 0;
      recent.length = 0;
    },

    trigger(zone: Zone, offset: number) {
      recent.push({ zone, at: clock });
      while (recent.length && clock - recent[0].at > 4.5) recent.shift();
      const count = (z: Zone) => recent.filter((r) => r.zone === z).length;

      if (kind === 'sulk') return; // обиделась — не реагирует, пока не отойдёт
      if (zone === 'face' && count('face') >= 4) {
        kind = 'sulk';
        recent.length = 0;
      } else if (zone === 'top' && count('top') >= 3) {
        kind = 'joy';
        recent.length = 0;
      } else {
        kind = zone;
      }
      age = 0;
      side = offset;
    },

    update(dt: number): Reaction {
      clock += dt;
      Object.assign(out, zero());
      if (kind === null) return out;
      age += dt;
      if (age > DURATION[kind]) {
        kind = null;
        return out;
      }
      const a = age;

      switch (kind) {
        case 'face': {
          // Тычок в лицо: отдёрнулась, зажмурилась, потом надулась.
          const flinch = pulse(a, 0.05, 0.14);
          const pout = hold(a, 0.12, 1.5, 0.22);
          out.headPitch = -0.2 * flinch;
          out.headYaw = -side * 0.18 * flinch;
          out.headRoll = side * 0.08 * pout;
          out.lean = -0.06 * flinch;
          out.shrug = 0.12 * flinch + 0.03 * pout;
          out.blink = hold(a, 0, 0.32, 0.06);
          out.angry = 0.8 * pout;
          out.calm = Math.max(pout, out.blink);
          break;
        }
        case 'sulk': {
          // Довели: руки в боки, отвернулась, сначала с закрытыми глазами.
          const w = hold(a, 0, 3.6, 0.35);
          out.angry = w;
          out.calm = w;
          out.ignore = w;
          out.awayYaw = (side >= 0 ? -1 : 1) * 0.62;
          out.akimbo = w;
          out.headPitch = -0.07 * w;
          out.shrug = 0.05 * w;
          out.blink = hold(a, 0.1, 1.1, 0.12);
          break;
        }
        case 'top': {
          // Погладили по макушке: голова вниз, довольно покачивается.
          const w = hold(a, 0, 1.7, 0.25);
          out.relaxed = w;
          out.calm = w;
          out.headPitch = 0.1 * w;
          out.headRoll = Math.sin(a * 7) * 0.05 * w;
          out.bob = -0.012 * pulse(a, 0.05, 0.2);
          break;
        }
        case 'joy': {
          // Гладили много раз: радуется и подпрыгивает.
          const w = hold(a, 0, 2.3, 0.3);
          out.happy = w;
          out.calm = w;
          out.bob = Math.abs(Math.sin(a * 9)) * 0.016 * w;
          out.headRoll = Math.sin(a * 9) * 0.07 * w;
          out.shrug = 0.06 * w;
          break;
        }
        case 'drillL':
        case 'drillR': {
          // Дёрнули за локон: он раскачивается, голова качнулась, потом оборачивается посмотреть.
          const s = kind === 'drillL' ? 1 : -1;
          const flinch = pulse(a, 0.04, 0.12);
          out.kick[s === 1 ? 0 : 1] = a < 0.09 ? 1 : 0;
          out.headRoll = -s * 0.1 * flinch;
          out.headYaw = s * 0.28 * hold(a, 0.2, 1.2, 0.22);
          out.surprised = 0.7 * hold(a, 0, 0.45, 0.1);
          out.relaxed = 0.3 * hold(a, 0.4, 1.3, 0.2);
          out.calm = hold(a, 0, 1.3, 0.2);
          break;
        }
        case 'body': {
          // Тычок в корпус: отшатнулась, закрылась руками, смотрит сердито.
          const flinch = pulse(a, 0.04, 0.16);
          const w = hold(a, 0, 1.5, 0.2);
          out.guard = hold(a, 0.02, 1.25, 0.14);
          out.lean = -0.09 * flinch - 0.03 * w;
          out.shrug = 0.14 * flinch + 0.05 * w;
          out.headPitch = -0.05 * flinch;
          out.surprised = hold(a, 0, 0.5, 0.08);
          out.angry = 0.6 * hold(a, 0.45, 1.5, 0.2);
          out.calm = w;
          break;
        }
        case 'handL':
        case 'handR': {
          // Хлопнули по ладони: «дай пять» и улыбка.
          const i = kind === 'handL' ? 0 : 1;
          out.push[i] = hold(a, 0, 0.55, 0.12);
          out.happy = 0.85 * hold(a, 0.05, 1.1, 0.2);
          out.calm = hold(a, 0, 1.1, 0.2);
          out.bob = 0.008 * pulse(a, 0.06, 0.18);
          break;
        }
      }
      return out;
    },
  };
}

export type Reactor = ReturnType<typeof createReactor>;
