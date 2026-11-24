// Танец из файла: готовая дорожка поворотов костей по кадрам.
//
// Дорожку собирает scripts/motion.mjs из движения MMD (.vmd). Здесь она только
// проигрывается: на каждый кадр — повороты костей корпуса, рук и пальцев, сдвиг
// таза, точки для ступней и мимика. Колени считает решатель ног (pose.ts) под
// длину ног нашей модели, поэтому ступни стоят на полу, а не там, где они были
// у чужой модели с другими пропорциями.
//
// Повороты в файле записаны «по-мировому»: так, будто у каждой кости в исходной
// стойке оси смотрят вдоль осей мира. У нашего скелета исходная ориентация своя
// (rest.q0), поэтому каждый поворот пересаживается в неё.
import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three/webgpu';

import type { FootGoal, Poser } from './pose';

/**
 * Кусок танца на песне: с какой секунды песни он идёт и с какой секунды файла.
 * Куски идут подряд; каждый играет до начала следующего.
 */
export interface MotionClip {
  /** Секунда песни, с которой кусок начинается. */
  at: number;
  /** Секунда файла, которая в этот момент играет. */
  file: number;
  /** Раньше этой секунды файла кусок не показывать: стоять на ней, пока время не дойдёт. */
  min?: number;
  /** За сколько секунд перейти в этот кусок из предыдущего (0 — сразу). */
  fade: number;
  /** Сколько секунд предыдущий кусок ещё доигрывает, прежде чем начнётся переход. */
  hold?: number;
}

/** Что пластинка знает о своём танце из файла. */
export interface MotionInfo {
  /** Адрес дорожки. */
  url: string;
  /** Раскладка файла по песне. */
  clips: MotionClip[];
}

export interface Motion {
  /** Длина файла, секунды. */
  length: number;
  /** Подпись автора движения — её требуют показывать. */
  credit: string;
  /**
   * Поставить кости в позу на секунде песни time с весом k (0…1).
   * Звать после позы и головы, до vrm.update.
   */
  apply(clips: MotionClip[], time: number, k: number): void;
  /** Мимика того же кадра — поверх того, что лицо уже получило. */
  face(k: number): void;
}

/** Длина ноги модели, под которую делали движение, в единицах MMD. */
const LEG_UNITS = 10.3;

type BoneName = Parameters<NonNullable<VRM['humanoid']>['getNormalizedBoneNode']>[0];

export async function loadMotion(url: string, vrm: VRM, poser: Poser): Promise<Motion | null> {
  let buf: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    buf = await res.arrayBuffer();
  } catch {
    return null;
  }
  if (buf.byteLength < 16 || new TextDecoder('latin1').decode(new Uint8Array(buf, 0, 4)) !== 'KMTN') return null;
  const headSize = new DataView(buf).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headSize))) as {
    fps: number;
    frames: number;
    quats: string[];
    vecs: string[];
    faces: string[];
    credit: string;
  };
  const { fps, frames } = head;
  let at = 8 + headSize;
  const Q = new Int16Array(buf, at, frames * head.quats.length * 4);
  at += Q.byteLength;
  const V = new Float32Array(buf, at, frames * head.vecs.length * 3);
  at += V.byteLength;
  const F = new Uint8Array(buf, at, frames * head.faces.length);

  const humanoid = vrm.humanoid;
  const { q0, hipsLocal, hips: hipsWorld, ankles, leg } = poser.rest;
  const q0inv = q0.clone().invert();
  const unit = leg / LEG_UNITS; // единица MMD в метрах нашей модели

  const node = (name: string) => humanoid?.getNormalizedBoneNode(name as BoneName) ?? null;
  const hips = node('hips');
  if (!hips) return null;
  /** Кости, которые ставятся прямо из файла: [кость, номер в файле]. */
  const direct: [THREE.Object3D, number][] = [];
  head.quats.forEach((name, i) => {
    const bone = name === 'root' || name.endsWith('FootGoal') ? null : node(name);
    if (bone) direct.push([bone, i]);
  });
  // В файле «грудь» одна, у нас их две: верхняя остаётся прямой.
  const upperChest = node('upperChest');
  const iRoot = head.quats.indexOf('root');
  const iFoot = [head.quats.indexOf('leftFootGoal'), head.quats.indexOf('rightFootGoal')];
  const vBody = head.vecs.indexOf('body');
  const vFoot = [head.vecs.indexOf('leftFootGoal'), head.vecs.indexOf('rightFootGoal')];

  const nq = head.quats.length;
  const nv = head.vecs.length;
  const nf = head.faces.length;
  // Поза кадра: повороты, сдвиги, мимика. Вторая — для перехода между кусками.
  const pose = { q: new Float32Array(nq * 4), v: new Float32Array(nv * 3), f: new Float32Array(nf) };
  const other = { q: new Float32Array(nq * 4), v: new Float32Array(nv * 3), f: new Float32Array(nf) };

  /** Поза на секунде файла: между двумя соседними кадрами. */
  const sample = (time: number, out: typeof pose) => {
    const at = Math.min(Math.max(time * fps, 0), frames - 1);
    const f0 = Math.floor(at);
    const f1 = Math.min(f0 + 1, frames - 1);
    const mix = at - f0;
    for (let i = 0; i < nq; i++) {
      const a = (f0 * nq + i) * 4;
      const b = (f1 * nq + i) * 4;
      const sign = Q[a] * Q[b] + Q[a + 1] * Q[b + 1] + Q[a + 2] * Q[b + 2] + Q[a + 3] * Q[b + 3] < 0 ? -1 : 1;
      for (let c = 0; c < 4; c++) out.q[i * 4 + c] = Q[a + c] * (1 - mix) + Q[b + c] * mix * sign;
    }
    for (let i = 0; i < nv * 3; i++) out.v[i] = V[f0 * nv * 3 + i] * (1 - mix) + V[f1 * nv * 3 + i] * mix;
    for (let i = 0; i < nf; i++) out.f[i] = (F[f0 * nf + i] * (1 - mix) + F[f1 * nf + i] * mix) / 255;
  };
  /** Смешать позу с другой: mix = 1 — другая целиком. */
  const blend = (into: typeof pose, to: typeof pose, mix: number) => {
    for (let i = 0; i < nq; i++) {
      const o = i * 4;
      const sign = into.q[o] * to.q[o] + into.q[o + 1] * to.q[o + 1] + into.q[o + 2] * to.q[o + 2] + into.q[o + 3] * to.q[o + 3] < 0 ? -1 : 1;
      for (let c = 0; c < 4; c++) into.q[o + c] = into.q[o + c] * (1 - mix) + to.q[o + c] * mix * sign;
    }
    for (let i = 0; i < nv * 3; i++) into.v[i] += (to.v[i] - into.v[i]) * mix;
    for (let i = 0; i < nf; i++) into.f[i] += (to.f[i] - into.f[i]) * mix;
  };
  const fileTime = (clip: MotionClip, song: number) => Math.max(clip.min ?? -Infinity, clip.file + song - clip.at);
  /** Поза на секунде песни: нужный кусок, а в его начале — переход из предыдущего. */
  const seek = (clips: MotionClip[], song: number) => {
    let i = 0;
    while (i + 1 < clips.length && clips[i + 1].at <= song) i++;
    const clip = clips[i];
    const into = clip.fade > 0 && i > 0 ? (song - clip.at - (clip.hold ?? 0)) / clip.fade : 1;
    if (into >= 1) {
      sample(fileTime(clip, song), pose);
      return;
    }
    sample(fileTime(clips[i - 1], song), pose);
    if (into <= 0) return;
    sample(fileTime(clip, song), other);
    blend(pose, other, into * into * (3 - 2 * into));
  };

  const q = new THREE.Quaternion();
  const root = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const ONE = new THREE.Quaternion();
  const goals: [FootGoal, FootGoal] = [
    { pos: new THREE.Vector3(), rot: new THREE.Quaternion(), w: 0 },
    { pos: new THREE.Vector3(), rot: new THREE.Quaternion(), w: 0 },
  ];
  const quat = (i: number, out: THREE.Quaternion) => out.set(pose.q[i * 4], pose.q[i * 4 + 1], pose.q[i * 4 + 2], pose.q[i * 4 + 3]).normalize();
  const vec = (i: number, out: THREE.Vector3) => out.set(pose.v[i * 3], pose.v[i * 3 + 1], pose.v[i * 3 + 2]);

  return {
    length: frames / fps,
    credit: head.credit,
    apply(clips, time, k) {
      if (k <= 0.001) return;
      seek(clips, time);
      for (const [bone, i] of direct) {
        // Из «мировой» записи — в оси нашей кости.
        quat(i, q).premultiply(q0inv).multiply(q0);
        bone.quaternion.slerp(q, k);
      }
      upperChest?.quaternion.slerp(ONE, k);

      // Таз: общий разворот крутит тело вокруг точки на полу, сдвиг — в единицах MMD.
      quat(iRoot, root);
      vec(vBody, v).multiplyScalar(unit).add(hipsWorld).applyQuaternion(root).sub(hipsWorld);
      v.applyQuaternion(q0inv).add(hipsLocal);
      hips.position.lerp(v, k);

      // Ступни: куда встать и как повернуться; колени досчитает решатель.
      for (let side = 0; side < 2; side++) {
        const goal = goals[side];
        vec(vFoot[side], goal.pos).multiplyScalar(unit).add(ankles[side]).applyQuaternion(root);
        quat(iFoot[side], goal.rot).premultiply(root);
        goal.w = k;
      }
      poser.plant(goals);
    },
    face(k) {
      const em = vrm.expressionManager;
      if (!em || k <= 0.001) return;
      head.faces.forEach((name, i) => {
        const now = em.getValue(name) ?? 0;
        em.setValue(name, now + (pose.f[i] - now) * k);
      });
    },
  };
}
