import * as THREE from 'three/webgpu';

const mat = (hex: string, roughness = 0.75, flat = false) =>
  new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness: 0, flatShading: flat });

interface Orbiter {
  mesh: THREE.Object3D;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  bob: number;
  spin: THREE.Vector3;
}

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Ставит кольца за голову персонажа: у разных моделей она на разной высоте. */
  setHeadHeight(y: number): void;
  update(dt: number, t: number): void;
  /** Вернуть накопленные повороты предметов к началу. */
  reset(): void;
}

// Сцена намеренно простая и светлая: настоящую картинку делают шкуры,
// им нужны чистые тона, глубина и нормали.
export function createStage(): Stage {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);

  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8fa8', 1.15));
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(1.5, 2.6, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffd0dc', 1.2);
  rim.position.set(-2, 1.5, -2);
  scene.add(rim);

  // Два кольца за головой: дают шкурам крупную графику на пустом фоне.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.011, 12, 120), mat('#2b2b7a', 0.5));
  halo.position.set(0, 1.47, -0.3);
  scene.add(halo);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.006, 10, 140), mat('#e0526e', 0.5));
  halo2.position.set(0, 1.42, -0.42);
  scene.add(halo2);

  // Вокруг летают багеты, свёрла и крошки.
  const orbiters: Orbiter[] = [];
  const add = (mesh: THREE.Object3D, o: Omit<Orbiter, 'mesh'>) => {
    scene.add(mesh);
    orbiters.push({ mesh, ...o });
  };


  const baguetteGeo = new THREE.CapsuleGeometry(0.034, 0.34, 6, 16);
  const baguette = mat('#d7a15a', 0.85);
  const drillGeo = new THREE.ConeGeometry(0.065, 0.24, 7, 1);
  const drill = mat('#e0526e', 0.6, true);
  const crumbGeo = new THREE.IcosahedronGeometry(0.018, 0);
  const crumb = mat('#f3e2c0', 0.9, true);

  for (let i = 0; i < 3; i++) {
    add(new THREE.Mesh(baguetteGeo, baguette), {
      radius: 0.62 + i * 0.09,
      height: 1.12 + i * 0.26,
      speed: 0.22 + i * 0.05,
      phase: i * 2.1,
      bob: 0.04,
      spin: new THREE.Vector3(0.5 + i * 0.2, 0.3, 0.7 - i * 0.15),
    });
    add(new THREE.Mesh(drillGeo, drill), {
      radius: 0.7 + i * 0.07,
      height: 1.62 - i * 0.24,
      speed: -(0.18 + i * 0.06),
      phase: 1 + i * 2.3,
      bob: 0.05,
      spin: new THREE.Vector3(0.2, 1.4 - i * 0.3, 0.4 + i * 0.2),
    });
  }
  for (let i = 0; i < 14; i++) {
    const s = 0.6 + ((i * 37) % 10) / 10;
    const m = new THREE.Mesh(crumbGeo, crumb);
    m.scale.setScalar(s);
    add(m, {
      radius: 0.5 + ((i * 53) % 17) / 34,
      height: 0.95 + ((i * 29) % 19) / 20,
      speed: (i % 2 ? 1 : -1) * (0.12 + ((i * 11) % 7) / 40),
      phase: i * 0.9,
      bob: 0.03,
      spin: new THREE.Vector3(1, 0.6, 0.3),
    });
  }

  return {
    scene,
    camera,
    setHeadHeight(y) {
      halo.position.y = y;
      halo2.position.y = y - 0.05;
    },
    reset() {
      halo.rotation.set(0, 0, 0);
      for (const o of orbiters) o.mesh.rotation.set(0, 0, 0);
    },
    update(dt, t) {
      halo.rotation.z += dt * 0.08;
      halo2.rotation.set(Math.sin(t * 0.2) * 0.25, Math.cos(t * 0.17) * 0.3, t * -0.05);
      for (const o of orbiters) {
        const a = o.phase + t * o.speed;
        // Орбита сплюснута и сдвинута назад: предметы обходят персонажа
        // по бокам и за спиной, но не лезут в кадр перед лицом.
        o.mesh.position.set(
          Math.cos(a) * o.radius,
          o.height + Math.sin(t * 0.6 + o.phase) * o.bob,
          Math.sin(a) * o.radius * 0.45 - 0.55,
        );
        o.mesh.rotation.x += dt * o.spin.x;
        o.mesh.rotation.y += dt * o.spin.y;
        o.mesh.rotation.z += dt * o.spin.z;
      }
    },
  };
}
