// Общее для всех шкур: униформы кадра и набор готовых величин в точке экрана.
// Шкура — функция от SkinContext, которая возвращает цвет пикселя (линейный RGB).
import * as THREE from 'three/webgpu';
import {
  abs,
  dot,
  float,
  fract,
  length,
  max,
  perspectiveDepthToViewZ,
  pow,
  saturate,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';

// Граф шейдера собирается динамически, типы узлов TSL здесь только мешают.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

/**
 * Униформы, общие для всех шкур. Своё, нужное одной шкуре, она объявляет у себя
 * в файле (см. sketchU в sketch.ts) — так шкуры не делят один список.
 */
export function createUniforms(camera: THREE.PerspectiveCamera) {
  return {
    pointer: uniform(new THREE.Vector2(0.5, 0.5)), // центр линзы, uv от левого верхнего угла
    aspect: uniform(1),
    dpr: uniform(1),
    lens: uniform(0.2), // радиус линзы в долях высоты экрана
    skinA: uniform(0), // шкура снаружи линзы
    skinB: uniform(1), // шкура внутри линзы
    near: uniform(camera.near),
    far: uniform(camera.far),
    clock: uniform(0), // своё время: замирает при prefers-reduced-motion
    raw: uniform(0), // отладка: 1 — сцена без шкур, 2 — слой меток
    trailGain: uniform(0), // насколько виден чернильный след за линзой
    head: uniform(new THREE.Vector2(0.6, 0.35)), // центр лица на экране, uv
    headSize: uniform(0.12), // радиус головы в долях высоты экрана
    cheekL: uniform(new THREE.Vector2(0.62, 0.38)), // щёки на экране — для штрихов румянца
    cheekR: uniform(new THREE.Vector2(0.58, 0.38)),
  };
}

export type SkinUniforms = ReturnType<typeof createUniforms>;

/** Цвет из #rrggbb как он выглядит на экране (sRGB), без перевода в линейное пространство. */
export const paint = (hex: string): N => {
  const c = parseInt(hex.slice(1), 16);
  return vec3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
};

// Шкуры считаются в «экранных» значениях (как видит глаз), в конце переводятся в линейные.
export const srgb = (c: N): N => pow(saturate(c), vec3(1 / 2.2));
export const toLinear = (c: N): N => pow(saturate(c), vec3(2.2));
export const hash21 = (p: N): N => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
export const hash22 = (p: N): N =>
  fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453));
export const rot = (p: N, a: number): N => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
};
/** 1, если sel равен i, иначе 0 — выбор варианта по номеру без ветвления. */
export const pick = (sel: N, i: number): N => saturate(float(1).sub(abs(sel.sub(i))));

export interface SkinContext {
  u: SkinUniforms;
  /** Слои G-буфера (core/gbuffer.ts). */
  colorTex: N;
  normalTex: N;
  depthTex: N;
  /** Метки: r — номер предмета, g — ярус тела, b — рука. */
  idTex: N;

  uv: N; // точка экрана, 0…1 от левого верхнего угла
  res: N; // размер буфера в пикселях
  css: N; // та же точка в CSS-пикселях
  pxUV: N; // один CSS-пиксель в uv
  pxH: N; // один CSS-пиксель в долях высоты экрана
  asp: N; // (aspect, 1): умножь на него разность uv, чтобы получить доли высоты
  toUV(p: N): N; // CSS-пиксели → uv

  /** Расстояние от камеры до того, что видно в точке, метры. */
  viewDist(uv: N): N;
  /** 1, если в точке есть предмет, 0 — пустой фон. */
  isFg(dist: N): N;
  /** Четыре смещения крестом и по диагоналям на r (в uv). */
  cross(r: N): N[];
  diag(r: N): N[];
  /** Контур в точке: разрывы глубины и изломы нормалей в радиусе radius CSS-пикселей. */
  edgeAt(c: N, radius: number): N;

  lin: N; // цвет сцены в этой точке, линейный
  dist: N; // расстояние до камеры
  fg: N; // 1 на предмете, 0 на фоне
  edge: N; // контур в этой точке
  fromHead: N; // вектор от центра лица, доли высоты экрана
  heads: N; // расстояние от лица в «головах»
}

/** Собирает контекст. Вызывать внутри Fn композита: величины становятся переменными шейдера. */
export function createContext(scenePass: N, u: SkinUniforms): SkinContext {
  const colorTex: N = scenePass.getTextureNode('output');
  const normalTex: N = scenePass.getTextureNode('normal');
  const depthTex: N = scenePass.getTextureNode('depth');
  const idTex: N = scenePass.getTextureNode('id');

  const viewDist = (uv: N): N =>
    (perspectiveDepthToViewZ(depthTex.sample(uv).r, u.near, u.far) as N).negate();
  const isFg = (d: N): N => float(1).sub(step(u.far.mul(0.9), d));

  const uv: N = screenUV;
  const res: N = screenSize;
  const css: N = uv.mul(res).div(u.dpr).toVar(); // CSS-пиксели, начало слева сверху
  const toUV = (p: N): N => p.mul(u.dpr).div(res);
  const pxUV: N = vec2(u.dpr).div(res).toVar(); // один CSS-пиксель в uv
  const pxH: N = u.dpr.div(res.y); // он же в долях высоты экрана
  const asp = vec2(u.aspect, 1);

  const cross = (r: N): N[] => [vec2(r.x, 0), vec2(r.x.negate(), 0), vec2(0, r.y), vec2(0, r.y.negate())];
  const diag = (r: N): N[] => [
    vec2(r.x, r.y),
    vec2(r.x.negate(), r.y),
    vec2(r.x, r.y.negate()),
    vec2(r.x.negate(), r.y.negate()),
  ];

  const edgeAt = (c: N, radius: number): N => {
    const d0: N = viewDist(c).toVar();
    const n0: N = normalTex.sample(c).xyz.toVar();
    let dz: N = float(0);
    let dn: N = float(0);
    for (const t of cross(pxUV.mul(radius))) {
      dz = dz.add(abs(viewDist(c.add(t)).sub(d0)));
      dn = dn.add(length(normalTex.sample(c.add(t)).xyz.sub(n0)));
    }
    return max(smoothstep(0.004, 0.012, dz.div(d0)), smoothstep(0.3, 0.7, dn));
  };

  const lin: N = colorTex.sample(uv).rgb.toVar();
  const dist: N = viewDist(uv).toVar();
  const fg: N = isFg(dist).toVar();
  const edge: N = edgeAt(uv, 1.25).toVar();
  // Положение пикселя относительно лица: в долях высоты экрана и в «головах».
  const fromHead: N = uv.sub(u.head).mul(asp).toVar();
  const heads: N = length(fromHead).div(u.headSize).toVar();

  return {
    u,
    colorTex,
    normalTex,
    depthTex,
    idTex,
    uv,
    res,
    css,
    pxUV,
    pxH,
    asp,
    toUV,
    viewDist,
    isFg,
    cross,
    diag,
    edgeAt,
    lin,
    dist,
    fg,
    edge,
    fromHead,
    heads,
  };
}
