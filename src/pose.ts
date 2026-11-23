// Позы и «жизнь» персонажа: у каждой главы своя поза, между ними плавный переход,
// поверх — дыхание, перенос веса и реакция на зажатую кнопку мыши.
//
// Руки ставятся обратной кинематикой: в позе записано, ГДЕ должно быть запястье,
// а углы плеча и локтя вычисляются. Так позу можно править, глядя на картинку,
// и переходы между позами идут по естественным дугам.
//
// Кисти живут отдельной жизнью: пальцы и запястье сидят на пружинах (доезжают
// чуть позже руки и слегка проскакивают), запястье «отстаёт» при движении,
// пальцы понемногу шевелятся, а у некоторых поз есть свой жест.
import * as THREE from 'three/webgpu';
import type { VRM } from '@pixiv/three-vrm';
import type { Reaction } from './react';

type V3 = [number, number, number];
type BoneName = Parameters<NonNullable<VRM['humanoid']>['getNormalizedBoneNode']>[0];

/**
 * Рука. Координаты в метрах в системе персонажа: Y вверх, Z на зрителя,
 * X — в сторону СВОЕЙ руки (для правой руки ось уже отражена, так что
 * одна и та же запись годится для обеих рук; отрицательный X = через середину тела).
 */
export interface ArmPose {
  hand: V3; // куда поставить запястье
  elbow: V3; // куда стремится локоть
  twist: number; // поворот предплечья вокруг своей оси
  wrist: V3; // кисть относительно предплечья: [вокруг оси руки, вбок, сгиб (+ разгибание)]
  fingers: [number, number, number, number, number]; // сгиб 0…1: большой, указательный, средний, безымянный, мизинец
  spread: number; // веер пальцев
  reach: number; // 0…1: тянуться к точке под курсором
  drum: number; // жест: пальцы по очереди постукивают
  wave: number; // жест: кисть покачивается, пальцы «ножницами»
  grasp: number; // жест: пальцы ловят то, к чему тянется рука
}

export interface Pose {
  name: string;
  left: ArmPose;
  right: ArmPose;
  lean: number; // наклон корпуса вперёд
  turn: number; // разворот корпуса (плюс — к её левому плечу)
  roll: number; // перекос таза: вес на левой (+) или правой (−) ноге
  tilt: number; // наклон головы к плечу
  shrug: number; // плечи вверх
  face: { relaxed: number; happy: number; surprised: number; wink: number };
}

const REST: ArmPose = {
  hand: [0.185, 0.862, 0.03],
  elbow: [0.5, 0, -1],
  twist: 0,
  wrist: [0, 0.06, -0.14], // висящая кисть чуть согнута, а не продолжает предплечье по линейке
  fingers: [0.25, 0.26, 0.33, 0.42, 0.5],
  spread: 0,
  reach: 0,
  drum: 0,
  wave: 0,
  grasp: 0,
};

const arm = (over: Partial<ArmPose>): ArmPose => ({ ...REST, ...over });

// Позы рук для реакций на клик: подмешиваются поверх позы главы.
const GUARD_LEFT = arm({
  hand: [0.035, 1.1, 0.15],
  elbow: [0.6, -0.8, 0.1],
  wrist: [0, -0.08, 0.16],
  fingers: [0.3, 0.2, 0.25, 0.3, 0.36],
});
const GUARD_RIGHT = arm({ ...GUARD_LEFT, hand: [0.035, 1.16, 0.135] });
const AKIMBO = arm({
  hand: [0.165, 0.965, 0.02],
  elbow: [1, 0, -0.45],
  wrist: [0, 0, 0.3],
  fingers: [0.15, 0.3, 0.36, 0.42, 0.48],
  spread: 0.05,
});

// По позе на главу, в том же порядке, что и шкуры.
export const POSES: Pose[] = [
  {
    name: 'Default — рука на груди',
    left: arm({}),
    right: arm({
      hand: [0.045, 1.13, 0.125],
      elbow: [0.7, -0.7, 0.1],
      wrist: [0, -0.08, 0.16],
      fingers: [0.1, 0.04, 0.08, 0.14, 0.22],
      spread: 0.07,
      drum: 0.7,
    }),
    lean: 0,
    turn: 0.05,
    roll: -0.03,
    tilt: 0.07,
    shrug: 0,
    face: { relaxed: 0.4, happy: 0, surprised: 0, wink: 0 },
  },
  {
    name: 'Mosaic — машет рукой',
    left: arm({}),
    right: arm({
      hand: [0.27, 1.4, 0.09],
      elbow: [0.6, -1, 0],
      twist: Math.PI, // ладонью к зрителю
      wrist: [0, 0, 0.12],
      fingers: [0.05, 0, 0, 0.03, 0.06],
      spread: 0.14,
      wave: 1,
    }),
    lean: 0,
    turn: -0.06,
    roll: -0.04,
    tilt: -0.08,
    shrug: 0.03,
    face: { relaxed: 0.15, happy: 0.55, surprised: 0, wink: 0 },
  },
  {
    name: 'Sketch — тянется с листа к линзе',
    // Тянется та рука, с чьей стороны сейчас курсор; вторая висит свободно.
    left: arm({ elbow: [0.3, -1, 0], fingers: [0, 0, 0, 0.04, 0.08], spread: 0.25, reach: 1, grasp: 1 }),
    right: arm({ elbow: [0.3, -1, 0], fingers: [0, 0, 0, 0.04, 0.08], spread: 0.25, reach: 1, grasp: 1 }),
    lean: 0.07,
    turn: 0.1,
    roll: 0,
    tilt: 0.04,
    shrug: 0,
    face: { relaxed: 0.25, happy: 0, surprised: 0.15, wink: 0 },
  },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = THREE.MathUtils.clamp;
const X_AXIS = new THREE.Vector3(1, 0, 0);

// Куда расходится каждый палец в веере и насколько он согнут даже в «прямой» ладони:
// живая кисть никогда не бывает доской, мизинец всегда согнут сильнее указательного.
const FAN = [0, -1, -0.15, 0.5, 1];
const SOFT = [0, 0.05, 0.07, 0.11, 0.17];

function mixArm(out: ArmPose, a: ArmPose, b: ArmPose, t: number) {
  for (let i = 0; i < 3; i++) {
    out.hand[i] = lerp(a.hand[i], b.hand[i], t);
    out.elbow[i] = lerp(a.elbow[i], b.elbow[i], t);
    out.wrist[i] = lerp(a.wrist[i], b.wrist[i], t);
  }
  for (let i = 0; i < 5; i++) out.fingers[i] = lerp(a.fingers[i], b.fingers[i], t);
  out.twist = lerp(a.twist, b.twist, t);
  out.spread = lerp(a.spread, b.spread, t);
  out.reach = lerp(a.reach, b.reach, t);
  out.drum = lerp(a.drum, b.drum, t);
  out.wave = lerp(a.wave, b.wave, t);
  out.grasp = lerp(a.grasp, b.grasp, t);
}

const blankArm = (): ArmPose => ({
  hand: [0, 0, 0],
  elbow: [0, 0, 0],
  twist: 0,
  wrist: [0, 0, 0],
  fingers: [0, 0, 0, 0, 0],
  spread: 0,
  reach: 0,
  drum: 0,
  wave: 0,
  grasp: 0,
});

export interface Mood {
  chapter: number; // дробный номер главы из прокрутки
  press: number; // 0…1, насколько зажата кнопка мыши
}

export interface Poser {
  poses: Pose[];
  /**
   * Ставит кости тела и рук. Возвращает текущую смешанную позу (наклон головы, лицо).
   * @param lookPoint точка под курсором, мир
   * @param react     текущая реакция на клик
   * @param eye       положение камеры — к ней тянется ладонь в «дай пять»
   */
  update(
    dt: number,
    t: number,
    mood: Mood,
    lookPoint: THREE.Vector3,
    react: Reaction,
    eye: THREE.Vector3,
  ): Pose;
}

/** Пружина: значение догоняет цель с небольшим проскоком. */
class Spring {
  x = 0;
  v = 0;
  private primed = false;
  constructor(
    private stiffness: number,
    private damping: number,
  ) {}
  step(target: number, dt: number): number {
    if (!this.primed) {
      this.x = target;
      this.primed = true;
      return this.x;
    }
    // Два подшага: устойчиво и при редких кадрах.
    const h = Math.min(dt, 0.05) / 2;
    for (let i = 0; i < 2; i++) {
      this.v += ((target - this.x) * this.stiffness - this.v * this.damping) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

interface ArmRig {
  side: 1 | -1;
  shoulder: THREE.Object3D | null;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D | null;
  l1: number;
  l2: number;
  target: THREE.Vector3; // сглаженная цель запястья, мир
  prev: THREE.Vector3; // она же кадр назад — для скорости
  vel: THREE.Vector3;
  ready: boolean;
  fingers: (THREE.Object3D | null)[][]; // [палец][сустав]
  curl: Spring[];
  spread: Spring;
  wrist: Spring[];
}

export function createPoser(vrm: VRM): Poser | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  const bone = (name: BoneName) => humanoid.getNormalizedBoneNode(name) ?? null;

  const hips = bone('hips');
  const spine = bone('spine');
  const chest = bone('chest');
  const upperChest = bone('upperChest');
  if (!hips || !spine) return null;

  // У VRM 0.x скелет развёрнут на 180° вокруг вертикали: оси X и Z зеркальны.
  const flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
  /** Поворот кости в «анатомической» записи: для правой стороны и для VRM 0.x знаки ставятся сами. */
  const setEuler = (b: THREE.Object3D | null, x: number, y: number, z: number, side: 1 | -1 = 1) => {
    if (b) b.rotation.set(x * flip, y * side, z * side * flip);
  };

  vrm.scene.updateMatrixWorld(true);
  const hipsRest = hips.position.clone();
  // Исходная ориентация всех костей нормализованного скелета в мире.
  const q0 = (hips.parent ?? vrm.scene).getWorldQuaternion(new THREE.Quaternion());
  const q0inv = q0.clone().invert();

  const makeArm = (side: 1 | -1): ArmRig | null => {
    const p = side === 1 ? 'left' : 'right';
    const upper = bone(`${p}UpperArm` as BoneName);
    const lower = bone(`${p}LowerArm` as BoneName);
    const hand = bone(`${p}Hand` as BoneName);
    if (!upper || !lower || !hand) return null;
    const a = upper.getWorldPosition(new THREE.Vector3());
    const b = lower.getWorldPosition(new THREE.Vector3());
    const c = hand.getWorldPosition(new THREE.Vector3());
    const finger = (name: string, joints: string[]) =>
      joints.map((j) => bone(`${p}${name}${j}` as BoneName));
    return {
      side,
      shoulder: bone(`${p}Shoulder` as BoneName),
      upper,
      lower,
      hand,
      l1: a.distanceTo(b),
      l2: b.distanceTo(c),
      target: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      ready: false,
      fingers: [
        finger('Thumb', ['Metacarpal', 'Proximal', 'Distal']),
        finger('Index', ['Proximal', 'Intermediate', 'Distal']),
        finger('Middle', ['Proximal', 'Intermediate', 'Distal']),
        finger('Ring', ['Proximal', 'Intermediate', 'Distal']),
        finger('Little', ['Proximal', 'Intermediate', 'Distal']),
      ],
      // У каждого пальца своя жёсткость: мизинец мягче и доезжает последним.
      curl: [0, 1, 2, 3, 4].map((f) => new Spring(150 - f * 14, 15 - f)),
      spread: new Spring(110, 13),
      wrist: [new Spring(90, 11), new Spring(90, 11), new Spring(90, 11)],
    };
  };
  const arms = [makeArm(1), makeArm(-1)].filter((a): a is ArmRig => a !== null);

  const cur: Pose = {
    name: '',
    left: blankArm(),
    right: blankArm(),
    lean: 0,
    turn: 0,
    roll: 0,
    tilt: 0,
    shrug: 0,
    face: { relaxed: 0, happy: 0, surprised: 0, wink: 0 },
  };

  // Рабочие объекты, чтобы не плодить мусор в каждом кадре.
  const S = new THREE.Vector3();
  const T = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const E = new THREE.Vector3();
  const uDir = new THREE.Vector3();
  const lDir = new THREE.Vector3();
  const restDir = new THREE.Vector3();
  const reach = new THREE.Vector3();
  const back = new THREE.Vector3();
  const thumbSide = new THREE.Vector3();
  const qParent = new THREE.Quaternion();
  const qU = new THREE.Quaternion();
  const qL = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();

  function solveArm(
    rig: ArmRig,
    p: ArmPose,
    dt: number,
    t: number,
    press: number,
    look: THREE.Vector3,
    push: number,
    eye: THREE.Vector3,
  ) {
    const { side, upper, lower } = rig;
    const seed = side * 1.9; // чтобы руки не двигались синхронно
    upper.getWorldPosition(S);

    // Цель запястья: из позы, плюс лёгкий дрейф, плюс вздрагивание при нажатии.
    T.set(p.hand[0] * side, p.hand[1], p.hand[2]);
    T.x += Math.sin(t * 0.7 + seed) * 0.006;
    T.y += Math.sin(t * 0.9 + seed * 2) * 0.006 + press * 0.035 + Math.sin(t * 2.2) * 0.006 * p.wave;
    T.z += press * 0.02;

    // Тянется только рука со стороны курсора, чтобы не перекрещивать руку через лицо.
    const reaching = p.reach * THREE.MathUtils.smoothstep(look.x * side, -0.08, 0.08);
    if (reaching > 0.001) {
      // От плеча к точке под курсором, но не дальше своей длины и не за спину.
      reach.copy(look).sub(S);
      reach.z = Math.max(reach.z, 0.12);
      reach.x = clamp(reach.x, -0.3, 0.3);
      reach.y = clamp(reach.y, -0.3, 0.25);
      reach.normalize().multiplyScalar((rig.l1 + rig.l2) * 0.93).add(S);
      T.lerp(reach, reaching);
    }

    if (push > 0.001) {
      // «Дай пять»: ладонь выбрасывается навстречу зрителю.
      reach.copy(eye).sub(S);
      reach.y -= 0.05;
      reach.normalize().multiplyScalar((rig.l1 + rig.l2) * 0.95).add(S);
      T.lerp(reach, push);
    }

    if (!rig.ready) {
      rig.target.copy(T);
      rig.prev.copy(T);
      rig.ready = true;
    }
    // Реакции резче обычных переходов между позами.
    rig.target.lerp(T, 1 - Math.exp(-dt * (7 + push * 14)));
    if (dt > 1e-4) {
      // Скорость кисти, слегка сглаженная.
      S.copy(rig.target).sub(rig.prev).divideScalar(dt);
      rig.vel.lerp(S, 1 - Math.exp(-dt * 12));
      upper.getWorldPosition(S);
    }
    rig.prev.copy(rig.target);

    // Треугольник плечо–локоть–запястье.
    dir.copy(rig.target).sub(S);
    const len = clamp(dir.length(), Math.abs(rig.l1 - rig.l2) + 0.02, (rig.l1 + rig.l2) * 0.999);
    dir.normalize();
    const cosA = clamp((rig.l1 * rig.l1 + len * len - rig.l2 * rig.l2) / (2 * rig.l1 * len), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    pole.set(p.elbow[0] * side, p.elbow[1], p.elbow[2]);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0).addScaledVector(dir, dir.y);
    pole.normalize();
    E.copy(S).addScaledVector(dir, rig.l1 * cosA).addScaledVector(pole, rig.l1 * sinA);

    uDir.copy(E).sub(S).normalize();
    lDir.copy(S).addScaledVector(dir, len).sub(E).normalize();
    restDir.set(side, 0, 0); // в T-позе рука смотрит строго вбок

    (rig.shoulder ?? upper.parent!).getWorldQuaternion(qParent);
    qU.setFromUnitVectors(restDir, uDir).multiply(q0);
    qL.setFromUnitVectors(uDir, lDir).multiply(qU);
    upper.quaternion.copy(qParent).invert().multiply(qU);
    lower.quaternion.copy(qU).invert().multiply(qL);
    qTmp.setFromAxisAngle(X_AXIS, p.twist * flip);
    lower.quaternion.multiply(qTmp);

    // ── кисть ───────────────────────────────────────────────────────────
    // Запястье «отстаёт»: когда рука едет тыльной стороной вперёд, кисть подгибается
    // назад, когда вбок — отклоняется против движения. Оси берём из текущего
    // положения предплечья в мире.
    qL.multiply(qTmp).multiply(q0inv);
    back.set(0, 1, 0).applyQuaternion(qL); // куда смотрит тыльная сторона ладони
    thumbSide.set(0, 0, 1).applyQuaternion(qL); // в какую сторону большой палец
    const dragFlex = clamp(-rig.vel.dot(back) * 0.55, -0.45, 0.45);
    const dragSide = clamp(rig.vel.dot(thumbSide) * 0.55, -0.35, 0.35);

    const rock = Math.sin(t * 2.2 + seed) * p.wave;
    const wx = rig.wrist[0].step(p.wrist[0] + rock * 0.16, dt);
    const wy = rig.wrist[1].step(
      p.wrist[1] + dragSide + Math.sin(t * 0.6 + seed) * 0.03 + rock * 0.05,
      dt,
    );
    const wz = rig.wrist[2].step(
      p.wrist[2] + dragFlex + Math.sin(t * 0.47 + seed * 1.3) * 0.04 - press * 0.15,
      dt,
    );
    setEuler(rig.hand, wx, wy, wz, side);

    // Форма ладони. У «тянущейся» позы ладонь раскрыта только у той руки, что сейчас тянется.
    const shape = p.reach > 0.001 ? reaching / p.reach : 1;
    // От неожиданности и в «дай пять» пальцы раскрываются.
    const open = (1 - press * 0.7) * (1 - push * 0.9);

    // Постукивание: два прохода «мизинец → указательный» раз в несколько секунд.
    const beat = (t * 1.25 + seed * 1.7 + 40) % 6.5;
    // Ловящее движение, когда рука тянется.
    const grab = (0.5 + 0.5 * Math.sin(t * 1.9 + seed)) * 0.28 * p.grasp * shape;

    const spread = rig.spread.step(
      p.spread * shape + press * 0.15 + push * 0.28 + Math.sin(t * 3.1 + seed) * 0.05 * p.wave,
      dt,
    );

    for (let f = 1; f < 5; f++) {
      let c = lerp(REST.fingers[f], p.fingers[f], shape);
      // Каждый палец понемногу шевелится в своём ритме.
      c += (Math.sin(t * (0.9 + f * 0.23) + f * 1.7 + seed) + Math.sin(t * (0.37 + f * 0.11) + f * 0.6 - seed)) * 0.016;
      c += grab * (0.7 + f * 0.1);
      for (const start of [0, 0.75]) {
        const ph = beat - start - (4 - f) * 0.11;
        if (ph > 0 && ph < 0.26) c -= Math.sin((ph / 0.26) * Math.PI) * 0.22 * p.drum;
      }
      c = rig.curl[f].step(clamp(c * open, -0.12, 1.05), dt);
      // Даже «прямой» палец слегка согнут; чем ближе к кулаку, тем меньше эта поправка.
      const k = c + SOFT[f] * Math.max(0, 1 - c);
      const [a, b, d] = rig.fingers[f];
      setEuler(a, 0, FAN[f] * (spread + 0.045 * Math.max(0, 1 - k)), -k * 1.25, side);
      setEuler(b, 0, 0, -k * 1.55, side);
      setEuler(d, 0, 0, -k * 0.95, side);
    }

    // Большой палец. В T-позе он торчит под 45° — в покое его надо прижать к ладони
    // и чуть завести под неё, иначе получается «автостоп».
    let tc = lerp(REST.fingers[0], p.fingers[0], shape) + grab * 0.6;
    tc += Math.sin(t * 0.8 + seed * 0.7) * 0.03;
    tc = rig.curl[0].step(clamp(tc * open, 0, 1.05), dt);
    const [m, a, d] = rig.fingers[0];
    setEuler(m, 0.16 + tc * 0.45, 0.3 + tc * 0.27 - spread * 0.9, 0, side);
    setEuler(a, 0, 0.1 + tc * 0.5, 0, side);
    setEuler(d, 0, 0.05 + tc * 0.6, 0, side);
  }

  return {
    poses: POSES,
    update(dt, t, mood, lookPoint, react, eye) {
      // Поза главы: смесь двух соседних по прокрутке.
      const last = POSES.length - 1;
      const s = clamp(mood.chapter, 0, last);
      const i = Math.min(Math.floor(s), last);
      const a = POSES[i];
      const b = POSES[Math.min(i + 1, last)];
      const f = smooth(s - i);
      mixArm(cur.left, a.left, b.left, f);
      mixArm(cur.right, a.right, b.right, f);
      cur.lean = lerp(a.lean, b.lean, f);
      cur.turn = lerp(a.turn, b.turn, f);
      cur.roll = lerp(a.roll, b.roll, f);
      cur.tilt = lerp(a.tilt, b.tilt, f);
      cur.shrug = lerp(a.shrug, b.shrug, f);
      cur.face.relaxed = lerp(a.face.relaxed, b.face.relaxed, f);
      cur.face.happy = lerp(a.face.happy, b.face.happy, f);
      cur.face.surprised = lerp(a.face.surprised, b.face.surprised, f);
      cur.face.wink = lerp(a.face.wink, b.face.wink, f);

      // Реакции на клик: руки к груди или в боки поверх позы главы.
      if (react.guard > 0.001) {
        mixArm(cur.left, cur.left, GUARD_LEFT, react.guard);
        mixArm(cur.right, cur.right, GUARD_RIGHT, react.guard);
      }
      if (react.akimbo > 0.001) {
        mixArm(cur.left, cur.left, AKIMBO, react.akimbo);
        mixArm(cur.right, cur.right, AKIMBO, react.akimbo);
      }

      const press = mood.press;

      // Живое тело: дыхание и медленный перенос веса с ноги на ногу.
      const breath = Math.sin(t * 1.5);
      const weight = Math.sin(t * 0.45) * 0.6 + Math.sin(t * 0.23 + 1.3) * 0.4;
      const roll = cur.roll + weight * 0.018;
      const lean = cur.lean - press * 0.07 + react.lean + breath * 0.006;
      const turn = cur.turn + Math.sin(t * 0.31) * 0.02;

      hips.position.set(
        hipsRest.x + roll * 0.35 * flip,
        hipsRest.y - Math.abs(roll) * 0.05 + breath * 0.002 + react.bob,
        hipsRest.z,
      );
      setEuler(hips, 0, turn * 0.3, roll);
      setEuler(spine, lean * 0.5, turn * 0.3, -roll * 0.6);
      setEuler(chest, lean * 0.3 - breath * 0.012, turn * 0.2, -roll * 0.3);
      setEuler(upperChest, lean * 0.2 - breath * 0.01, turn * 0.2, 0);

      const shrug = cur.shrug + press * 0.14 + react.shrug + breath * 0.012;
      for (const rig of arms) setEuler(rig.shoulder, 0, 0, shrug, rig.side);

      // Дальше нужны мировые положения плеч уже с учётом корпуса.
      hips.updateMatrixWorld(true);
      for (const rig of arms) {
        const left = rig.side === 1;
        solveArm(rig, left ? cur.left : cur.right, dt, t, press, lookPoint, react.push[left ? 0 : 1], eye);
      }

      cur.face.surprised = Math.min(1, cur.face.surprised + press);
      return cur;
    },
  };
}
