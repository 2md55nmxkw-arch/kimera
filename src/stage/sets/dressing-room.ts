// 01 · Гримёрка. Шалфейная штукатурка над тёмной деревянной панелью (зелёный
// делает рыжие волосы ярче), зеркало в
// лампочках, корзина багетов — любимая вещь Тето по официальной анкете — и
// стенд с пластинками над проигрывателем: песни, где она поёт.
import { RECORDS } from '../../content/records';
import { merge, type Geo } from '../../model/geo';
import { ball, box, lathe, rod, tube } from '../../model/solids';
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

/** Диск: тело вращения, поставленное лицом в комнату. */
const disc = (r: number, x: number, y: number, z: number, thick = 0.003): Geo =>
  lathe(
    [
      [0, 0],
      [r, 0],
      [r, thick],
      [0, thick],
    ],
    { segments: 32 },
  )
    .rotX(Math.PI / 2)
    .move(x, y, z);

/** Конверт пластинки 14×14 см с простым рисунком: полоса и круг. k — номер, от него зависит рисунок. */
function sleeve(x: number, y: number, [paper, ink]: [string, string], k: number): Geo {
  const card = box(0.14, 0.14, 0.006).move(0, -0.07, 0).tint(paper);
  const stripe = box(0.14, 0.025, 0.002).move(0, -0.056 + (k % 3) * 0.018, 0.004).tint(ink);
  const dot = disc(0.032, 0.028 - (k % 2) * 0.056, 0.02 - (k % 3) * 0.01, 0.0035, 0.002).tint(ink);
  return merge(card, stripe, dot)
    .rotZ((k % 2 ? 1 : -1) * 0.025)
    .move(x, y, 0.05);
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
    const by = 1.56;
    right.add(part(shelf(sx, by, 0.5, 0.2, WOOD_DARK)));
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
      .move(sx, by, 0.1)
      .tint('#b08552');
    right.add(part(basket));
    const loaves = merge(
      baguette([sx - 0.03, by + 0.02, 0.1], [sx - 0.12, by + 0.38, 0.14], 0.015),
      baguette([sx + 0.02, by + 0.02, 0.09], [sx + 0.04, by + 0.43, 0.19], -0.012),
      baguette([sx + 0.03, by + 0.02, 0.12], [sx + 0.15, by + 0.35, 0.1], 0.015),
    );
    right.add(part(loaves));
    mark(right, 'bread', sx, by + 0.24, 0.14);

    // Стенд с пластинками: три ряда по три. Девятое гнездо пустое — эта пластинка
    // сейчас на проигрывателе, в гнезде остался только диск.
    const cell = 0.155;
    const gx = 0.84;
    const gy = 1.335;
    right.add(part(box(0.5, 0.5, 0.02, { bevel: 0.006 }).move(gx + cell, gy - cell - 0.25, 0.03).tint(WOOD_DARK)));
    const spot = (i: number): [number, number] => [gx + (i % 3) * cell, gy - Math.floor(i / 3) * cell];
    RECORDS.forEach((record, i) => {
      const [x, y] = spot(i);
      right.add(part(sleeve(x, y, record.sleeve, i), { noShadow: true }));
      mark(right, `record-${i}`, x, y, 0.06);
    });
    if (RECORDS.length < 9) {
      const [x, y] = spot(8);
      right.add(
        part(merge(disc(0.062, x, y, 0.044, 0.003).tint('#141216'), disc(0.022, x, y, 0.0475, 0.001).tint(RECORDS[0].sleeve[0])), {
          noShadow: true,
        }),
      );
    }

    // Тумба с проигрывателем под стендом.
    const tx = 0.98;
    const top = 0.84;
    right.add(part(box(0.62, top, 0.36, { bevel: 0.012 }).move(tx, 0, 0.2).tint(WOOD_DARK)));
    right.add(part(box(0.42, 0.045, 0.3, { bevel: 0.008 }).move(tx - 0.02, top, 0.2).tint('#2a262c')));
    right.add(
      part(
        merge(
          lathe(
            [
              [0, 0],
              [0.125, 0],
              [0.125, 0.012],
              [0, 0.012],
            ],
            { segments: 36 },
          )
            .move(tx - 0.06, top + 0.045, 0.2)
            .tint('#8d8a93'),
          lathe(
            [
              [0, 0],
              [0.116, 0],
              [0.116, 0.004],
              [0, 0.004],
            ],
            { segments: 36 },
          )
            .move(tx - 0.06, top + 0.057, 0.2)
            .tint('#141216'),
          lathe(
            [
              [0, 0],
              [0.04, 0],
              [0.04, 0.0015],
              [0, 0.0015],
            ],
            { segments: 24 },
          )
            .move(tx - 0.06, top + 0.061, 0.2)
            .tint(RECORDS[0].sleeve[0]),
          // Тонарм: стойка и трубка к пластинке.
          rod([tx + 0.14, top + 0.045, 0.1], [tx + 0.14, top + 0.085, 0.1], 0.012).tint(BRASS),
          rod([tx + 0.14, top + 0.08, 0.1], [tx + 0.03, top + 0.07, 0.25], 0.005, { sides: 6 }).tint(BRASS),
        ),
      ),
    );

    // Низкий ящик-кофр у стены: виден только на общем плане.
    left.add(part(box(0.7, 0.42, 0.4, { bevel: 0.02 }).move(0.9, 0, 0.24).tint('#2e2a33')));
  },
};
