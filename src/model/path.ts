// Пути в пространстве для выдавливания: сплайн через точки, спираль, дуга —
// и «рамки» вдоль пути: в каждой точке касательная и две поперечные оси, которые
// не закручиваются сами по себе (перенос без кручения).
import { add, clamp, cross, dot, len, mix, mul, perp, sub, TAU, turn, unit, type V3 } from './vec';

/** Гладкая кривая через точки (Катмулл — Ром), `steps` отрезков на пролёт. */
export function spline(points: readonly V3[], steps = 8, closed = false): V3[] {
  const n = points.length;
  const get = (i: number) => (closed ? points[((i % n) + n) % n] : points[clamp(i, 0, n - 1)]);
  const out: V3[] = [];
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
      const f = (k: 0 | 1 | 2) =>
        0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
  }
  if (!closed) out.push(points[n - 1]);
  return out;
}

/** Отрезок прямой, разбитый на части. */
export function line(a: V3, b: V3, steps = 1): V3[] {
  const out: V3[] = [];
  for (let s = 0; s <= steps; s++) out.push(mix(a, b, s / steps));
  return out;
}

/**
 * Спираль вокруг оси Y. Радиус и высота могут меняться по ходу: функции от t = 0…1.
 * @param turns сколько витков
 */
export function helix(
  radius: number | ((t: number) => number),
  height: number | ((t: number) => number),
  turns: number,
  steps: number,
  phase = 0,
): V3[] {
  const out: V3[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const r = typeof radius === 'number' ? radius : radius(t);
    const y = typeof height === 'number' ? height * t : height(t);
    const a = phase + t * turns * TAU;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

/** Окружность в плоскости XZ вокруг оси Y. Замкнутый путь: последняя точка не повторяет первую. */
export function ring(radius: number, steps: number, y = 0): V3[] {
  const out: V3[] = [];
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * TAU;
    out.push([Math.cos(a) * radius, y, Math.sin(a) * radius]);
  }
  return out;
}

/** Накопленная длина пути по точкам, от нуля. */
export function pathLengths(path: readonly V3[], closed = false): number[] {
  const out = [0];
  const n = path.length;
  for (let i = 1; i < n + (closed ? 1 : 0); i++) out.push(out[i - 1] + len(sub(path[i % n], path[i - 1])));
  return out;
}

/** Переложить точки пути равномерно по длине. */
export function resample(path: readonly V3[], count: number): V3[] {
  const L = pathLengths(path);
  const total = L[L.length - 1];
  const out: V3[] = [];
  let k = 0;
  for (let s = 0; s < count; s++) {
    const d = (s / (count - 1)) * total;
    while (k < path.length - 2 && L[k + 1] < d) k++;
    const span = L[k + 1] - L[k] || 1;
    out.push(mix(path[k], path[k + 1], clamp((d - L[k]) / span, 0, 1)));
  }
  return out;
}

export interface Frame {
  /** Точка пути. */
  o: V3;
  /** Касательная. */
  t: V3;
  /** Поперечные оси: сечение лежит в плоскости (n, b), причём n × b = t. */
  n: V3;
  b: V3;
}

/**
 * Рамки вдоль пути. Поперечные оси переносятся от точки к точке кратчайшим
 * поворотом, поэтому сечение не крутится, куда бы путь ни гнулся. У замкнутого
 * пути накопившийся за круг поворот раздаётся поровну по всем точкам.
 * @param up куда по возможности смотрит ось n в начале пути
 */
export function frames(path: readonly V3[], closed = false, up?: V3): Frame[] {
  const n = path.length;
  const tangent = (i: number): V3 => {
    const a = closed ? path[(i - 1 + n) % n] : path[Math.max(0, i - 1)];
    const b = closed ? path[(i + 1) % n] : path[Math.min(n - 1, i + 1)];
    return unit(sub(b, a), [0, 1, 0]);
  };
  const t0 = tangent(0);
  let normal: V3 = up ? unit(sub(up, mul(t0, dot(up, t0))), perp(t0)) : perp(t0);
  const out: Frame[] = [];
  let prev = t0;
  for (let i = 0; i < n; i++) {
    const t = tangent(i);
    const axis = cross(prev, t);
    const s = len(axis);
    if (s > 1e-9) normal = turn(normal, mul(axis, 1 / s), Math.atan2(s, dot(prev, t)));
    normal = unit(sub(normal, mul(t, dot(normal, t))), perp(t)); // убрать накопившуюся погрешность
    out.push({ o: path[i], t, n: normal, b: cross(t, normal) });
    prev = t;
  }
  if (closed && n > 2) {
    // На сколько ось не сошлась сама с собой после полного круга.
    const t = out[0].t;
    const axis = cross(prev, t);
    const s = len(axis);
    let back = normal;
    if (s > 1e-9) back = turn(back, mul(axis, 1 / s), Math.atan2(s, dot(prev, t)));
    const miss = Math.atan2(dot(cross(back, out[0].n), t), dot(back, out[0].n));
    for (let i = 0; i < n; i++) {
      const f = out[i];
      const nn = turn(f.n, f.t, (miss * i) / n);
      out[i] = { o: f.o, t: f.t, n: nn, b: cross(f.t, nn) };
    }
  }
  return out;
}

/** Точка сечения (x, y) в рамке. */
export const inFrame = (f: Frame, x: number, y: number): V3 => add(f.o, add(mul(f.n, x), mul(f.b, y)));
