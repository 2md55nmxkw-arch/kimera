// 03 · Стол художника. Светлая стена (на ней набросок не штрихует лишнего), полка с
// гипсовыми телами — их рисуют в любой художественной школе — подрамник
// и деревянный манекен.
import { merge, type Geo } from '../../model/geo';
import { ball, box, lathe, rod } from '../../model/solids';
import type { V3 } from '../../model/vec';
import { part, type StageSet } from '../kit';
import { frame, sheet, shelf, wallSlab } from './shared';

const WALL_TONE = '#ece6d9';
const WALL_LOW = '#e0d8c9';
const TRIM = '#cfc6b3';
const WOOD = '#b3936c';
const PLASTER = '#f5f2eb';

/** Шарнирный манекен ростом около 34 см на подставке. */
function mannequin(x: number, y: number, z: number): Geo {
  const j = (p: V3, r = 0.011): Geo => ball(r, { segments: 10, rings: 6 }).move(p[0], p[1], p[2]);
  const limb = (a: V3, b: V3, r = 0.009): Geo => rod(a, b, r, { sides: 8 });
  const hipL: V3 = [-0.02, 0.15, 0];
  const hipR: V3 = [0.02, 0.15, 0];
  const kneeL: V3 = [-0.024, 0.085, 0.012];
  const kneeR: V3 = [0.026, 0.088, -0.006];
  const shL: V3 = [-0.042, 0.268, 0];
  const shR: V3 = [0.042, 0.268, 0];
  const elL: V3 = [-0.074, 0.225, 0.012];
  const elR: V3 = [0.08, 0.3, 0.02];
  return merge(
    lathe([
      [0, 0],
      [0.06, 0],
      [0.06, 0.012],
      [0, 0.012],
    ]),
    limb([0, 0.012, -0.03], [0, 0.15, -0.012], 0.005),
    ball(0.024, { segments: 12, rings: 8, squash: [1.1, 0.9, 0.85] }).move(0, 0.152, 0),
    ball(0.03, { segments: 12, rings: 8, squash: [0.95, 1.35, 0.8] }).move(0, 0.2, 0),
    ball(0.036, { segments: 12, rings: 8, squash: [1.12, 1.05, 0.82] }).move(0, 0.25, 0),
    limb([0, 0.275, 0], [0, 0.295, 0], 0.008),
    ball(0.025, { segments: 14, rings: 10, squash: [0.9, 1.18, 0.95] }).move(0, 0.323, 0),
    limb(hipL, kneeL, 0.011),
    limb(kneeL, [-0.024, 0.022, 0.004], 0.009),
    limb(hipR, kneeR, 0.011),
    limb(kneeR, [0.03, 0.022, 0.0], 0.009),
    j(kneeL),
    j(kneeR),
    limb(shL, elL),
    limb(elL, [-0.07, 0.175, 0.03], 0.008),
    limb(shR, elR),
    limb(elR, [0.062, 0.345, 0.03], 0.008),
    j(shL),
    j(shR),
    j(elL, 0.01),
    j(elR, 0.01),
  )
    .move(x, y, z)
    .tint('#c9a06c');
}

export const drawingDesk: StageSet = {
  name: 'Drawing desk',
  floor: '#cdbfa6',
  build(left, right) {
    left.add(wallSlab(WALL_TONE, WALL_LOW, 0.95, TRIM));
    right.add(wallSlab(WALL_TONE, WALL_LOW, 0.95, TRIM));

    // Полка с гипсами — в свободном верхнем углу кадра.
    const sy = 1.62;
    left.add(part(shelf(0.7, sy, 1.02, 0.24, WOOD)));
    const solids = merge(
      box(0.2, 0.2, 0.2, { bevel: 0.004 }).rotY(0.5).move(0.34, sy, 0.12),
      lathe(
        [
          [0, 0],
          [0.11, 0],
          [0, 0.31],
        ],
        { segments: 32 },
      ).move(0.6, sy, 0.12),
      ball(0.115, { segments: 28, rings: 18 }).move(0.84, sy + 0.115, 0.12),
      lathe(
        [
          [0, 0],
          [0.082, 0],
          [0.082, 0.26],
          [0, 0.26],
        ],
        { segments: 28 },
      ).move(1.07, sy, 0.12),
    ).tint(PLASTER);
    left.add(part(solids));

    // Справа: манекен на полочке и подрамник с холстом.
    right.add(part(shelf(0.95, 1.18, 0.42, 0.18, WOOD)));
    right.add(part(mannequin(0.95, 1.18, 0.09)));
    right.add(part(frame(0.98, 1.78, 0.4, 0.3, 0.032, '#a07c52', 0.035)));
    right.add(part(sheet(0.98, 1.78, 0.34, 0.24, '#f3eee2', 0, 0.01), { noShadow: true }));

    // Мольберт-тренога у стены: виден на общем плане.
    left.add(
      part(
        merge(
          rod([1.0, 0, 0.5], [1.12, 1.5, 0.2], 0.014),
          rod([1.45, 0, 0.5], [1.3, 1.5, 0.2], 0.014),
          rod([1.22, 0, 0.12], [1.21, 1.5, 0.2], 0.014),
          box(0.52, 0.03, 0.05, { bevel: 0.005 }).move(1.22, 0.62, 0.36),
        ).tint(WOOD),
      ),
    );
  },
};
