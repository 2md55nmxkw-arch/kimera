// Ветер по волосам и одежде.
//
// У пружинных костей three-vrm нет «ветра», но есть гравитация: сила, которая на
// каждом шаге тянет кончик кости в заданную сторону. У этой модели штатная гравитация
// нулевая, так что ветер — та же гравитация, только вбок: к штатному вектору каждой
// кости прибавляется вектор ветра, и сумма раскладывается обратно на gravityDir и
// gravityPower. Нет ветра — настройки возвращаются к штатным, и кости считаются
// в точности как раньше.
//
// Источников три:
//   · курсор — быстрый проход линзы рядом с персонажем тянет волосы и юбку за собой;
//   · внешний ветер (set) — для вентилятора из реквизита;
//   · рывок локона от клика (kick) — прежний механизм, теперь живёт здесь же.
import * as THREE from 'three/webgpu';
import type { VRM } from '@pixiv/three-vrm';

type Kind = 'hair' | 'skirt' | 'sleeve';

interface Strand {
  settings: { gravityPower: number; gravityDir: THREE.Vector3 };
  /** Штатная гравитация кости — к ней всё возвращается. */
  power: number;
  dir: THREE.Vector3;
  kind: Kind;
  /** Своя частота и фаза трепета, чтобы пряди не качались строем. */
  rate: number;
  phase: number;
  /** Боковой локон, за который можно дёрнуть: 0 — левый, 1 — правый, −1 — не локон. */
  ringlet: -1 | 0 | 1;
}

// Сколько ветра достаётся каждой ткани. Для сравнения: жёсткость волос у модели
// 0.4–0.55, и сила той же величины поперёк пряди отклоняет её на 45°.
const GAIN: Record<Kind, number> = { hair: 0.62, skirt: 0.5, sleeve: 0.22 };
const KICK_POWER = 2.4;
/** Медленнее этого (высот экрана в секунду) линза ветра не поднимает: так она бродит сама. */
const CALM_SPEED = 0.45;

export interface WindInput {
  /** Указатель на экране, −1…1. */
  ndcX: number;
  ndcY: number;
  /** Где голова и бёдра — около них курсор «дует» сильнее всего. */
  head: THREE.Vector3;
  hips: THREE.Vector3;
  /** «Уменьшение движения»: курсор ветра не поднимает. */
  still: boolean;
}

export interface Wind {
  /** Внешний ветер: направление в мире и сила (1 — крепкий вентилятор). Держится, пока не сменят. */
  set(direction: THREE.Vector3, strength: number): void;
  /** Дёрнуть боковой локон наружу и вверх (0 — левый, 1 — правый) или отпустить. */
  kick(i: 0 | 1, on: boolean): void;
  /** Вызывать перед шагом пружинных костей. */
  update(dt: number, t: number, input: WindInput, camera: THREE.PerspectiveCamera): void;
  /** Штиль и штатные настройки костей. */
  reset(): void;
  /** Порыв от курсора сейчас, 0…1 — на него щурится лицо. */
  readonly gust: number;
}

export function createWind(vrm: VRM): Wind | null {
  const manager = vrm.springBoneManager;
  const humanoid = vrm.humanoid;
  if (!manager || !humanoid) return null;

  const rawHead = humanoid.getRawBoneNode('head');
  const arms = (['leftUpperArm', 'rightUpperArm'] as const).map((n) => humanoid.getRawBoneNode(n));
  const under = (node: THREE.Object3D, root: THREE.Object3D | null) => {
    for (let n: THREE.Object3D | null = node; n; n = n.parent) if (n === root) return true;
    return false;
  };

  vrm.scene.updateMatrixWorld(true);
  const headAt = rawHead ? rawHead.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.3, 0);
  const at = new THREE.Vector3();
  const strands: Strand[] = [];
  let n = 0;
  for (const joint of manager.joints) {
    const name = joint.bone.name;
    n++;
    // Грудь тоже на пружинах, но ветру там делать нечего.
    if (/bust|breast/i.test(name)) continue;
    const kind: Kind = under(joint.bone, rawHead) || /hair/i.test(name)
      ? 'hair'
      : arms.some((a) => under(joint.bone, a)) || /sleeve/i.test(name)
        ? 'sleeve'
        : 'skirt';
    joint.bone.getWorldPosition(at);
    const dx = at.x - headAt.x;
    const dy = at.y - headAt.y;
    const side = kind === 'hair' && Math.abs(dx) > 0.09 && dy > -0.3 && dy < 0.25;
    strands.push({
      settings: joint.settings,
      power: joint.settings.gravityPower,
      dir: joint.settings.gravityDir.clone(),
      kind,
      // Золотое сечение разводит фазы соседних костей равномерно и без случайных чисел.
      rate: 7 + ((n * 0.618) % 1) * 6,
      phase: n * 2.399,
      ringlet: side ? (dx > 0 ? 0 : 1) : -1,
    });
  }
  if (!strands.length) return null;

  const kicked = [false, false];
  const external = new THREE.Vector3(); // внешний ветер, мир
  // Порыв от курсора — отдельно у головы и у бёдер: проход на уровне лица юбку почти не трогает.
  const gustHair = new THREE.Vector3();
  const gustSkirt = new THREE.Vector3();
  const prev = { x: 0, y: 0, ready: false };
  let touched = false; // настройки костей сейчас отличаются от штатных

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const blow = new THREE.Vector3();
  const want = new THREE.Vector3();
  const force = new THREE.Vector3();
  const screen = new THREE.Vector3();
  const KICK_DIR = [new THREE.Vector3(0.9, 0.5, 0.25).normalize(), new THREE.Vector3(-0.9, 0.5, 0.25).normalize()];

  /** Насколько курсор близко к точке на экране: 1 — рядом, 0 — дальше высоты экрана. */
  const near = (point: THREE.Vector3, input: WindInput, camera: THREE.PerspectiveCamera) => {
    screen.copy(point).project(camera);
    const d = Math.hypot(((input.ndcX - screen.x) / 2) * camera.aspect, (input.ndcY - screen.y) / 2);
    return 1 - THREE.MathUtils.smoothstep(d, 0.28, 0.95);
  };
  const follow = (gust: THREE.Vector3, target: THREE.Vector3, dt: number) => {
    // Порыв налетает быстро, а стихает медленнее — волосы успевают «договорить».
    const rate = target.lengthSq() > gust.lengthSq() ? 16 : 3.4;
    gust.lerp(target, 1 - Math.exp(-dt * rate));
  };

  const restore = () => {
    for (const s of strands) {
      s.settings.gravityDir.copy(s.dir);
      s.settings.gravityPower = s.power;
    }
    touched = false;
  };

  return {
    get gust() {
      return Math.min(1, gustHair.length());
    },
    set(direction, strength) {
      if (strength > 1e-4 && direction.lengthSq() > 1e-8) external.copy(direction).normalize().multiplyScalar(strength);
      else external.set(0, 0, 0);
    },
    kick(i, on) {
      kicked[i] = on;
    },
    reset() {
      kicked[0] = kicked[1] = false;
      external.set(0, 0, 0);
      gustHair.set(0, 0, 0);
      gustSkirt.set(0, 0, 0);
      prev.ready = false;
      restore();
    },
    update(dt, t, input, camera) {
      // Скорость указателя в высотах экрана в секунду. Первый кадр и нулевой шаг — без скорости.
      let vx = 0;
      let vy = 0;
      if (prev.ready && dt > 1e-4 && !input.still) {
        vx = (((input.ndcX - prev.x) / 2) * camera.aspect) / dt;
        vy = (input.ndcY - prev.y) / 2 / dt;
      }
      prev.x = input.ndcX;
      prev.y = input.ndcY;
      prev.ready = true;

      const speed = Math.hypot(vx, vy);
      // Сила растёт со скоростью и насыщается: резкий рывок мыши не срывает причёску.
      const drive = speed > CALM_SPEED ? 1 - Math.exp(-(speed - CALM_SPEED) / 1.5) : 0;
      if (drive > 0) {
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        up.setFromMatrixColumn(camera.matrixWorld, 1);
        blow.set(0, 0, 0).addScaledVector(right, vx / speed).addScaledVector(up, vy / speed);
      } else {
        blow.set(0, 0, 0);
      }
      follow(gustHair, want.copy(blow).multiplyScalar(drive * near(input.head, input, camera)), dt);
      follow(gustSkirt, want.copy(blow).multiplyScalar(drive * near(input.hips, input, camera)), dt);

      const windy = gustHair.lengthSq() + gustSkirt.lengthSq() + external.lengthSq() > 1e-6;
      if (!windy && !kicked[0] && !kicked[1]) {
        if (touched) restore();
        return;
      }
      touched = true;

      for (const s of strands) {
        if (s.ringlet >= 0 && kicked[s.ringlet]) {
          s.settings.gravityDir.copy(KICK_DIR[s.ringlet]);
          s.settings.gravityPower = KICK_POWER;
          continue;
        }
        const gust = s.kind === 'hair' ? gustHair : gustSkirt;
        // Трепет: каждая прядь ловит ветер в своём ритме. Ровный поток треплет сильнее порыва.
        const beat = Math.sin(t * s.rate + s.phase);
        const slow = Math.sin(t * s.rate * 0.31 + s.phase * 1.7);
        force
          .copy(s.dir)
          .multiplyScalar(s.power)
          .addScaledVector(gust, GAIN[s.kind] * (1 + beat * 0.22))
          .addScaledVector(external, GAIN[s.kind] * (0.8 + beat * 0.3 + slow * 0.25));
        // Ветер слегка приподнимает волосы: иначе пряди просто съезжают вбок, как на нитке.
        if (s.kind === 'hair') force.y += (gust.length() + external.length()) * GAIN.hair * 0.18;
        const power = force.length();
        if (power > 1e-6) {
          s.settings.gravityDir.copy(force).divideScalar(power);
          s.settings.gravityPower = power;
        } else {
          s.settings.gravityDir.copy(s.dir);
          s.settings.gravityPower = s.power;
        }
      }
    },
  };
}
