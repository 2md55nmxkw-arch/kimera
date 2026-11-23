// Контрольные кадры сцены: круг на полпути между главами и общий план каждой
// декорации (без шкур — чтобы видеть саму постройку).
import type { Shot } from '../core/capture';

const CORNER: [number, number] = [0.1, 0.86];
const WIDE = { pos: [0.4, 2.5, 6.4], target: [0, 1.25, -1.3] };

export const shots: Shot[] = [
  { name: '20-stage-turn-a', s: 0.5, pointer: CORNER, raw: 1 },
  { name: '21-stage-turn-b', s: 1.5, pointer: CORNER, raw: 1 },
  { name: '22-stage-wide-1', s: 0, pointer: CORNER, raw: 1, view: WIDE },
  { name: '23-stage-wide-2', s: 1, pointer: CORNER, raw: 1, view: WIDE },
  { name: '24-stage-wide-3', s: 2, pointer: CORNER, raw: 1, view: WIDE },
];
