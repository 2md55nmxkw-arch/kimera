// Камера: ракурс главы плюс небольшой параллакс от курсора.
import type * as THREE from 'three/webgpu';
import type { Frame } from '../core/contracts';
import { lerp, smooth } from '../core/math';

// Лёгкий облёт: у каждой главы свой ракурс.
const YAWS = [-0.16, 0.14, 0];

/** Ручная камера для крупных планов (включается из консоли в dev-сборке). */
export interface DebugView {
  on: boolean;
  pos: number[];
  target: number[];
}

/** @param headY высота центра лица персонажа */
export function placeCamera(camera: THREE.PerspectiveCamera, f: Frame, headY: number, debug: DebugView): void {
  const { s, pointer, aspect } = f;
  const last = YAWS.length - 1;
  const i0 = Math.min(Math.floor(s), last);
  const yaw = lerp(YAWS[i0], YAWS[Math.min(i0 + 1, last)], smooth(s - i0)) - (pointer.x - 0.5) * 0.1;
  const dist = 2.05 * Math.max(1, 0.9 / aspect);
  const targetY = headY - 0.17;
  camera.position.set(
    Math.sin(yaw) * dist,
    targetY + 0.03 + (pointer.y - 0.5) * 0.05 * dist,
    Math.cos(yaw) * dist,
  );
  camera.lookAt(0, targetY, 0);
  if (debug.on) {
    camera.position.fromArray(debug.pos);
    camera.lookAt(debug.target[0], debug.target[1], debug.target[2]);
  }
  camera.updateMatrixWorld(); // нужна актёру уже в этом кадре, чтобы навести взгляд
}

/**
 * Размер кадра: на широком экране персонаж уходит вправо, слева остаётся место
 * под слово; на узком — вверх, текст снизу.
 * @returns где по горизонтали стоит персонаж, 0…1
 */
export function frameCamera(camera: THREE.PerspectiveCamera, width: number, height: number): number {
  const aspect = width / height;
  camera.aspect = aspect;
  const shiftX = aspect > 1.15 ? 0.13 : 0;
  const shiftY = aspect > 1.15 ? 0 : 0.1;
  camera.setViewOffset(width, height, -shiftX * width, shiftY * height, width, height);
  return 0.5 + shiftX;
}
