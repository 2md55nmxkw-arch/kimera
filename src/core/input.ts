// Указатель: где линза, зажата ли кнопка, был ли это короткий клик.
//
// Короткий клик — «потрогать» персонажа, долгое нажатие или протяжка — раздвинуть
// линзу. Поэтому линза реагирует на нажатие не сразу, а когда стало ясно, что это не клик.
import type { Pointer } from './contracts';

const TAP_MS = 240;
const TAP_SLOP = 10; // на сколько пикселей можно сдвинуться и остаться кликом
/** Через сколько миллисекунд покоя линза начинает бродить сама. */
export const IDLE_MS = 3500;

export interface Input {
  pointer: Pointer;
  /** Кнопка сейчас нажата (ещё неизвестно, клик это или зажатие). */
  readonly down: boolean;
  /** Вызывать раз в кадр: превращает затянувшееся нажатие в зажатие. */
  poll(now: number): void;
  /** Указатель давно не двигали. */
  idle(now: number): boolean;
}

/** @param onTap короткий клик: координаты окна в пикселях */
export function createInput(onTap: (clientX: number, clientY: number) => void): Input {
  const pointer: Pointer = { x: 0.62, y: 0.42, tx: 0.62, ty: 0.42, press: 0, pressTarget: 0, lastMove: -1e9 };
  const down = { active: false, at: 0, x: 0, y: 0, moved: false };

  const track = (e: PointerEvent) => {
    pointer.tx = e.clientX / innerWidth;
    pointer.ty = e.clientY / innerHeight;
    pointer.lastMove = performance.now();
  };
  addEventListener('pointermove', track, { passive: true });
  addEventListener('pointerdown', (e) => {
    track(e);
    if (e.button !== 0) return;
    down.active = true;
    down.at = performance.now();
    down.x = e.clientX;
    down.y = e.clientY;
    down.moved = false;
  });
  addEventListener(
    'pointermove',
    (e) => {
      if (down.active && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) down.moved = true;
    },
    { passive: true },
  );
  addEventListener('pointerup', (e) => {
    const wasTap = down.active && !down.moved && performance.now() - down.at < TAP_MS;
    down.active = false;
    pointer.pressTarget = 0;
    if (wasTap) onTap(e.clientX, e.clientY);
  });
  const release = () => {
    down.active = false;
    pointer.pressTarget = 0;
  };
  addEventListener('pointercancel', release);
  addEventListener('blur', release);

  return {
    pointer,
    get down() {
      return down.active;
    },
    poll(now) {
      // Нажатие стало зажатием: держат дольше клика или уже тянут.
      if (down.active && (down.moved || now - down.at > TAP_MS * 0.7)) pointer.pressTarget = 1;
    },
    idle(now) {
      return now - pointer.lastMove > IDLE_MS;
    },
  };
}
