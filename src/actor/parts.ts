// Разметка частей тела для G-буфера (см. core/gbuffer.ts).
// Каждой вершине модели записывается vec2(ярус, рука): по главной кости, которая
// её двигает. Волосы и ленты висят на костях головы и получают её ярус, юбка — торса.
import * as THREE from 'three/webgpu';
import type { VRM } from '@pixiv/three-vrm';
import { PART } from '../core/gbuffer';

type Part = [level: number, arm: number];

const HEAD: Part = [1, 0];
const TORSO: Part = [0.5, 0];
const ARM_L: Part = [0.5, 1];
const ARM_R: Part = [0.5, -1];
const LEGS: Part = [0, 0];

function partOf(boneName: string): Part {
  if (/^(head|neck|jaw|leftEye|rightEye)$/.test(boneName)) return HEAD;
  if (/Leg|Foot|Toes/.test(boneName)) return LEGS;
  if (/Shoulder$|^hips$|^spine$|hest$/.test(boneName)) return TORSO;
  if (boneName.startsWith('left')) return ARM_L; // остались плечо-предплечье-кисть-пальцы
  if (boneName.startsWith('right')) return ARM_R;
  return TORSO;
}

export function markBodyParts(vrm: VRM): void {
  const humanoid = vrm.humanoid;
  if (!humanoid) return;

  // Кость скелета → часть тела: поднимаемся по родителям до ближайшей «человеческой» кости.
  const named = new Map<THREE.Object3D, Part>();
  for (const name of Object.keys(humanoid.humanBones)) {
    const node = humanoid.getRawBoneNode(name as Parameters<typeof humanoid.getRawBoneNode>[0]);
    if (node) named.set(node, partOf(name));
  }
  const cache = new Map<THREE.Object3D, Part>();
  const classify = (node: THREE.Object3D | null): Part => {
    for (let n = node; n; n = n.parent) {
      const known = named.get(n) ?? cache.get(n);
      if (known) {
        if (node) cache.set(node, known);
        return known;
      }
    }
    return TORSO;
  };

  vrm.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry?.isBufferGeometry) return;
    const count = geometry.getAttribute('position').count;
    const data = new Float32Array(count * 2);
    const index = geometry.getAttribute('skinIndex');
    const weight = geometry.getAttribute('skinWeight');

    if (mesh.isSkinnedMesh && index && weight) {
      const perBone = mesh.skeleton.bones.map((b) => classify(b));
      for (let v = 0; v < count; v++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (weight.getComponent(v, k) > weight.getComponent(v, best)) best = k;
        const part = perBone[index.getComponent(v, best)] ?? TORSO;
        data[v * 2] = part[0];
        data[v * 2 + 1] = part[1];
      }
    } else {
      // Жёсткая деталь без скелета: вся целиком принадлежит кости, на которой висит.
      const part = classify(mesh);
      for (let v = 0; v < count; v++) {
        data[v * 2] = part[0];
        data[v * 2 + 1] = part[1];
      }
    }
    geometry.setAttribute(PART, new THREE.Float32BufferAttribute(data, 2));
  });
}
