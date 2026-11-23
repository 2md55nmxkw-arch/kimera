// Поворотный круг: три клина с декорациями, прокрутка поворачивает его на 120° за главу.
import * as THREE from 'three/webgpu';
import { ID, tag } from '../core/gbuffer';
import { merge } from '../model/geo';
import { lathe } from '../model/solids';
import { CENTRE_Z, RADIUS, part, wall, type StageSet } from './kit';

const STEP = (Math.PI * 2) / 3;

export interface Turntable {
  root: THREE.Group;
  /** @param s положение прокрутки в главах */
  step(dt: number, s: number, still: boolean): void;
  reset(): void;
}

export function createTurntable(sets: StageSet[]): Turntable {
  const root = new THREE.Group();
  // Круг чуть ниже подиума, на котором стоит персонаж: подиум неподвижен.
  root.position.set(0, -0.03, CENTRE_Z);
  const disc = new THREE.Group();
  root.add(disc);

  // Сам диск с ободом.
  disc.add(
    part(
      merge(
        lathe(
          [
            [0, -0.12],
            [RADIUS + 0.03, -0.12],
            [RADIUS + 0.03, -0.012],
            [RADIUS + 0.018, 0],
            [0, 0],
          ],
          { segments: 72 },
        ).tint('#1d1b22'),
      ),
      { set: true },
    ),
  );

  sets.forEach((set, i) => {
    const sector = new THREE.Group();
    sector.name = set.name;
    sector.rotation.y = i * STEP;

    // Пол клина: веер в 120°, раскрытый к залу.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS, 24, (-150 * Math.PI) / 180, STEP),
      new THREE.MeshToonNodeMaterial({ color: set.floor }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    tag(floor, ID.set);
    sector.add(floor);

    const left = wall('left');
    const right = wall('right');
    sector.add(left, right);
    set.build(left, right);
    disc.add(sector);
  });

  // Угол догоняет цель пружиной с небольшим проскоком: тяжёлый круг не встаёт мгновенно.
  let angle = 0;
  let speed = 0;
  let primed = false;

  return {
    root,
    reset() {
      speed = 0;
      primed = false;
    },
    step(dt, s, still) {
      const target = -s * STEP;
      if (!primed || still) {
        angle = target;
        speed = 0;
        primed = true;
      } else {
        const h = Math.min(dt, 0.05) / 2;
        for (let k = 0; k < 2; k++) {
          speed += ((target - angle) * 70 - speed * 13) * h;
          angle += speed * h;
        }
      }
      disc.rotation.y = angle;
    },
  };
}
