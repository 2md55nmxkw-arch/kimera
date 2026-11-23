// Geo — заготовка детали: вершины с нормалями и треугольники, пока ещё в обычных
// массивах. Деталь собирают генераторы (surface.ts, solids.ts), потом её двигают,
// красят, зеркалят и складывают с другими; в BufferGeometry она превращается один
// раз, в самом конце (assembly.ts).
//
// У каждой вершины, кроме положения, нормали и uv, есть ещё два набора чисел:
//   tex — «материальные» координаты, метры, плюс отделка в четвёртом числе.
//         Записываются при создании детали и при сдвигах и поворотах НЕ меняются:
//         по ним считаются процедурные фактуры, поэтому волокна дерева идут вдоль
//         своей ножки, куда бы её потом ни повернули, и швов развёртки нет вовсе.
//         Отделка: 0 — матовая, до 1 — всё более глянцевая краска, от 1 до 2 —
//         металл от тусклого к зеркальному (см. materials.ts).
//   col — оттенок (линейный RGB, умножается на цвет материала) и запечённое
//         затенение в альфе (ao.ts). Оттенок позволяет красить части одной детали
//         по-разному, не заводя новый материал и новый вызов отрисовки.
import * as THREE from 'three/webgpu';
import { cross, type V2, type V3 } from './vec';

/** Имя вершинного атрибута с материальными координатами и отделкой. */
export const TEX = 'tex';

type Axis = 'x' | 'y' | 'z';
const AXIS: Record<Axis, number> = { x: 0, y: 1, z: 2 };

const scratchColor = new THREE.Color();
/** Цвет в линейные числа, как их ждёт шейдер. */
export const rgb = (color: THREE.ColorRepresentation): V3 => {
  scratchColor.set(color);
  return [scratchColor.r, scratchColor.g, scratchColor.b];
};

export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  tex: number[] = [];
  col: number[] = [];
  /** Целая метка вершины: у манекена это номер кости. */
  mark: number[] = [];
  idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Добавить вершину. Материальные координаты равны положению. */
  vert(p: V3, n: V3, uv: V2 = [0, 0]): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.tex.push(p[0], p[1], p[2], 0);
    this.col.push(1, 1, 1, 1);
    this.mark.push(0);
    return i;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  at(i: number): V3 {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }
  normalAt(i: number): V3 {
    return [this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]];
  }

  /** Дописать другие детали в эту. */
  add(...others: Geo[]): this {
    for (const o of others) {
      const base = this.vertexCount;
      for (const v of o.pos) this.pos.push(v);
      for (const v of o.nor) this.nor.push(v);
      for (const v of o.uv) this.uv.push(v);
      for (const v of o.tex) this.tex.push(v);
      for (const v of o.col) this.col.push(v);
      for (const v of o.mark) this.mark.push(v);
      for (const v of o.idx) this.idx.push(v + base);
    }
    return this;
  }
  clone(): Geo {
    return new Geo().add(this);
  }

  // ── положение ────────────────────────────────────────────────────────

  /** Применить матрицу к положениям и нормалям. Материальные координаты остаются. */
  apply(m: THREE.Matrix4): this {
    const e = m.elements;
    const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
    const { pos, nor } = this;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      pos[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = nor[i];
      const ny = nor[i + 1];
      const nz = nor[i + 2];
      const ax = nm[0] * nx + nm[3] * ny + nm[6] * nz;
      const ay = nm[1] * nx + nm[4] * ny + nm[7] * nz;
      const az = nm[2] * nx + nm[5] * ny + nm[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      nor[i] = ax / l;
      nor[i + 1] = ay / l;
      nor[i + 2] = az / l;
    }
    // Отражение выворачивает треугольники наизнанку — возвращаем обход.
    if (m.determinant() < 0) this.flipWinding();
    return this;
  }
  move(x: number, y: number, z: number): this {
    const { pos } = this;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += x;
      pos[i + 1] += y;
      pos[i + 2] += z;
    }
    return this;
  }
  rotX(angle: number): this {
    return this.apply(new THREE.Matrix4().makeRotationX(angle));
  }
  rotY(angle: number): this {
    return this.apply(new THREE.Matrix4().makeRotationY(angle));
  }
  rotZ(angle: number): this {
    return this.apply(new THREE.Matrix4().makeRotationZ(angle));
  }
  /** Повернуть вокруг произвольной оси. */
  rotAxis(axis: V3, angle: number): this {
    return this.apply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...axis).normalize(), angle));
  }
  /** Повернуть так, чтобы ось +Y детали легла вдоль направления dir. */
  aim(dir: V3): this {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
    return this.apply(new THREE.Matrix4().makeRotationFromQuaternion(q));
  }
  scale(sx: number, sy = sx, sz = sx): this {
    return this.apply(new THREE.Matrix4().makeScale(sx, sy, sz));
  }
  /** Отразить на месте поперёк оси. */
  mirror(axis: Axis): this {
    return this.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1);
  }
  /** Зеркальная копия; оригинал не меняется. */
  mirrored(axis: Axis): Geo {
    return this.clone().mirror(axis);
  }
  flipWinding(): this {
    const { idx } = this;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    return this;
  }
  /** Вывернуть: и обход, и нормали. */
  invert(): this {
    for (let i = 0; i < this.nor.length; i++) this.nor[i] = -this.nor[i];
    return this.flipWinding();
  }
  /** Сделать тонкий лист видимым с обеих сторон: дописать вывернутую копию. */
  doubleSided(): this {
    return this.add(this.clone().invert());
  }

  /**
   * Деформировать деталь произвольной гладкой функцией (согнуть, сузить, скрутить).
   * Нормали пересчитываются точно — через производные функции в каждой вершине,
   * поэтому заданные жёсткие и мягкие рёбра остаются какими были.
   */
  warp(fn: (p: V3) => V3): this {
    const { pos, nor } = this;
    const h = 1e-4;
    for (let i = 0; i < pos.length; i += 3) {
      const p: V3 = [pos[i], pos[i + 1], pos[i + 2]];
      const q = fn(p);
      const qx = fn([p[0] + h, p[1], p[2]]);
      const qy = fn([p[0], p[1] + h, p[2]]);
      const qz = fn([p[0], p[1], p[2] + h]);
      const jx: V3 = [qx[0] - q[0], qx[1] - q[1], qx[2] - q[2]];
      const jy: V3 = [qy[0] - q[0], qy[1] - q[1], qy[2] - q[2]];
      const jz: V3 = [qz[0] - q[0], qz[1] - q[1], qz[2] - q[2]];
      // Нормаль переносится матрицей алгебраических дополнений якобиана.
      const cx = cross(jy, jz);
      const cy = cross(jz, jx);
      const cz = cross(jx, jy);
      const nx = nor[i] * cx[0] + nor[i + 1] * cy[0] + nor[i + 2] * cz[0];
      const ny = nor[i] * cx[1] + nor[i + 1] * cy[1] + nor[i + 2] * cz[1];
      const nz = nor[i] * cx[2] + nor[i + 1] * cy[2] + nor[i + 2] * cz[2];
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-20) {
        nor[i] = nx / l;
        nor[i + 1] = ny / l;
        nor[i + 2] = nz / l;
      }
      pos[i] = q[0];
      pos[i + 1] = q[1];
      pos[i + 2] = q[2];
    }
    return this;
  }

  // ── цвет, отделка, материальные координаты ───────────────────────────

  /** Оттенок всей детали. */
  tint(color: THREE.ColorRepresentation): this {
    const [r, g, b] = rgb(color);
    const { col } = this;
    for (let i = 0; i < col.length; i += 4) {
      col[i] = r;
      col[i + 1] = g;
      col[i + 2] = b;
    }
    return this;
  }
  /** Оттенок по вершинам: функция получает положение и материальные координаты. */
  tintBy(fn: (p: V3, uv: V2, index: number) => THREE.ColorRepresentation | null): this {
    const { col, pos, uv } = this;
    for (let i = 0; i < this.vertexCount; i++) {
      const c = fn([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], [uv[i * 2], uv[i * 2 + 1]], i);
      if (c === null) continue;
      const [r, g, b] = rgb(c);
      col[i * 4] = r;
      col[i * 4 + 1] = g;
      col[i * 4 + 2] = b;
    }
    return this;
  }
  /** Отделка: 0 матовая … 1 глянец; 1…2 — металл (см. FINISH в materials.ts). */
  finish(value: number): this {
    const { tex } = this;
    for (let i = 3; i < tex.length; i += 4) tex[i] = value;
    return this;
  }
  /** Отделка по вершинам — когда четвёртое число материал читает как маску. */
  finishBy(fn: (p: V3, uv: V2, index: number) => number): this {
    const { tex, pos, uv } = this;
    for (let i = 0; i < this.vertexCount; i++) {
      tex[i * 4 + 3] = fn([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], [uv[i * 2], uv[i * 2 + 1]], i);
    }
    return this;
  }
  /** Целая метка всех вершин (номер кости). */
  group(k: number): this {
    this.mark.fill(k);
    return this;
  }
  /**
   * Заново снять материальные координаты с нынешних положений. Ось волокон у
   * дерева — Y материальных координат; `along` говорит, какая ось детали ею станет.
   */
  retex(along: Axis = 'y'): this {
    const { tex, pos } = this;
    const a = AXIS[along];
    const b = a === 1 ? 0 : 1; // что уходит на место X (для 'y' — как есть)
    for (let i = 0; i < this.vertexCount; i++) {
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      if (along === 'y') {
        tex[i * 4] = p[0];
        tex[i * 4 + 1] = p[1];
        tex[i * 4 + 2] = p[2];
      } else {
        tex[i * 4] = p[b];
        tex[i * 4 + 1] = p[a];
        tex[i * 4 + 2] = p[3 - a - b];
      }
    }
    return this;
  }
  /** Сдвинуть материальные координаты: у двух одинаковых деталей будет разный рисунок. */
  texMove(x: number, y: number, z: number): this {
    const { tex } = this;
    for (let i = 0; i < tex.length; i += 4) {
      tex[i] += x;
      tex[i + 1] += y;
      tex[i + 2] += z;
    }
    return this;
  }
  /** Растянуть материальные координаты (мельче или крупнее рисунок). */
  texScale(k: number): this {
    const { tex } = this;
    for (let i = 0; i < tex.length; i += 4) {
      tex[i] *= k;
      tex[i + 1] *= k;
      tex[i + 2] *= k;
    }
    return this;
  }
  /** Сдвинуть и растянуть uv. */
  uvMap(su: number, sv: number, ou = 0, ov = 0): this {
    const { uv } = this;
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = uv[i] * su + ou;
      uv[i + 1] = uv[i + 1] * sv + ov;
    }
    return this;
  }

  // ── сетка ────────────────────────────────────────────────────────────

  /**
   * Раздробить длинные рёбра, пока не станут короче maxEdge. Плоское остаётся
   * плоским; нужно это для запечённого затенения — оно хранится в вершинах, и на
   * грани из двух треугольников тень от стоящего на ней предмета лечь не может.
   * Ребро делится по своей длине, а не по треугольнику, поэтому у соседей оно
   * делится одинаково и щелей не появляется.
   */
  subdivide(maxEdge: number, passes = 6): this {
    const max2 = maxEdge * maxEdge;
    for (let pass = 0; pass < passes; pass++) {
      const { pos, idx } = this;
      const mids = new Map<number, number>();
      const count = this.vertexCount;
      const long = (a: number, b: number): boolean => {
        const dx = pos[a * 3] - pos[b * 3];
        const dy = pos[a * 3 + 1] - pos[b * 3 + 1];
        const dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        return dx * dx + dy * dy + dz * dz > max2;
      };
      const mid = (a: number, b: number): number => {
        const key = a < b ? a * count + b : b * count + a;
        let m = mids.get(key);
        if (m === undefined) {
          m = this.blend(a, b);
          mids.set(key, m);
        }
        return m;
      };
      const next: number[] = [];
      let split = false;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t];
        const b = idx[t + 1];
        const c = idx[t + 2];
        const ab = long(a, b);
        const bc = long(b, c);
        const ca = long(c, a);
        const n = Number(ab) + Number(bc) + Number(ca);
        if (n === 0) {
          next.push(a, b, c);
          continue;
        }
        split = true;
        if (n === 3) {
          const x = mid(a, b);
          const y = mid(b, c);
          const z = mid(c, a);
          next.push(a, x, z, x, b, y, z, y, c, x, y, z);
        } else if (n === 1) {
          // Повернуть так, чтобы длинным было ребро p–q.
          const [p, q, r] = ab ? [a, b, c] : bc ? [b, c, a] : [c, a, b];
          const x = mid(p, q);
          next.push(p, x, r, x, q, r);
        } else {
          // Два длинных ребра: короткое — p–q.
          const [p, q, r] = !ab ? [a, b, c] : !bc ? [b, c, a] : [c, a, b];
          const x = mid(q, r);
          const y = mid(r, p);
          next.push(r, y, x, y, p, x, p, q, x);
        }
      }
      this.idx = next;
      if (!split) break;
    }
    return this;
  }
  /** Новая вершина посередине между двумя. */
  private blend(a: number, b: number): number {
    const { pos, nor, uv, tex, col, mark } = this;
    const i = this.vertexCount;
    for (let k = 0; k < 3; k++) pos.push((pos[a * 3 + k] + pos[b * 3 + k]) / 2);
    const nx = nor[a * 3] + nor[b * 3];
    const ny = nor[a * 3 + 1] + nor[b * 3 + 1];
    const nz = nor[a * 3 + 2] + nor[b * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    for (let k = 0; k < 2; k++) uv.push((uv[a * 2 + k] + uv[b * 2 + k]) / 2);
    for (let k = 0; k < 4; k++) tex.push((tex[a * 4 + k] + tex[b * 4 + k]) / 2);
    for (let k = 0; k < 4; k++) col.push((col[a * 4 + k] + col[b * 4 + k]) / 2);
    mark.push(mark[a]);
    return i;
  }

  /**
   * Починить вершины, у которых нормаль не получилась (нулевая): взять среднюю
   * по граням вокруг. Генераторы зовут это сами; вручную нужно редко.
   */
  fixNormals(from = 0): this {
    const { pos, nor, idx } = this;
    const bad = new Set<number>();
    for (let i = from; i < this.vertexCount; i++) {
      const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
      if (!(l > 0.5)) {
        bad.add(i);
        nor[i * 3] = nor[i * 3 + 1] = nor[i * 3 + 2] = 0;
      }
    }
    if (!bad.size) return this;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      if (!bad.has(a) && !bad.has(b) && !bad.has(c)) continue;
      const ux = pos[b * 3] - pos[a * 3];
      const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
      const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3];
      const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
      const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        if (!bad.has(v)) continue;
        nor[v * 3] += nx;
        nor[v * 3 + 1] += ny;
        nor[v * 3 + 2] += nz;
      }
    }
    for (const i of bad) {
      const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
      if (l > 0) {
        nor[i * 3] /= l;
        nor[i * 3 + 1] /= l;
        nor[i * 3 + 2] /= l;
      } else {
        nor[i * 3 + 1] = 1; // вершина без единой грани: что угодно, лишь бы не NaN
      }
    }
    return this;
  }

  /** Габариты: [минимум, максимум]. */
  bounds(): [V3, V3] {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const { pos } = this;
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < lo[k]) lo[k] = pos[i + k];
        if (pos[i + k] > hi[k]) hi[k] = pos[i + k];
      }
    }
    return [lo as unknown as V3, hi as unknown as V3];
  }

  /** Готовая геометрия для three. Атрибуты: position, normal, uv, tex (vec4), color (vec4). */
  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute(TEX, new THREE.Float32BufferAttribute(this.tex, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Сложить детали в одну новую. */
export const merge = (...parts: Geo[]): Geo => new Geo().add(...parts);
