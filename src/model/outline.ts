// Плоские контуры: профили для тел вращения, сечения для выдавливания вдоль кривой,
// очертания пластин. Контур — ломаная, у каждой точки записано, что в ней с ребром:
//
//   SMOOTH — гладко: нормаль усредняется с обеих сторон;
//   SHARP  — жёсткое ребро: вершина раздваивается, у каждой стороны своя нормаль;
//   PREV   — точка принадлежит плоскости ДО неё: нормаль берётся только с той стороны;
//   NEXT   — то же для плоскости ПОСЛЕ неё.
//
// PREV и NEXT — это «взвешенные нормали» из игрового моделирования. Фаска между
// двумя гранями записывается парой точек PREV → NEXT: грани по обе стороны остаются
// ровными, а полоска фаски плавно переводит одну нормаль в другую. Ребро выглядит
// скруглённым при одной полоске треугольников, и на гранях нет ложных градиентов —
// а от ложных градиентов шкура-набросок рисует грязные линии.
import { clamp, TAU } from './vec';

export const SMOOTH = 0;
export const SHARP = 1;
export const PREV = 2;
export const NEXT = 3;
export type Mode = 0 | 1 | 2 | 3;

export interface Pt {
  x: number;
  y: number;
  /** Что с ребром в этой точке; не задано — решается по углу излома. */
  m?: Mode;
}
/** Точку можно записать коротко: [x, y] или [x, y, режим]. */
export type PtLike = Pt | readonly [number, number] | readonly [number, number, Mode];

export const pt = (p: PtLike): Pt => ('x' in p ? p : { x: p[0], y: p[1], m: p[2] });
export const pts = (list: readonly PtLike[]): Pt[] => list.map(pt);

const near = (a: Pt, b: Pt): boolean => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** Убрать точки-повторы, идущие подряд. Конец скругления, совпавший с началом следующего, становится гладким. */
function dedupe(list: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && near(last, p)) {
      if (last.m === NEXT && p.m === PREV) last.m = SMOOTH;
      else if (last.m === undefined) last.m = p.m;
      continue;
    }
    out.push({ ...p });
  }
  if (closed && out.length > 1 && near(out[0], out[out.length - 1])) {
    const tail = out.pop()!;
    if (tail.m === NEXT && out[0].m === PREV) out[0].m = SMOOTH;
  }
  return out;
}

/**
 * Ломаная со скруглёнными углами. Точка: [x, y, радиус?, шагов?].
 * Радиус 0 — жёсткий угол. Один шаг — фаска (с взвешенными нормалями она выглядит
 * скруглённой), больше — настоящая дуга, заметная в силуэте.
 */
export function corners(
  points: readonly (readonly [number, number, number?, number?])[],
  opts: { closed?: boolean; steps?: number } = {},
): Pt[] {
  const { closed = false, steps = 1 } = opts;
  const n = points.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const [bx, by, radius = 0, own] = points[i];
    const inner = closed || (i > 0 && i < n - 1);
    if (!inner || radius <= 0) {
      out.push({ x: bx, y: by, m: inner ? undefined : SHARP });
      continue;
    }
    const a = points[(i - 1 + n) % n];
    const c = points[(i + 1) % n];
    let ux = a[0] - bx;
    let uy = a[1] - by;
    let wx = c[0] - bx;
    let wy = c[1] - by;
    const ul = Math.hypot(ux, uy);
    const wl = Math.hypot(wx, wy);
    if (ul < 1e-9 || wl < 1e-9) {
      out.push({ x: bx, y: by });
      continue;
    }
    ux /= ul;
    uy /= ul;
    wx /= wl;
    wy /= wl;
    const phi = Math.acos(clamp(ux * wx + uy * wy, -1, 1)); // угол между сторонами
    if (phi > Math.PI - 1e-3) {
      out.push({ x: bx, y: by, m: SMOOTH }); // почти прямая: скруглять нечего
      continue;
    }
    // Скругление не может съесть больше половины стороны: вторая половина — соседнему углу.
    const t = Math.min(radius / Math.tan(phi / 2), ul * 0.5, wl * 0.5);
    const r = t * Math.tan(phi / 2);
    const sx = bx + ux * t;
    const sy = by + uy * t;
    const ex = bx + wx * t;
    const ey = by + wy * t;
    const k = own ?? steps;
    if (k <= 1) {
      out.push({ x: sx, y: sy, m: PREV }, { x: ex, y: ey, m: NEXT });
      continue;
    }
    const bl = Math.hypot(ux + wx, uy + wy);
    const cx = bx + ((ux + wx) / bl) * (r / Math.sin(phi / 2));
    const cy = by + ((uy + wy) / bl) * (r / Math.sin(phi / 2));
    const a0 = Math.atan2(sy - cy, sx - cx);
    let sweep = Math.atan2(ey - cy, ex - cx) - a0;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    for (let s = 0; s <= k; s++) {
      const ang = a0 + (sweep * s) / k;
      out.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, m: s === 0 ? PREV : s === k ? NEXT : SMOOTH });
    }
  }
  return dedupe(out, closed);
}

/** Гладкая кривая через точки (сплайн Катмулла — Рома), `steps` отрезков на пролёт. */
export function curve(points: readonly (readonly [number, number])[], steps = 6, closed = false): Pt[] {
  const n = points.length;
  const out: Pt[] = [];
  const get = (i: number) => (closed ? points[((i % n) + n) % n] : points[clamp(i, 0, n - 1)]);
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (k: 0 | 1) =>
        0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
      out.push({ x: f(0), y: f(1), m: !closed && i === 0 && s === 0 ? SHARP : SMOOTH });
    }
  }
  if (!closed) out.push({ x: points[n - 1][0], y: points[n - 1][1], m: SHARP });
  return dedupe(out, closed);
}

/** Дуга окружности от угла a0 до a1 (радианы, от оси X против часовой). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 6): Pt[] {
  const out: Pt[] = [];
  for (let s = 0; s <= steps; s++) {
    const a = a0 + ((a1 - a0) * s) / steps;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, m: s === 0 ? PREV : s === steps ? NEXT : SMOOTH });
  }
  return out;
}

/** Склеить куски в один контур. В местах стыка режим решается по углу, если не задан явно. */
export function join(...parts: (readonly PtLike[])[]): Pt[] {
  const all: Pt[] = [];
  for (const part of parts) {
    const list = pts(part);
    list.forEach((p, i) => {
      const last = all[all.length - 1];
      if (i === 0 && last && near(last, p)) {
        // Стык: гладкий конец одной дуги и гладкое начало другой — проверим углом.
        if (last.m === NEXT && p.m === PREV) last.m = undefined;
        else if (last.m === SHARP || p.m === SHARP) last.m = undefined;
        return;
      }
      all.push({ ...p });
    });
  }
  return all;
}

/** Окружность, замкнутый контур против часовой стрелки. */
export function circle(r: number, n = 16, cx = 0, cy = 0, phase = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, m: SMOOTH });
  }
  return out;
}

/** Правильный многоугольник с жёсткими углами. */
export function ngon(r: number, n: number, phase = 0): Pt[] {
  return circle(r, n, 0, 0, phase).map((p) => ({ ...p, m: SHARP as Mode }));
}

/** Прямоугольник с центром в нуле, против часовой; radius скругляет углы. */
export function rect(w: number, h: number, radius = 0, steps = 3): Pt[] {
  const x = w / 2;
  const y = h / 2;
  return corners(
    [
      [x, -y, radius],
      [x, y, radius],
      [-x, y, radius],
      [-x, -y, radius],
    ],
    { closed: true, steps },
  );
}

/**
 * Расставить режимы там, где они не заданы: излом круче sharpAngle — жёсткое
 * ребро, иначе гладко. Возвращает копию.
 */
export function resolve(list: readonly PtLike[], closed: boolean, sharpAngle = 0.5): Pt[] {
  const p = pts(list).map((q) => ({ ...q }));
  const n = p.length;
  for (let i = 0; i < n; i++) {
    if (p[i].m !== undefined) continue;
    if (!closed && (i === 0 || i === n - 1)) {
      p[i].m = SHARP;
      continue;
    }
    const a = p[(i - 1 + n) % n];
    const c = p[(i + 1) % n];
    const ux = p[i].x - a.x;
    const uy = p[i].y - a.y;
    const wx = c.x - p[i].x;
    const wy = c.y - p[i].y;
    const d = (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy) || 1);
    p[i].m = Math.acos(clamp(d, -1, 1)) > sharpAngle ? SHARP : SMOOTH;
  }
  return p;
}

/**
 * Сдвинуть замкнутый контур внутрь на d (наружу при d < 0). Углы сдвигаются по
 * биссектрисе, поэтому годится для небольших d — фаски на пластинах.
 * Контур должен идти против часовой стрелки.
 */
export function inset(list: readonly Pt[], d: number): Pt[] {
  const n = list.length;
  return list.map((p, i) => {
    const a = list[(i - 1 + n) % n];
    const c = list[(i + 1) % n];
    let ux = p.x - a.x;
    let uy = p.y - a.y;
    let wx = c.x - p.x;
    let wy = c.y - p.y;
    const ul = Math.hypot(ux, uy) || 1;
    const wl = Math.hypot(wx, wy) || 1;
    ux /= ul;
    uy /= ul;
    wx /= wl;
    wy /= wl;
    // Внутренние нормали двух сторон (влево от направления обхода).
    let nx = -uy - wy;
    let ny = ux + wx;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) return { ...p };
    nx /= nl;
    ny /= nl;
    const cosHalf = Math.max(0.35, nx * -uy + ny * ux); // не даём острым углам улетать
    return { x: p.x + (nx * d) / cosHalf, y: p.y + (ny * d) / cosHalf, m: p.m };
  });
}

/** Площадь со знаком: положительная у контура против часовой. */
export function area(list: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const b = list[(i + 1) % list.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Длина контура по точкам: накопленная, от нуля. */
export function lengths(list: readonly Pt[], closed = false): number[] {
  const out = [0];
  for (let i = 1; i < list.length + (closed ? 1 : 0); i++) {
    const a = list[i - 1];
    const b = list[i % list.length];
    out.push(out[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return out;
}
