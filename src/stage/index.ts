// Сцена: карманный театр. Персонаж стоит на неподвижном подиуме, за её спиной —
// поворотный круг с тремя декорациями (stage/turntable.ts), сверху световая ферма.
import * as THREE from 'three/webgpu';
import type { Frame } from '../core/contracts';
import { merge } from '../model/geo';
import { box, lathe, rod } from '../model/solids';
import { part } from './kit';
import { createLights } from './lights';
import { drawingDesk } from './sets/drawing-desk';
import { dressingRoom } from './sets/dressing-room';
import { glassAtelier } from './sets/glass-atelier';
import { createTurntable } from './turntable';

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  step(frame: Frame): void;
  reset(): void;
}

/** @param shadows настоящие тени от ключевого света */
export function createStage(shadows: boolean): Stage {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);

  const lights = createLights(scene, shadows);
  // Декорации в порядке глав.
  const turntable = createTurntable([dressingRoom, glassAtelier, drawingDesk]);
  scene.add(turntable.root);

  // Подиум под ногами и планшет сцены вокруг круга.
  scene.add(
    part(
      merge(
        lathe(
          [
            [0, -0.15],
            [0.36, -0.15],
            [0.36, -0.012],
            [0.348, 0],
            [0, 0],
          ],
          { segments: 40 },
        ).tint('#2a2730'),
      ),
      { set: true },
    ),
  );

  // Световая ферма с приборами: видна только на общем плане.
  const rig = [-1.3, -0.45, 0.45, 1.3].flatMap((x) => [
    rod([x, 3.22, -0.9], [x, 3.08, -0.9], 0.012, { sides: 6 }),
    lathe([
      [0, 0],
      [0.07, 0],
      [0.085, 0.16],
      [0.05, 0.2],
      [0, 0.2],
    ])
      .rotX(-0.5)
      .move(x, 2.9, -0.86),
  ]);
  scene.add(
    part(
      merge(
        box(3.4, 0.05, 0.05, { bevel: 0.006 }).move(0, 3.22, -0.9),
        box(3.4, 0.05, 0.05, { bevel: 0.006 }).move(0, 3.22, -1.15),
        ...[-1.6, -0.8, 0, 0.8, 1.6].map((x) => rod([x, 3.245, -0.9], [x, 3.245, -1.15], 0.012, { sides: 6 })),
        ...rig,
      ).tint('#201e26'),
      { set: true, noShadow: true },
    ),
  );

  return {
    scene,
    camera,
    reset() {
      turntable.reset();
    },
    step(frame) {
      turntable.step(frame.dt, frame.s, frame.still);
      lights.step(frame.s);
    },
  };
}
