// Потеря видеокарты: драйвер перезапустился, ноутбук проснулся, вкладку выгрузили.
// Рендер после этого мёртв, чинить его по частям ненадёжно — страница
// перезагружается сама. Чтобы не уйти в бесконечный круг, считаем потери:
//   первая за минуту      — просто перезагрузка;
//   вторая                — перезагрузка с запасным рендером WebGL 2;
//   третья                — сдаёмся и показываем страницу без графики.
import type * as THREE from 'three/webgpu';

const KEY = 'kimera:lost';
const RECENT = 60_000;

interface History {
  count: number;
  at: number;
}

const read = (): History => {
  try {
    const h = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as History | null;
    if (h && Date.now() - h.at < RECENT) return h;
  } catch {
    /* нет хранилища — считаем, что потерь не было */
  }
  return { count: 0, at: 0 };
};

/** Что делать при запуске с учётом недавних потерь. */
export function recoveryPlan(): { forceWebGL: boolean; giveUp: boolean } {
  const { count } = read();
  return { forceWebGL: count === 2, giveUp: count >= 3 };
}

/**
 * Следить за потерей устройства. three сам ловит и WebGPU device.lost, и
 * webglcontextlost и сообщает через renderer.onDeviceLost.
 * @param beforeReload спрятать картинку перед перезагрузкой
 */
export function guardDevice(renderer: THREE.WebGPURenderer, beforeReload: () => void): void {
  let handled = false;
  renderer.onDeviceLost = (info: { api: string; message: string; reason: string | null }) => {
    if (handled) return;
    handled = true;
    console.warn(`[kimera] потеряно устройство ${info.api}: ${info.message}`);
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ count: read().count + 1, at: Date.now() }));
    } catch {
      return; // без счётчика перезагружаться опасно: можно зациклиться
    }
    beforeReload();
    location.reload();
  };
}
