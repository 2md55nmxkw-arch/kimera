// Поверхность по сетке точек — основа всех генераторов. Тело вращения, выдавливание
// вдоль кривой, коробка с фасками: всё это сетка «ряды × столбцы», у которой по
// рядам и по столбцам размечены рёбра (см. режимы в outline.ts).
//
// Нормали считаются по самой сетке: разность соседних точек вдоль рядов и вдоль
// столбцов, векторное произведение. На жёстком ребре вершина раздваивается, и каждая
// половина берёт разность только со своей стороны. Поэтому нормали верны и там, где
// форма задана функцией (волна по радиусу, скрутка, сужение), а не формулой.
//
// Куда смотрит нормаль: ряд × столбец. У тела вращения с профилем снизу вверх это
// наружу; профиль, идущий сверху вниз, даёт стенку, видимую изнутри, — так чашка
// или абажур записываются одним профилем: вверх по внешней стороне, через край и
// вниз по внутренней.
import { Geo } from './geo';
import { NEXT, PREV, SHARP, SMOOTH, type Mode } from './outline';
import { cross, sub, type V2, type V3 } from './vec';

export interface SurfaceSpec {
  rows: number;
  cols: number;
  /** Точка сетки. */
  at(i: number, j: number): V3;
  rowMode?(i: number): Mode;
  colMode?(j: number): Mode;
  /** Последний ряд соединяется с первым. */
  wrapRows?: boolean;
  /** Последний столбец соединяется с первым. */
  wrapCols?: boolean;
  /** uv вершины; у замкнутой сетки шов получает номер rows (cols), а не 0. */
  uv?(i: number, j: number): V2;
  /** Вывернуть: нормаль = столбец × ряд. */
  flip?: boolean;
  /**
   * Своя нормаль вместо посчитанной (вернуть undefined — оставить посчитанную).
   * side: −1 — вершина со стороны «до» ребра, +1 — «после», 0 — общая.
   */
  normal?(i: number, j: number, rowSide: number, colSide: number): V3 | undefined;
}

const EPS2 = 1e-16;
const len2 = (a: V3): number => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
const mod = (i: number, n: number): number => ((i % n) + n) % n;

/** Построить поверхность по сетке и дописать её в `out` (или в новую деталь). */
export function surface(spec: SurfaceSpec, out: Geo = new Geo()): Geo {
  const { rows, cols, wrapRows = false, wrapCols = false, flip = false } = spec;
  const first = out.vertexCount;
  const P: V3[] = new Array(rows * cols);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) P[i * cols + j] = spec.at(i, j);
  const p = (i: number, j: number): V3 => P[mod(i, rows) * cols + mod(j, cols)];
  const same = (a: V3, b: V3): boolean => len2(sub(a, b)) < EPS2;
  const rowMode = (i: number): Mode => spec.rowMode?.(mod(i, rows)) ?? SMOOTH;
  const colMode = (j: number): Mode => spec.colMode?.(mod(j, cols)) ?? SMOOTH;

  // Полюс: ряд, стянутый в точку (вершина конуса, макушка шара).
  const pole: boolean[] = [];
  for (let i = 0; i < rows; i++) {
    let all = true;
    for (let j = 1; j < cols && all; j++) all = same(P[i * cols], P[i * cols + j]);
    pole.push(all && cols > 1);
  }

  const hasPrevRow = (i: number) => wrapRows || i > 0;
  const hasNextRow = (i: number) => wrapRows || mod(i, rows) < rows - 1;
  const hasPrevCol = (j: number) => wrapCols || j > 0;
  const hasNextCol = (j: number) => wrapCols || mod(j, cols) < cols - 1;

  /** Разность вдоль рядов: side −1 — назад, +1 — вперёд, 0 — через точку. */
  const dRow = (i: number, j: number, side: number): V3 => {
    const prev = hasPrevRow(i);
    const next = hasNextRow(i);
    const s = !prev ? 1 : !next ? -1 : side;
    let d = s < 0 ? sub(p(i, j), p(i - 1, j)) : s > 0 ? sub(p(i + 1, j), p(i, j)) : sub(p(i + 1, j), p(i - 1, j));
    if (len2(d) < EPS2 && next) d = sub(p(i + 1, j), p(i, j));
    if (len2(d) < EPS2 && prev) d = sub(p(i, j), p(i - 1, j));
    return d;
  };
  const dCol = (i: number, j: number, side: number): V3 => {
    const prev = hasPrevCol(j);
    const next = hasNextCol(j);
    const s = !prev ? 1 : !next ? -1 : side;
    let d = s < 0 ? sub(p(i, j), p(i, j - 1)) : s > 0 ? sub(p(i, j + 1), p(i, j)) : sub(p(i, j + 1), p(i, j - 1));
    if (len2(d) < EPS2 && next) d = sub(p(i, j + 1), p(i, j));
    if (len2(d) < EPS2 && prev) d = sub(p(i, j), p(i, j - 1));
    return d;
  };
  /** С какой стороны брать разность: по режиму точки и по тому, какой полосе нужна вершина. */
  const sideOf = (mode: Mode, band: number): number => (mode === SHARP ? band : mode === PREV ? -1 : mode === NEXT ? 1 : 0);

  const raw = (i: number, j: number, rs: number, cs: number): V3 => {
    const n = flip ? cross(dCol(i, j, cs), dRow(i, j, rs)) : cross(dRow(i, j, rs), dCol(i, j, cs));
    const l = Math.sqrt(len2(n));
    return l > 1e-14 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
  };

  // Нормаль на полюсе берётся с соседнего ряда: у гладкого полюса — средняя по
  // кругу (ось), у жёсткого — своя в каждом столбце, как у вершины конуса.
  const poleAverage = new Map<number, V3>();
  const poleNormal = (i: number, j: number, band: number, cs: number): V3 => {
    const useNext = hasNextRow(i) && (band >= 0 || !hasPrevRow(i));
    const adj = useNext ? i + 1 : i - 1;
    const facing = useNext ? -1 : 1;
    if (rowMode(i) === SHARP) return raw(adj, j, facing, cs);
    const key = mod(i, rows) * 2 + (useNext ? 1 : 0);
    let avg = poleAverage.get(key);
    if (!avg) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = 0; k < cols; k++) {
        const n = raw(adj, k, facing, 0);
        x += n[0];
        y += n[1];
        z += n[2];
      }
      const l = Math.hypot(x, y, z);
      avg = l > 1e-9 ? [x / l, y / l, z / l] : [0, 0, 0];
      poleAverage.set(key, avg);
    }
    return avg;
  };

  const R = wrapRows ? rows + 1 : rows;
  const C = wrapCols ? cols + 1 : cols;
  const rowSplit = (i: number) => rowMode(i) === SHARP && hasPrevRow(i) && hasNextRow(i);
  const colSplit = (j: number) => colMode(j) === SHARP && hasPrevCol(j) && hasNextCol(j);
  const made = new Map<number, number>();
  const uvOf = spec.uv ?? ((i: number, j: number): V2 => [j / Math.max(1, C - 1), i / Math.max(1, R - 1)]);

  /** Вершина для полосы: rowBand +1 — полоса после ряда i, −1 — до него; так же столбцы. */
  const vertex = (i: number, j: number, rowBand: number, colBand: number): number => {
    const rk = rowSplit(i) ? rowBand : 0;
    const ck = colSplit(j) ? colBand : 0;
    const key = (i * 3 + rk + 1) * (C * 3) + j * 3 + ck + 1;
    let v = made.get(key);
    if (v !== undefined) return v;
    const rs = sideOf(rowMode(i), rowBand);
    const cs = sideOf(colMode(j), colBand);
    const n = spec.normal?.(mod(i, rows), mod(j, cols), rk, ck) ?? (pole[mod(i, rows)] ? poleNormal(i, j, rowBand, cs) : raw(i, j, rs, cs));
    v = out.vert(p(i, j), n, uvOf(i, j));
    made.set(key, v);
    return v;
  };

  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < C - 1; j++) {
      const pa = p(i, j);
      const pb = p(i + 1, j);
      const pc = p(i + 1, j + 1);
      const pd = p(i, j + 1);
      const t1 = !same(pa, pb) && !same(pb, pd) && !same(pa, pd);
      const t2 = !same(pb, pc) && !same(pc, pd) && !same(pb, pd);
      if (!t1 && !t2) continue;
      const b = vertex(i + 1, j, -1, 1);
      const d = vertex(i, j + 1, 1, -1);
      if (t1) {
        const a = vertex(i, j, 1, 1);
        if (flip) out.tri(a, d, b);
        else out.tri(a, b, d);
      }
      if (t2) {
        const c = vertex(i + 1, j + 1, -1, -1);
        if (flip) out.tri(b, d, c);
        else out.tri(b, c, d);
      }
    }
  }
  return out.fixNormals(first);
}
