// Генераторы деталей. Все возвращают Geo; ось вверх — Y, размеры в метрах.
//
//   lathe     тело вращения по профилю (точёные ножки, чаши, абажуры, шары);
//   sweep     сечение, протянутое вдоль пути, — может меняться, сужаться и скручиваться
//             (кабели, ручки, багет, кованый прут, пружины, ленты);
//   loftRect  «тело вращения» с прямоугольным основанием: коробки, панели с
//             филёнкой, подносы, рамы, доски с фасками — профиль задаёт отступ от
//             края и высоту;
//   box       коробка с фасками (частный случай loftRect);
//   plate     плоский контур с отверстиями, выдавленный в толщину, с фаской;
//   face      плоская грань по контуру с отверстиями;
//   ball, tube, torus — частные случаи первых двух.
//
// Про то, как задаются жёсткие и мягкие рёбра, — в outline.ts; про то, куда смотрит
// нормаль, — в surface.ts.
import * as THREE from 'three/webgpu';
import { Geo } from './geo';
import { area, circle, corners, inset, lengths, NEXT, PREV, resolve, SHARP, SMOOTH, type Mode, type Pt, type PtLike } from './outline';
import { frames, inFrame, pathLengths, type Frame } from './path';
import { surface } from './surface';
import { add, cross, dot, mul, sub, TAU, type V2, type V3 } from './vec';

// ── тело вращения ──────────────────────────────────────────────────────

export interface LatheOptions {
  /** Сколько граней по кругу. */
  segments?: number;
  /** Неполный оборот: от и до, радианы. */
  from?: number;
  to?: number;
  /** Множитель радиуса по углу: рифление, каннелюры, плетение. i — номер точки профиля. */
  wave?(theta: number, i: number, y: number): number;
  /** Профиль замкнут (бублик, кольцо). */
  closed?: boolean;
  /** Гранёное тело: каждая грань по кругу плоская (шестигранный карандаш, гайка). */
  facets?: boolean;
  /** Излом профиля круче этого угла (радианы) считается жёстким ребром. */
  sharpAngle?: number;
}

/**
 * Тело вращения вокруг оси Y. Профиль — точки [радиус, высота, режим?]; идёт снизу
 * вверх по внешней стороне. Начни и закончи его на оси (радиус 0) — получатся дно и крышка.
 */
export function lathe(profile: readonly PtLike[], opts: LatheOptions = {}): Geo {
  const { segments = 24, from = 0, to = TAU, wave, closed = false, facets = false, sharpAngle } = opts;
  const prof = resolve(profile, closed, sharpAngle);
  const full = Math.abs(to - from - TAU) < 1e-6;
  const cols = full ? segments : segments + 1;
  const along = lengths(prof, closed);
  return surface({
    rows: prof.length,
    cols,
    wrapCols: full,
    wrapRows: closed,
    at(i, j) {
      const theta = from + ((to - from) * j) / segments;
      const r = prof[i].x * (wave ? wave(theta, i, prof[i].y) : 1);
      return [Math.cos(theta) * r, prof[i].y, Math.sin(theta) * r];
    },
    rowMode: (i) => prof[i].m ?? SMOOTH,
    colMode: facets ? () => SHARP : undefined,
    uv: (i, j) => [j / segments, along[i]],
  });
}

/** Шар или эллипсоид; from/to — широты в долях (0 — низ, 1 — верх) для куполов и чаш. */
export function ball(radius: number, opts: { segments?: number; rings?: number; squash?: V3; from?: number; to?: number } = {}): Geo {
  const { segments = 20, rings = 12, squash, from = 0, to = 1 } = opts;
  const profile: Pt[] = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + Math.PI * (from + ((to - from) * i) / rings);
    profile.push({ x: Math.max(0, Math.cos(a)) * radius, y: Math.sin(a) * radius, m: SMOOTH });
  }
  const g = lathe(profile, { segments });
  return squash ? g.scale(squash[0], squash[1], squash[2]).retex() : g;
}

/** Бублик вокруг оси Y: R — радиус кольца, r — радиус трубки. */
export function torus(R: number, r: number, opts: { segments?: number; sides?: number } = {}): Geo {
  const { segments = 32, sides = 10 } = opts;
  return lathe(circle(r, sides, R, 0), { segments, closed: true });
}

// ── выдавливание вдоль пути ────────────────────────────────────────────

export type Cap = 'flat' | 'round' | 'none';

export interface SweepOptions {
  /** Путь замкнут (кольцо, обод). */
  closed?: boolean;
  /** Сечение не замкнуто: получится лента, а не труба. */
  ribbon?: boolean;
  /** Масштаб сечения вдоль пути, t = 0…1 по длине. Число или [по x, по y]. */
  scale?(t: number, k: number): number | V2;
  /** Поворот сечения вокруг пути, радианы. */
  twist?(t: number): number;
  /** Куда смотрит ось x сечения в начале пути. */
  up?: V3;
  /** Торцы: плоские, скруглённые или никаких. Можно задать пару [начало, конец]. */
  caps?: Cap | readonly [Cap, Cap];
  /** Сколько колец в скруглённом торце. */
  capSteps?: number;
  /** Режим ребра поперёк пути в его точке (по умолчанию гладко). */
  rowMode?(k: number): Mode;
  sharpAngle?: number;
}

/**
 * Протянуть сечение вдоль пути. Сечение — замкнутый контур против часовой стрелки
 * в своей плоскости; может быть функцией от места на пути (число точек при этом
 * должно оставаться тем же).
 */
export function sweep(
  path: readonly V3[],
  section: readonly PtLike[] | ((t: number, k: number) => readonly PtLike[]),
  opts: SweepOptions = {},
): Geo {
  const { closed = false, ribbon = false, scale, twist, up, capSteps = 4, sharpAngle } = opts;
  const caps: readonly [Cap, Cap] = closed || ribbon ? ['none', 'none'] : typeof opts.caps === 'string' ? [opts.caps, opts.caps] : (opts.caps ?? ['flat', 'flat']);
  const fr = frames(path, closed, up);
  const L = pathLengths(path);
  const total = L[L.length - 1] || 1;
  const sectionAt = (t: number, k: number) => resolve(typeof section === 'function' ? section(t, k) : section, !ribbon, sharpAngle);
  const scaleAt = (t: number, k: number): V2 => {
    const s = scale ? scale(t, k) : 1;
    return typeof s === 'number' ? [s, s] : s;
  };

  interface Station {
    f: Frame;
    sec: Pt[];
    s: V2;
    twist: number;
    v: number;
    mode: Mode;
  }
  const stations: Station[] = [];
  const base = (k: number): Station => {
    const t = L[k] / total;
    return { f: fr[k], sec: sectionAt(t, k), s: scaleAt(t, k), twist: twist ? twist(t) : 0, v: L[k], mode: opts.rowMode?.(k) ?? SMOOTH };
  };
  /** Кольца скруглённого торца: четверть окружности за концом пути. */
  const round = (k: number, dir: number): Station[] => {
    const b = base(k);
    const reach = (b.sec.reduce((sum, q) => sum + Math.hypot(q.x * b.s[0], q.y * b.s[1]), 0) / b.sec.length) * 1;
    const ring: Station[] = [];
    for (let m = 1; m <= capSteps; m++) {
      const phi = (m / capSteps) * (Math.PI / 2);
      const c = m === capSteps ? 0 : Math.cos(phi);
      ring.push({ ...b, f: { ...b.f, o: add(b.f.o, mul(b.f.t, dir * reach * Math.sin(phi))) }, s: [b.s[0] * c, b.s[1] * c], v: b.v + dir * reach * Math.sin(phi), mode: SMOOTH });
    }
    return ring;
  };
  if (caps[0] === 'round') stations.push(...round(0, -1).reverse());
  for (let k = 0; k < path.length; k++) stations.push(base(k));
  if (caps[1] === 'round') stations.push(...round(path.length - 1, 1));

  const cols = stations[0].sec.length;
  const place = (st: Station, q: Pt): V3 => {
    const x = q.x * st.s[0];
    const y = q.y * st.s[1];
    const c = Math.cos(st.twist);
    const s = Math.sin(st.twist);
    return inFrame(st.f, x * c - y * s, x * s + y * c);
  };
  const sec0 = stations[0].sec;
  const g = surface({
    rows: stations.length,
    cols,
    wrapRows: closed,
    wrapCols: !ribbon,
    // Сечение идёт против часовой, а ряд × столбец при этом смотрит внутрь — выворачиваем.
    flip: true,
    at: (i, j) => place(stations[i], stations[i].sec[j]),
    rowMode: (i) => stations[i].mode,
    colMode: (j) => sec0[j].m ?? SMOOTH,
    uv: (i, j) => [j / (ribbon ? cols - 1 : cols), closed && i === stations.length ? total + L[1] : stations[Math.min(i, stations.length - 1)].v],
  });

  const flat = (st: Station, dir: number) => {
    const outline = st.sec.map((q) => ({ x: q.x * st.s[0], y: q.y * st.s[1] }));
    const c = Math.cos(st.twist);
    const s = Math.sin(st.twist);
    face(outline, [], (x, y) => inFrame(st.f, x * c - y * s, x * s + y * c), mul(st.f.t, dir), g);
  };
  if (caps[0] === 'flat') flat(stations[0], -1);
  if (caps[1] === 'flat') flat(stations[stations.length - 1], 1);
  return g;
}

/** Труба круглого сечения вдоль пути. */
export function tube(path: readonly V3[], radius: number, opts: SweepOptions & { sides?: number } = {}): Geo {
  const { sides = 8, ...rest } = opts;
  return sweep(path, circle(radius, sides), { caps: 'round', capSteps: 3, ...rest });
}

// ── плоские грани и пластины ───────────────────────────────────────────

const v2 = (p: { x: number; y: number }) => new THREE.Vector2(p.x, p.y);

/**
 * Плоская грань по контуру с отверстиями.
 * @param place  куда в пространстве попадает точка контура
 * @param normal нормаль грани; обход треугольников подбирается под неё
 */
export function face(
  outline: readonly { x: number; y: number }[],
  holes: readonly (readonly { x: number; y: number }[])[],
  place: (x: number, y: number) => V3,
  normal: V3,
  out: Geo = new Geo(),
  uvScale = 1,
): Geo {
  const all = [...outline, ...holes.flat()];
  const tris = THREE.ShapeUtils.triangulateShape(outline.map(v2), holes.map((h) => h.map(v2)));
  const base = out.vertexCount;
  for (const q of all) out.vert(place(q.x, q.y), normal, [q.x * uvScale, q.y * uvScale]);
  for (const [a, b, c] of tris) {
    const pa = out.at(base + a);
    const n = cross(sub(out.at(base + b), pa), sub(out.at(base + c), pa));
    if (dot(n, normal) >= 0) out.tri(base + a, base + b, base + c);
    else out.tri(base + a, base + c, base + b);
  }
  return out;
}

export interface PlateOptions {
  /** Отверстия: замкнутые контуры в любом направлении обхода. */
  holes?: readonly (readonly PtLike[])[];
  /** Фаска по обеим кромкам. */
  bevel?: number;
  sharpAngle?: number;
}

/**
 * Пластина: контур в плоскости XY, выдавленный вдоль Z от 0 до thickness. Лицо
 * смотрит в +Z. Контур — против часовой стрелки.
 */
export function plate(outline: readonly PtLike[], thickness: number, opts: PlateOptions = {}): Geo {
  const { bevel = 0, sharpAngle } = opts;
  const ccw = (list: Pt[]): Pt[] => (area(list) < 0 ? [...list].reverse().map((q) => ({ ...q, m: q.m === PREV ? NEXT : q.m === NEXT ? PREV : q.m })) : list);
  const outer = ccw(resolve(outline, true, sharpAngle));
  const holes = (opts.holes ?? []).map((h) => ccw(resolve(h, true, sharpAngle)));
  const b = Math.min(bevel, thickness / 2);
  const g = new Geo();

  /** Стенка по контуру. hole — стенка отверстия: смотрит внутрь контура, фаска расширяет отверстие. */
  const wall = (ring: Pt[], hole: boolean) => {
    const shrunk = b > 0 ? inset(ring, hole ? -b : b) : ring;
    const levels: { ring: Pt[]; z: number; mode: Mode }[] =
      b > 0
        ? [
            { ring: shrunk, z: 0, mode: PREV },
            { ring, z: b, mode: NEXT },
            { ring, z: thickness - b, mode: PREV },
            { ring: shrunk, z: thickness, mode: NEXT },
          ]
        : [
            { ring, z: 0, mode: SHARP },
            { ring, z: thickness, mode: SHARP },
          ];
    const along = lengths(ring, true);
    surface(
      {
        rows: levels.length,
        cols: ring.length,
        wrapCols: true,
        flip: !hole,
        at: (i, j) => [levels[i].ring[j].x, levels[i].ring[j].y, levels[i].z],
        rowMode: (i) => levels[i].mode,
        colMode: (j) => ring[j].m ?? SMOOTH,
        // Крайние ряды фаски держат нормаль лицевой и тыльной грани — тогда грани ровные.
        normal: b > 0 ? (i) => (i === 0 ? [0, 0, -1] : i === levels.length - 1 ? [0, 0, 1] : undefined) : undefined,
        uv: (i, j) => [along[j], levels[i].z],
      },
      g,
    );
    return shrunk;
  };
  const outerFace = wall(outer, false);
  const holeFaces = holes.map((h) => wall(h, true));
  face(outerFace, holeFaces, (x, y) => [x, y, thickness], [0, 0, 1], g);
  face(outerFace, holeFaces, (x, y) => [x, y, 0], [0, 0, -1], g);
  return g;
}

// ── коробки и панели ───────────────────────────────────────────────────

export interface LoftOptions {
  /** Сколько отрезков в скруглении вертикального ребра. */
  cornerSteps?: number;
  sharpAngle?: number;
}

/**
 * Тело с прямоугольным основанием w × d по профилю. Точка профиля — [отступ от
 * края внутрь, высота, режим?]: отступ 0 — полный контур, отступ «до середины»
 * (Infinity) стягивает ряд в центр и закрывает форму. radius скругляет
 * вертикальные рёбра.
 *
 * Профиль [[∞,0],[0,0],[0,h],[∞,h]] — коробка. Продолжи его по верхней грани
 * внутрь и вниз — получится утопленная филёнка; вверх — бортик подноса.
 */
export function loftRect(w: number, d: number, radius: number, profile: readonly PtLike[], opts: LoftOptions = {}): Geo {
  const { sharpAngle } = opts;
  const half = Math.min(w, d) / 2;
  // Профиль в «радиусах» от оси: так излом считается в настоящих длинах.
  const prof = resolve(
    profile.map((q) => {
      const p = 'x' in q ? q : { x: q[0], y: q[1], m: q[2] };
      return { x: half - Math.min(p.x, half), y: p.y, m: p.m };
    }),
    false,
    sharpAngle,
  );
  const k = radius > 0 ? (opts.cornerSteps ?? 3) : 0;
  const per = k + 1; // точек на угол
  const cols = per * 4;
  const along = lengths(prof);
  const SIGN: readonly V2[] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  return surface({
    rows: prof.length,
    cols,
    wrapCols: true,
    at(i, j) {
      const e = half - prof[i].x; // отступ от края
      const y = prof[i].y;
      if (e >= half - 1e-9) return [0, y, 0];
      const hw = w / 2 - e;
      const hd = d / 2 - e;
      const corner = Math.floor(j / per);
      const s = j % per;
      // Радиус не даём обнулить: совпавшие точки угла потеряли бы направление.
      const r = Math.min(Math.max(radius - e, radius > 0 ? 2e-5 : 0), hw, hd);
      const a = (corner + (k ? s / k : 0)) * (Math.PI / 2);
      const [sx, sz] = SIGN[corner];
      return [sx * (hw - r) + Math.cos(a) * r, y, sz * (hd - r) + Math.sin(a) * r];
    },
    rowMode: (i) => prof[i].m ?? SMOOTH,
    colMode: (j) => (k === 0 ? SHARP : j % per === 0 ? PREV : j % per === k ? NEXT : SMOOTH),
    uv: (i, j) => [j / cols, along[i]],
  });
}

export interface BoxOptions {
  /** Фаска на горизонтальных рёбрах. */
  bevel?: number;
  /** Радиус вертикальных рёбер (по умолчанию как фаска). */
  radius?: number;
  /** Отрезков в фаске: 1 — полоска с плавными нормалями, больше — настоящая дуга. */
  steps?: number;
  cornerSteps?: number;
  /** Начало координат в центре коробки, а не в центре основания. */
  centered?: boolean;
}

/** Коробка w × h × d с фасками, стоит на плоскости y = 0. */
export function box(w: number, h: number, d: number, opts: BoxOptions = {}): Geo {
  const { bevel = 0, radius = bevel, steps = 1, cornerSteps = Math.max(1, steps), centered = false } = opts;
  const profile = corners(
    [
      [Infinity, 0],
      [0, 0, bevel],
      [0, h, bevel],
      [Infinity, h],
    ].map(([x, y, r]) => [Math.min(x, Math.min(w, d) / 2), y, r] as const),
    { steps },
  );
  const g = loftRect(w, d, radius, profile, { cornerSteps });
  return centered ? g.move(0, -h / 2, 0).retex() : g;
}

/** Круглый стержень от точки a до точки b с лёгкой фаской на торцах. */
export function rod(a: V3, b: V3, radius: number, opts: { sides?: number; bevel?: number } = {}): Geo {
  const { sides = 10, bevel = radius * 0.15 } = opts;
  const d = sub(b, a);
  const h = Math.hypot(d[0], d[1], d[2]);
  const g = lathe(
    corners([
      [0, 0],
      [radius, 0, bevel],
      [radius, h, bevel],
      [0, h],
    ]),
    { segments: sides },
  );
  return g.aim(d).move(a[0], a[1], a[2]);
}
