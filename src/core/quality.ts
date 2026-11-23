// Уровни качества и авто-разрешение.
//
// Сайт сам следит, успевает ли кадр. Не успевает — рисует в меньшем разрешении
// и проверяет, помогло ли: если кадр не стал короче, дело не в пикселях, и
// разрешение возвращается. Стало легче — осторожно поднимается обратно. Модули спрашивают quality.level, чтобы
// выключать дорогое (тени, отражения, лишние частицы) на слабых машинах.
//
// ?q=high | medium | low в адресе закрепляет уровень и отключает автоматику.

export type Level = 'high' | 'medium' | 'low';

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

/** Ступени: уровень и доля от полного разрешения. */
const TIERS: { level: Level; scale: number }[] = [
  { level: 'high', scale: 1 },
  { level: 'high', scale: 0.85 },
  { level: 'medium', scale: 0.72 },
  { level: 'medium', scale: 0.6 },
  { level: 'low', scale: 0.5 },
];
const MAX_DPR = 1.75; // выше картинка почти не меняется, а пикселей вдвое больше
const MIN_DPR = 0.6; // ниже рисунок разваливается
const WINDOW_MS = 1500; // оцениваем окнами такой длины…
const WINDOW_FRAMES = 20; // …но не меньше стольких кадров
const STORE = 'kimera:quality';

export interface Quality {
  readonly level: Level;
  /** Уровень не ниже названного. */
  atLeast(level: Level): boolean;
  /** Сколько пикселей буфера приходится на CSS-пиксель сейчас. */
  pixelRatio(): number;
  /**
   * Учесть длительность кадра. Вызывать раз в кадр с настоящим интервалом в мс.
   * @returns true, если разрешение сменилось и нужно пересоздать буферы
   */
  measure(ms: number, now: number): boolean;
}

const recall = (): number => {
  try {
    const n = Number(localStorage.getItem(STORE));
    return Number.isInteger(n) && n > 0 && n < TIERS.length ? n : 0;
  } catch {
    return 0; // хранилище закрыто — начинаем с лучшего
  }
};
const remember = (tier: number) => {
  try {
    localStorage.setItem(STORE, String(tier));
  } catch {
    /* без хранилища просто не запоминаем */
  }
};

/** @param pinned закреплённый уровень: автоматика выключена */
export function createQuality(pinned?: Level | null): Quality {
  const auto = !pinned;
  let tier = pinned ? TIERS.findIndex((t) => t.level === pinned) : recall();

  const last = TIERS.length - 1;
  // Интервал обновления экрана: самый короткий из недавних кадров. Считаем, что
  // экран не медленнее 50 Гц; если это не так, сработает проверка «помогло ли».
  let refresh = 16.7;
  let frames = 0;
  let slow = 0;
  let sum = 0;
  let calm = 0; // сколько окон подряд без пропусков
  let cooldown = 2; // сколько окон не трогать разрешение (сначала идёт загрузка)
  // Пробное снижение: спустились на ступень и смотрим, стал ли кадр короче.
  let probing = 0; // на сколько ступеней спустились в этой пробе
  let before = 0; // среднее время кадра до пробы
  let futileUntil = 0; // снижение не помогло — до этого времени не пробуем снова
  let futileFor = 60_000;
  // Подъём обратно: каждая неудачная попытка — заметная заминка, поэтому пробуем
  // редко и после неудачи всё реже.
  let retryAfter = 0;
  let backoff = 60_000;
  let sinceRaise = 99; // сколько окон прошло после подъёма

  return {
    get level() {
      return TIERS[tier].level;
    },
    atLeast(level) {
      return RANK[TIERS[tier].level] >= RANK[level];
    },
    pixelRatio() {
      const full = Math.min(devicePixelRatio || 1, MAX_DPR);
      return Math.max(Math.min(full, MIN_DPR), full * TIERS[tier].scale);
    },
    measure(ms, now) {
      // Скрытая вкладка и разовые провалы (переключение окон, загрузка) не в счёт.
      if (!auto || document.hidden || ms > 250 || ms <= 0) return false;
      refresh = Math.min(Math.max(Math.min(refresh * 1.0002, ms), 4), 20);
      frames++;
      sum += ms;
      if (ms > refresh * 1.6) slow++; // кадр пропустил обновление экрана
      if (sum < WINDOW_MS || frames < WINDOW_FRAMES) return false;

      const share = slow / frames;
      const average = sum / frames;
      frames = 0;
      slow = 0;
      sum = 0;
      sinceRaise++;
      if (cooldown > 0) {
        cooldown--;
        return false;
      }

      if (probing > 0) {
        if (average < before * 0.9) {
          probing = 0; // помогло — остаёмся здесь
          retryAfter = Math.max(retryAfter, now + backoff);
          remember(tier);
        } else if (probing < 2 && tier < last) {
          // Кадр привязан к обновлению экрана: небольшой выигрыш может быть не виден,
          // пока не уложимся в следующий интервал. Пробуем ещё одну ступень.
          tier++;
          probing++;
          cooldown = 1;
          return true;
        } else {
          // Не помогло: тормозит не число пикселей (процессор, медленный экран,
          // вкладку придушил браузер). Возвращаем разрешение и какое-то время не трогаем.
          tier -= probing;
          probing = 0;
          futileUntil = now + futileFor;
          futileFor = Math.min(futileFor * 2, 600_000);
          calm = 0;
          cooldown = 1;
          remember(tier);
          return true;
        }
      }

      if (share > 0.3 && tier < last && now > futileUntil) {
        // Только что подняли и сразу не тянем — это потолок машины, наверх нескоро.
        if (sinceRaise <= 3) backoff = Math.min(backoff * 2, 600_000);
        before = average;
        tier++;
        probing = 1;
        calm = 0;
        cooldown = 1;
        return true;
      }
      calm = share < 0.03 ? calm + 1 : 0;
      if (calm >= 6 && tier > 0 && now > retryAfter) {
        tier--;
        calm = 0;
        cooldown = 1;
        sinceRaise = 0;
        remember(tier);
        return true;
      }
      return false;
    },
  };
}

/** Разобрать ?q= из адреса. */
export function levelFrom(value: string | null): Level | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}
