// Контрольные кадры ластика: стирание на ходу, перерисовка после отпускания и
// графитовое пятно от тычка.
import type { Rig, Shot } from '../core/capture';

/** Провести зажатой линзой по лицу и плечу слева направо, потом отпустить. */
const sweep = (release: number) => (rig: Rig, f: number) => {
  const k = Math.min(1, f / 70);
  rig.pointer.tx = 0.48 + k * 0.3;
  rig.pointer.ty = 0.3 + Math.sin(k * 3) * 0.12;
  rig.pointer.pressTarget = f < release ? 1 : 0;
};

export const shots: Shot[] = [
  { name: '40-eraser-hold', s: 2, pointer: [0.48, 0.3], frames: 80, each: sweep(1000) },
  { name: '41-eraser-redraw', s: 2, pointer: [0.48, 0.3], frames: 150, each: sweep(80) },
  {
    name: '42-eraser-smudge',
    s: 2,
    pointer: [0.12, 0.84],
    frames: 60,
    each: (rig, f) => {
      if (f === 20) rig.tap(0.635, 0.36);
    },
  },
];
