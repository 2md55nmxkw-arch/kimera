// Линии «от руки» для пометок на листе дизайнера: петля вокруг детали, стрелка,
// подчёркивание. Каждая линия — путь SVG, слегка неровный; зерно решает, какой
// именно. Меняя зерно восемь раз в секунду, получаем то же «кипение», что и у
// карандашной шкуры.
//
// Неровность считается чистой функцией от зерна, а не через core/random.ts:
// та последовательность общая (от неё зависит, например, моргание), и лишние
// вызовы отсюда сдвинули бы её для всех остальных.

export type Pt = [x: number, y: number];

/** Число 0…1 по трём целым. */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Зерно из строки: у каждой пометки свой почерк. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const n = (v: number): string => (Math.round(v * 10) / 10).toString();

/** Плавная кривая через точки (сплайн Катмулла — Рома, записанный кубическими Безье). */
export function through(points: Pt[]): string {
  if (points.length < 2) return '';
  let d = `M${n(points[0][0])} ${n(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

/**
 * Штрих от a к b: слегка выгнут и неровен, как линия без линейки.
 * @param bow  выгиб в долях длины (знак — в какую сторону)
 * @param amp  неровность, пиксели
 */
export function strokePoints(a: Pt, b: Pt, seed: number, bow = 0, amp = 1.1): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const count = Math.max(3, Math.round(len / 26) + 1);
  const points: Pt[] = [];
  for (let i = 0; i <= count; i++) {
    const k = i / count;
    // Концы стоят на месте, середина гуляет.
    const free = Math.sin(k * Math.PI);
    const off = bow * len * 4 * k * (1 - k) + (hash(seed, i, 1) - 0.5) * 2 * amp * (0.35 + free * 0.65);
    points.push([a[0] + dx * k + nx * off, a[1] + dy * k + ny * off]);
  }
  return points;
}

export const stroke = (a: Pt, b: Pt, seed: number, bow = 0, amp = 1.1): string => through(strokePoints(a, b, seed, bow, amp));

/**
 * Стрелка от пометки к детали. Путь начинается с наконечника: так при появлении
 * линия растёт от детали, на которую смотрит посетитель, к тексту.
 */
export function arrow(from: Pt, tip: Pt, seed: number): string {
  const bow = (hash(seed, 7) - 0.5) * 0.22;
  const shaft = strokePoints(tip, from, seed, bow);
  // Наконечник — две короткие черты, развёрнутые от направления, в котором стрелка пришла.
  const [ax, ay] = shaft[1];
  const back = Math.atan2(ay - tip[1], ax - tip[0]);
  const wing = (side: number, salt: number): Pt => {
    const angle = back + side * (0.42 + hash(seed, salt) * 0.16);
    const len = 10 + hash(seed, salt + 1) * 4;
    return [tip[0] + Math.cos(angle) * len, tip[1] + Math.sin(angle) * len];
  };
  const w1 = wing(1, 11);
  const w2 = wing(-1, 13);
  return `M${n(w1[0])} ${n(w1[1])}L${n(tip[0])} ${n(tip[1])}L${n(w2[0])} ${n(w2[1])}${through(shaft)}`;
}

/**
 * Петля вокруг детали: овал, нарисованный одним быстрым движением. Он не совсем
 * ровный и не замыкается — конец проскакивает мимо начала.
 * @param rx, ry полуоси в пикселях; центр в нуле
 */
export function loop(rx: number, ry: number, seed: number): string {
  const start = -2.2 + (hash(seed, 3) - 0.5) * 0.8;
  const turn = Math.PI * 2 + 0.55 + hash(seed, 4) * 0.35;
  const tilt = (hash(seed, 5) - 0.5) * 0.3;
  const lobes = 2 + Math.floor(hash(seed, 6) * 2);
  const phase = hash(seed, 8) * Math.PI * 2;
  const count = 26;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const points: Pt[] = [];
  for (let i = 0; i <= count; i++) {
    const k = i / count;
    const a = start + turn * k;
    // К концу рука уходит чуть наружу: линия не попадает в собственное начало.
    const r = 1 + 0.045 * Math.sin(a * lobes + phase) + (hash(seed, i, 2) - 0.5) * 0.05 + (k - 0.5) * 0.09;
    const x = Math.cos(a) * rx * r;
    const y = Math.sin(a) * ry * r;
    points.push([x * cos - y * sin, x * sin + y * cos]);
  }
  return through(points);
}
