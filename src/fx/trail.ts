// Чернильный след за линзой.
// Маленькая текстура «помнит», где недавно была линза: каждый кадр прошлое
// состояние слегка размывается, сносится шумовым течением и выцветает,
// а под курсором ставится свежий мазок. Композит потом открывает вторую
// шкуру не только в круге линзы, но и вдоль этого следа.
import * as THREE from 'three/webgpu';
import { Fn, clamp, dot, float, length, max, mx_noise_float, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const W = 320;
const H = 180;

export function createTrail(renderer: THREE.WebGPURenderer) {
  const options = {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  };
  let read = new THREE.RenderTarget(W, H, options);
  let write = new THREE.RenderTarget(W, H, options);

  const prev: N = texture(read.texture); // прошлый кадр следа
  const node: N = texture(write.texture); // готовый след — его читает композит

  const u = {
    from: uniform(new THREE.Vector2(0.5, 0.5)), // где линза была кадр назад
    to: uniform(new THREE.Vector2(0.5, 0.5)), // где она сейчас
    aspect: uniform(1),
    radius: uniform(0.15), // в долях высоты экрана
    strength: uniform(0),
    decay: uniform(0.98),
    clock: uniform(0),
    splash: uniform(new THREE.Vector3(0.5, 0.5, 0)), // x, y и сила всплеска от клика
    splashRadius: uniform(0.1),
  };

  const material = new THREE.NodeMaterial();
  material.fragmentNode = Fn(() => {
    const p: N = uv();
    const texel = vec2(1 / W, 1 / H);

    // Течение: медленный шумовой снос плюс лёгкий подъём вверх, как у чернил в воде.
    const flow: N = vec2(
      mx_noise_float(vec3(p.mul(4.0), u.clock.mul(0.15))),
      mx_noise_float(vec3(p.mul(4.0).add(31.7), u.clock.mul(0.15))).add(0.35),
    ).mul(0.0016);
    const q: N = p.add(flow);

    // Размытие: центр и четыре соседа.
    const o: N = texel.mul(1.5);
    const old: N = prev
      .sample(q)
      .r.mul(0.4)
      .add(prev.sample(q.add(vec2(o.x, 0))).r.mul(0.15))
      .add(prev.sample(q.sub(vec2(o.x, 0))).r.mul(0.15))
      .add(prev.sample(q.add(vec2(0, o.y))).r.mul(0.15))
      .add(prev.sample(q.sub(vec2(0, o.y))).r.mul(0.15));

    // Свежий мазок — не точка, а отрезок от прошлого положения к текущему,
    // иначе при быстром движении след рвался бы на отдельные пятна.
    const asp = vec2(u.aspect, 1);
    const pa: N = p.sub(u.from).mul(asp);
    const ba: N = u.to.sub(u.from).mul(asp);
    const h: N = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1);
    const d: N = length(pa.sub(ba.mul(h)));
    const stamp: N = float(1).sub(smoothstep(u.radius.mul(0.5), u.radius, d)).mul(u.strength);

    // Всплеск от клика: кольцо, которое разбегается от точки и гаснет.
    const sd: N = length(p.sub(u.splash.xy).mul(asp));
    const ring: N = smoothstep(u.splashRadius.mul(0.55), u.splashRadius.mul(0.8), sd)
      .mul(float(1).sub(smoothstep(u.splashRadius.mul(0.85), u.splashRadius, sd)))
      .mul(u.splash.z);

    return vec4(max(max(old.mul(u.decay), stamp), ring), 0, 0, 1);
  })();

  const quad = new THREE.QuadMesh(material);
  let state: unknown;
  let primed = false;
  let splashAge = 1;
  let wipe = false;

  return {
    /** Стереть след: следующий кадр начнётся с чистой текстуры. */
    reset() {
      primed = false;
      splashAge = 1;
      wipe = true;
    },
    /** Узел текстуры со следом: красный канал, 0…1. */
    node,
    /** Чернильный всплеск в точке экрана (uv от левого верхнего угла). */
    splash(x: number, y: number) {
      u.splash.value.set(x, y, 1);
      splashAge = 0;
    },
    /**
     * @param x,y  центр линзы, uv от левого верхнего угла
     * @param speed скорость линзы, экранов в секунду
     */
    update(dt: number, t: number, x: number, y: number, aspect: number, radius: number, speed: number, press: number) {
      if (!primed) {
        u.to.value.set(x, y);
        primed = true;
      }
      u.from.value.copy(u.to.value);
      u.to.value.set(x, y);
      u.aspect.value = aspect;
      u.radius.value = radius;
      // Неподвижная линза следа не оставляет; зажатая кнопка добавляет чернил.
      u.strength.value = wipe ? 0 : Math.min(1, speed * 3.5 + press * 0.6);
      u.decay.value = wipe ? 0 : Math.exp(-dt / 1.1);
      wipe = false;
      u.clock.value = t;
      // Кольцо всплеска растёт треть секунды и за это время гаснет.
      splashAge = Math.min(1, splashAge + dt / 0.34);
      u.splash.value.z = (1 - splashAge) ** 1.5;
      u.splashRadius.value = radius * (0.5 + splashAge * 1.9);

      state = THREE.RendererUtils.resetRendererState(renderer, state as never);
      prev.value = read.texture;
      renderer.setRenderTarget(write);
      quad.render(renderer);
      THREE.RendererUtils.restoreRendererState(renderer, state as never);

      node.value = write.texture;
      [read, write] = [write, read];
    },
  };
}

export type Trail = ReturnType<typeof createTrail>;
