// 01 · Гримёрка. Шалфейная штукатурка над тёмной деревянной панелью (зелёный
// делает рыжие волосы ярче), зеркало в
// лампочках и корзина багетов — любимая вещь Тето по официальной анкете.
import { merge, type Geo } from '../../model/geo';
import { ball, box, lathe, tube } from '../../model/solids';
import type { V3 } from '../../model/vec';
import { mark, part, type StageSet } from '../kit';
import { frame, planks, sheet, shelf, wallSlab } from './shared';

const PLASTER = '#b3c0ad';
const WOOD = '#5e4134';
const WOOD_DARK = '#46302a';
const BRASS = '#c79a45';
const BULB = '#fff1c6';

/** Патрон с лампочкой: сам патрон — деталь, лампа светится отдельно. */
function bulbs(spots: [number, number][]): { sockets: Geo; lamps: Geo } {
  const sockets: Geo[] = [];
  const lamps: Geo[] = [];
  for (const [x, y] of spots) {
    sockets.push(
      lathe([
        [0, 0],
        [0.022, 0],
        [0.026, 0.012],
        [0.018, 0.03],
        [0, 0.03],
      ])
        .rotX(Math.PI / 2)
        .move(x, y, 0.04),
    );
    lamps.push(ball(0.03, { segments: 12, rings: 8 }).move(x, y, 0.092));
  }
  return { sockets: merge(...sockets).tint(BRASS), lamps: merge(...lamps) };
}

/** Багет: чуть изогнутый, сужается к концам. */
function baguette(from: V3, to: V3, bend: number): Geo {
  const mid: V3 = [(from[0] + to[0]) / 2 + bend, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2 + bend * 0.5];
  const path: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = 1 - t;
    path.push([
      a * a * from[0] + 2 * a * t * mid[0] + t * t * to[0],
      a * a * from[1] + 2 * a * t * mid[1] + t * t * to[1],
      a * a * from[2] + 2 * a * t * mid[2] + t * t * to[2],
    ]);
  }
  // Корка с косыми надрезами: по ним багет и узнаётся.
  return tube(path, 0.04, { sides: 12, scale: (t) => 0.78 + 0.22 * Math.sin(Math.PI * t) ** 0.5 }).tintBy((p) =>
    Math.sin(p[1] * 46 + p[0] * 30) > 0.72 ? '#f0d9a6' : '#d39a52',
  );
}

export const dressingRoom: StageSet = {
  name: 'Dressing room',
  floor: '#4b352d',
  build(left, right) {
    left.add(wallSlab(PLASTER, WOOD, 1.05, WOOD_DARK));
    right.add(wallSlab(PLASTER, WOOD, 1.05, WOOD_DARK));
    left.add(part(planks(1.02, WOOD, '#684a3b'), { set: true, noShadow: true }));
    right.add(part(planks(1.02, WOOD, '#684a3b'), { set: true, noShadow: true }));

    // Зеркало: висит выше заголовка главы, в свободном углу кадра.
    const mx = 0.9;
    const my = 1.66;
    left.add(part(frame(mx, my, 0.84, 0.5, 0.06, BRASS, 0.05)));
    // Стекло: без настоящего отражения его выдают два косых блика.
    left.add(
      part(
        merge(
          sheet(mx, my, 0.73, 0.39, '#aebfcc', 0, 0.012),
          sheet(mx - 0.14, my + 0.01, 0.07, 0.62, '#dbe6ee', -0.62, 0.015),
          sheet(mx - 0.03, my + 0.01, 0.025, 0.62, '#dbe6ee', -0.62, 0.015),
        ),
        { noShadow: true },
      ),
    );
    // Блики длиннее стекла — лишнее прячет рама.
    left.add(part(frame(mx, my, 0.84, 0.5, 0.06, BRASS, 0.05).move(0, 0, 0.002), { noShadow: true }));
    // Записка в углу зеркала — на ней коронная фраза.
    left.add(part(sheet(mx + 0.27, my - 0.13, 0.13, 0.1, '#f3e7a6', -0.12, 0.02), { noShadow: true }));
    mark(left, 'mirror', mx - 0.12, my + 0.03, 0.03);
    mark(left, 'note', mx + 0.27, my - 0.13, 0.03);
    const around: [number, number][] = [];
    for (let i = 0; i < 6; i++) around.push([mx - 0.35 + i * 0.14, my + 0.32]);
    for (let i = 0; i < 3; i++) {
      around.push([mx - 0.49, my + 0.15 - i * 0.15]);
      around.push([mx + 0.49, my + 0.15 - i * 0.15]);
    }
    const lights = bulbs(around);
    left.add(part(lights.sockets, { noShadow: true }));
    left.add(part(lights.lamps, { glow: BULB }));

    const sx = 0.95;

    // Полка с корзиной багетов.
    right.add(part(shelf(sx, 1.2, 0.5, 0.2, WOOD_DARK)));
    const basket = lathe(
      [
        [0, 0],
        [0.085, 0],
        [0.115, 0.15],
        [0.103, 0.15],
        [0.076, 0.014],
        [0, 0.014],
      ],
      { segments: 28, wave: (theta, _i, y) => 1 + Math.sin(theta * 14 + y * 90) * 0.022 },
    )
      .move(sx, 1.2, 0.1)
      .tint('#b08552');
    right.add(part(basket));
    const loaves = merge(
      baguette([sx - 0.03, 1.22, 0.1], [sx - 0.12, 1.62, 0.14], 0.015),
      baguette([sx + 0.02, 1.22, 0.09], [sx + 0.04, 1.68, 0.19], -0.012),
      baguette([sx + 0.03, 1.22, 0.12], [sx + 0.15, 1.58, 0.1], 0.015),
    );
    right.add(part(loaves));
    mark(right, 'bread', sx, 1.48, 0.14);

    // Низкий ящик-кофр у стены: виден только на общем плане.
    left.add(part(box(0.7, 0.42, 0.4, { bevel: 0.02 }).move(0.9, 0, 0.24).tint('#2e2a33')));
  },
};
