// Свет сцены: у каждой главы своё настроение, между главами оно плавно меняется.
// Ключевой свет даёт настоящую тень персонажа и предметов на стенах.
import * as THREE from 'three/webgpu';

interface Mood {
  sky: string;
  ground: string;
  ambient: number;
  key: string;
  keyPower: number;
  rim: string;
  rimPower: number;
}

const MOODS: Mood[] = [
  // Гримёрка: тёплый свет ламп.
  { sky: '#fff6ea', ground: '#8f7f78', ambient: 1.05, key: '#fff0dc', keyPower: 2.5, rim: '#ffd0dc', rimPower: 1.2 },
  // Мастерская: прохладнее и темнее, свет будто через цветное стекло.
  { sky: '#e9ecff', ground: '#6f6a86', ambient: 0.95, key: '#eaf0ff', keyPower: 2.3, rim: '#ffc98a', rimPower: 1.5 },
  // Стол художника: ровный дневной свет.
  { sky: '#ffffff', ground: '#a9a59c', ambient: 1.15, key: '#ffffff', keyPower: 2.5, rim: '#e6ecff', rimPower: 1.0 },
];

export interface Lights {
  /** @param s положение прокрутки в главах */
  step(s: number): void;
  /**
   * Контровой свет из-за спины. step() каждый кадр ставит его по настроению главы;
   * шоу под музыку (fx/show.ts) после этого может его перекрасить.
   */
  rim: THREE.DirectionalLight;
}

/** @param shadows отбрасывать ли тени (на слабых машинах выключено) */
export function createLights(scene: THREE.Scene, shadows: boolean): Lights {
  const hemi = new THREE.HemisphereLight('#ffffff', '#8a8fa8', 1.1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(1.7, 3.1, 2.6);
  key.target.position.set(0, 1.1, -0.9);
  scene.add(key, key.target);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera;
    cam.left = -2.7;
    cam.right = 2.7;
    cam.top = 2.4;
    cam.bottom = -2.2;
    cam.near = 0.5;
    cam.far = 9;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
  }

  const rim = new THREE.DirectionalLight('#ffd0dc', 1.2);
  rim.position.set(-2, 1.6, -0.6);
  scene.add(rim);

  const a = new THREE.Color();
  const b = new THREE.Color();
  const mix = (target: THREE.Color, from: string, to: string, t: number) => target.copy(a.set(from)).lerp(b.set(to), t);

  return {
    rim,
    step(s) {
      const last = MOODS.length - 1;
      const i = Math.min(Math.floor(Math.max(s, 0)), last);
      const j = Math.min(i + 1, last);
      const f = Math.min(Math.max(s - i, 0), 1);
      const t = f * f * (3 - 2 * f);
      const m = MOODS[i];
      const n = MOODS[j];
      mix(hemi.color, m.sky, n.sky, t);
      mix(hemi.groundColor, m.ground, n.ground, t);
      hemi.intensity = m.ambient + (n.ambient - m.ambient) * t;
      mix(key.color, m.key, n.key, t);
      key.intensity = m.keyPower + (n.keyPower - m.keyPower) * t;
      mix(rim.color, m.rim, n.rim, t);
      rim.intensity = m.rimPower + (n.rimPower - m.rimPower) * t;
    },
  };
}
