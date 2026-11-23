// Куда поставить подпись рядом с точкой, на которую она указывает.
//
// Правила, по убыванию важности: подпись не выходит за экран; не закрывает лицо;
// не ложится на текст главы, служебные строки и другие подписи; стоит с той
// стороны, с какой её просили, и не дальше, чем нужно. Решается перебором:
// несколько направлений вокруг точки, несколько расстояний, у каждого варианта
// штраф — выигрывает наименьший.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  /** Точка, к которой относится подпись. */
  anchor: { x: number; y: number };
  size: { w: number; h: number };
  /** С какой стороны ставить: угол в градусах, 0 — справа, 90 — сверху, 180 — слева. */
  side: number;
  /** Сколько оставить от точки до ближнего края подписи. */
  gap: number;
  /** Поле, за которое выходить нельзя. */
  bounds: Box;
  /** Лицо: его подпись не закрывает никогда. */
  face: Box | null;
  /** Куда нельзя: текст, служебные строки, другие подписи. */
  hard: Box[];
  /** Куда нежелательно: фигура, чужие метки. */
  soft: Box[];
}

const TURNS = [0, 18, -18, 36, -36, 58, -58, 80, -80, 105, -105, 135, -135, 165, -165, 180];
const REACH = [1, 1.3, 1.7, 2.3, 3.1];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export const inflate = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 });

/** Площадь пересечения. */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Расстояние от точки до прямоугольника (0 — точка внутри). */
export function distanceTo(b: Box, x: number, y: number): number {
  return Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));
}

const within = (box: Box, bounds: Box): Box => ({
  ...box,
  x: clamp(box.x, bounds.x, bounds.x + bounds.w - box.w),
  y: clamp(box.y, bounds.y, bounds.y + bounds.h - box.h),
});

/** Сдвинуть подпись с лица кратчайшим путём, не выходя за поле. */
function offFace(box: Box, face: Box, bounds: Box): Box {
  if (!overlap(box, face)) return box;
  const moves: Box[] = [
    { ...box, x: face.x - box.w },
    { ...box, x: face.x + face.w },
    { ...box, y: face.y - box.h },
    { ...box, y: face.y + face.h },
  ];
  let best = box;
  let bestCost = Infinity;
  for (const move of moves) {
    const kept = within(move, bounds);
    // Вариант, который после возврата в поле снова закрыл лицо, не годится.
    const cost = Math.hypot(kept.x - box.x, kept.y - box.y) + (overlap(kept, face) ? 1e6 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = kept;
    }
  }
  return best;
}

/** @returns левый верхний угол подписи и то, удалось ли никого не задеть */
export function place(p: Placement): { x: number; y: number; clean: boolean } {
  const { anchor, size, gap, bounds } = p;
  const hw = size.w / 2;
  const hh = size.h / 2;
  const area = Math.max(size.w * size.h, 1);
  let best: Box = within({ x: anchor.x + gap, y: anchor.y - hh, w: size.w, h: size.h }, bounds);
  let bestScore = Infinity;
  let clean = false;

  for (const turn of TURNS) {
    const angle = ((p.side + turn) * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = -Math.sin(angle); // на экране ось Y смотрит вниз
    // Сколько от центра подписи до её края вдоль этого направления.
    const edge = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    for (const reach of REACH) {
      const dist = gap * reach + edge;
      const wanted: Box = { x: anchor.x + dx * dist - hw, y: anchor.y + dy * dist - hh, w: size.w, h: size.h };
      const box = within(wanted, bounds);
      const pushed = Math.hypot(box.x - wanted.x, box.y - wanted.y);
      const near = distanceTo(box, anchor.x, anchor.y);

      let blocked = p.face ? overlap(box, p.face) * 4 : 0;
      for (const o of p.hard) blocked += overlap(box, o);
      let crowded = 0;
      for (const o of p.soft) crowded += overlap(box, o);

      const score =
        Math.abs(turn) * 0.55 +
        (reach - 1) * 46 +
        pushed * 0.9 +
        // Прижалась к самой точке — закрыла то, на что указывает.
        (near < gap * 0.5 ? (gap * 0.5 - near) * 6 + 150 : 0) +
        (blocked > 0 ? 1200 + (blocked / area) * 4000 : 0) +
        (crowded / area) * 160;
      if (score < bestScore) {
        bestScore = score;
        best = box;
        clean = blocked === 0;
      }
    }
  }

  if (p.face) {
    const moved = offFace(best, p.face, bounds);
    if (moved !== best) {
      best = moved;
      clean = false;
    }
  }
  return { x: best.x, y: best.y, clean };
}
