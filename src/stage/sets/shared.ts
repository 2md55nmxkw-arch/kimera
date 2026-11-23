// Детали, общие для декораций: сама стена, полка, рама.
import { merge, type Geo } from '../../model/geo';
import { rect } from '../../model/outline';
import { box, plate } from '../../model/solids';
import { HEIGHT, RADIUS, WALL, part } from '../kit';
import type * as THREE from 'three/webgpu';

/**
 * Плита стены с цоколем: верх одного тона, низ другого, между ними рейка.
 * @param dado высота цоколя, 0 — без него
 */
export function wallSlab(upper: string, lower: string, dado = 0, rail = lower): THREE.Mesh {
  const parts: Geo[] = [];
  if (dado > 0) {
    parts.push(box(RADIUS, dado, WALL).move(RADIUS / 2, 0, -WALL / 2).tint(lower));
    parts.push(box(RADIUS, HEIGHT - dado, WALL).move(RADIUS / 2, dado, -WALL / 2).tint(upper));
    // Рейка поверх стыка: без неё граница двух тонов выглядит нарисованной.
    parts.push(box(RADIUS, 0.05, 0.03, { bevel: 0.008 }).move(RADIUS / 2, dado - 0.025, 0.015).tint(rail));
  } else {
    parts.push(box(RADIUS, HEIGHT, WALL).move(RADIUS / 2, 0, -WALL / 2).tint(upper));
  }
  // Плинтус и карниз — стена не должна заканчиваться голым обрезом.
  parts.push(box(RADIUS, 0.1, 0.025, { bevel: 0.008 }).move(RADIUS / 2, 0, 0.0125).tint(rail));
  parts.push(box(RADIUS, 0.07, 0.05, { bevel: 0.012 }).move(RADIUS / 2, HEIGHT - 0.07, 0.025).tint(rail));
  return part(merge(...parts), { set: true });
}

/** Полка на двух кронштейнах; верх полки на высоте y, середина в x. */
export function shelf(x: number, y: number, width: number, depth: number, color: string): Geo {
  const board = box(width, 0.028, depth, { bevel: 0.006 }).move(x, y - 0.028, depth / 2);
  const bracket = (bx: number) =>
    box(0.025, 0.12, depth * 0.7, { bevel: 0.005 }).move(bx, y - 0.148, depth * 0.35);
  return merge(board, bracket(x - width * 0.34), bracket(x + width * 0.34)).tint(color);
}

/** Рама с прямоугольным проёмом: внешний размер w × h, ширина бруска band. Центр в (x, y). */
export function frame(x: number, y: number, w: number, h: number, band: number, color: string, depth = 0.04): Geo {
  return plate(rect(w, h, 0.02), depth, { holes: [rect(w - band * 2, h - band * 2, 0.01)], bevel: 0.008 })
    .move(x, y, 0)
    .tint(color);
}

/** Тонкий лист на стене: бумага, стекло, холст. */
export function sheet(x: number, y: number, w: number, h: number, color: string, tilt = 0, out = 0.004): Geo {
  return box(w, h, 0.003)
    .move(0, -h / 2, 0)
    .rotZ(tilt)
    .move(x, y, out)
    .tint(color);
}

/** Обшивка из вертикальных досок от пола до высоты h: настоящие фаски, а не рисунок. */
export function planks(h: number, color: string, alt: string, count = 10): Geo {
  const w = RADIUS / count;
  const out: Geo[] = [];
  for (let i = 0; i < count; i++) {
    out.push(box(w - 0.006, h - 0.1, 0.018, { bevel: 0.006 }).move(w * (i + 0.5), 0.1, 0.009).tint(i % 2 ? alt : color));
  }
  return merge(...out);
}
