// 02 · Мастерская витражиста. Каменная стена со стрельчатым окном, подвесной
// фонарь и напольный подсвечник. В мозаике стены становятся стеклом розы, а
// предметы — мелкими осколками поверх неё; под линзой всё это рисуется карандашом.
import { merge, type Geo } from '../../model/geo';
import { ball, box, lathe, plate, rod, torus } from '../../model/solids';
import { part, type StageSet } from '../kit';
import { sheet, wallSlab } from './shared';

const STONE = '#8f89a0';
const STONE_LOW = '#756f86';
const STONE_TRIM = '#5f596f';
const IRON = '#2b2933';
const FLAME = '#ffd56a';

/** Стрельчатая арка шириной w: прямые стороны до высоты h, выше — две дуги радиусом w. */
function pointedArch(w: number, h: number, lift = 0, steps = 8): [number, number][] {
  const out: [number, number][] = [
    [-w / 2, lift],
    [w / 2, lift],
  ];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 3);
    out.push([-w / 2 + w * Math.cos(a), lift + h + w * Math.sin(a)]);
  }
  for (let i = 1; i <= steps; i++) {
    const a = (Math.PI * 2) / 3 + (i / steps) * (Math.PI / 3);
    out.push([w / 2 + w * Math.cos(a), lift + h + w * Math.sin(a)]);
  }
  return out;
}

const candle = (x: number, y: number, z: number, h: number): Geo =>
  lathe([
    [0, 0],
    [0.019, 0],
    [0.019, h],
    [0.006, h + 0.004],
    [0, h + 0.004],
  ]).move(x, y, z);

const flame = (x: number, y: number, z: number): Geo =>
  ball(0.02, { segments: 10, rings: 8, squash: [0.75, 1.9, 0.75] }).move(x, y + 0.045, z);

export const glassAtelier: StageSet = {
  name: 'Glass atelier',
  floor: '#565068',
  build(left, right) {
    left.add(wallSlab(STONE, STONE_LOW, 0.9, STONE_TRIM));
    right.add(wallSlab(STONE, STONE_LOW, 0.9, STONE_TRIM));

    // Окно: каменный наличник со стрельчатым проёмом, в проёме — цветные стёкла.
    const wx = 0.7;
    const wy = 0.7;
    const casing = plate(pointedArch(0.74, 0.92), 0.07, { holes: [pointedArch(0.56, 0.88, 0.09)], bevel: 0.012 })
      .move(wx, wy, 0)
      .tint(STONE_TRIM);
    const mullion = box(0.03, 1.12, 0.045, { bevel: 0.006 }).move(wx, wy + 0.09, 0.0225).tint(STONE_TRIM);
    const sill = box(0.86, 0.045, 0.11, { bevel: 0.01 }).move(wx, wy - 0.02, 0.055).tint(STONE_TRIM);
    left.add(part(merge(casing, mullion, sill), { set: true }));
    const panes: Geo[] = [];
    const colours = ['#b01e3c', '#1d409c', '#e09a22', '#0f7a5c', '#5a3192', '#14808c'];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 2; col++) {
        panes.push(sheet(wx - 0.14 + col * 0.28, wy + 0.22 + row * 0.24, 0.25, 0.22, colours[(row * 2 + col * 3) % 6], 0, 0.008));
      }
    }
    panes.push(sheet(wx, wy + 1.26, 0.3, 0.3, '#f2b53a', Math.PI / 4, 0.008));
    left.add(part(merge(...panes), { set: true, noShadow: true }));

    // Фонарь на цепи в левом верхнем углу кадра.
    const lx = 0.2;
    const lantern = merge(
      rod([lx, 2.8, 0.22], [lx, 2.08, 0.22], 0.006, { sides: 6 }),
      torus(0.02, 0.005, { segments: 12, sides: 6 }).rotX(Math.PI / 2).move(lx, 2.07, 0.22),
      lathe([
        [0, 0],
        [0.05, 0.005],
        [0.075, 0.03],
        [0.02, 0.07],
        [0, 0.07],
      ]).move(lx, 1.98, 0.22),
      lathe([
        [0, 0],
        [0.03, 0],
        [0.07, 0.03],
        [0.07, 0.04],
        [0, 0.04],
      ]).move(lx, 1.74, 0.22),
      ...[0, 1, 2, 3].map((k) => {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const x = lx + Math.cos(a) * 0.062;
        const z = 0.22 + Math.sin(a) * 0.062;
        return rod([x, 1.78, z], [x, 1.985, z], 0.005, { sides: 6 });
      }),
    ).tint(IRON);
    left.add(part(lantern));
    left.add(
      part(
        lathe([
          [0, 0],
          [0.05, 0],
          [0.055, 0.1],
          [0.05, 0.2],
          [0, 0.2],
        ]).move(lx, 1.78, 0.22),
        { glow: '#ffb84d' },
      ),
    );

    // Напольный подсвечник на три свечи.
    const cx = 0.95;
    const cz = 0.3;
    const stand = merge(
      lathe([
        [0, 0],
        [0.15, 0],
        [0.15, 0.02],
        [0.05, 0.06],
        [0.02, 0.1],
        [0.02, 0.6],
        [0.035, 0.63],
        [0.02, 0.66],
        [0.02, 1.2],
        [0.035, 1.23],
        [0.02, 1.26],
        [0.02, 1.52],
        [0, 1.52],
      ]).move(cx, 0, cz),
      rod([cx - 0.17, 1.5, cz], [cx + 0.17, 1.5, cz], 0.012),
      ...[-0.17, 0, 0.17].map((dx) =>
        lathe([
          [0, 0],
          [0.012, 0],
          [0.04, 0.03],
          [0.04, 0.04],
          [0, 0.04],
        ]).move(cx + dx, dx === 0 ? 1.52 : 1.5, cz),
      ),
    ).tint(IRON);
    right.add(part(stand));
    const tops: [number, number][] = [
      [-0.17, 0.2],
      [0, 0.3],
      [0.17, 0.16],
    ];
    right.add(
      part(merge(...tops.map(([dx, h]) => candle(cx + dx, (dx === 0 ? 1.56 : 1.54), cz, h))).tint('#efe6d2')),
    );
    right.add(
      part(merge(...tops.map(([dx, h]) => flame(cx + dx, (dx === 0 ? 1.56 : 1.54) + h, cz))), { glow: FLAME }),
    );
  },
};
