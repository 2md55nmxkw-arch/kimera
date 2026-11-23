// Память о посетителе: гладили её или доводили и который это визит.
//
// Живёт только в localStorage этого браузера и никуда не отправляется. Хранится
// три числа: счётчик визитов, «тепло» (плюс за поглаживания, минус за обиды) и
// время последнего визита — чтобы перезагрузка страницы не считалась новым приходом.
// Хранилище может быть закрыто (приватный режим, настройки) — тогда она просто
// каждый раз знакомится заново.
//
// Отношение (standing) решается один раз при загрузке по прошлым визитам и за
// время визита не меняется: поздороваться можно только в начале.

const STORE = 'kimera:memory';
/** Через сколько миллисекунд отсутствия приход считается новым визитом. */
const VISIT_GAP = 30 * 60_000;
/** За каждый новый визит прошлое наполовину забывается: и обиды, и ласка. */
const FADE = 0.5;
const LIMIT = 12;
/** С какого «тепла» она рада гостю и с какого — настороже. */
const KIND_FROM = 3;
const WARY_FROM = -3;

/** Событие визита: погладили по макушке; догладили до радости; довели до обиды. */
export type Deed = 'pat' | 'joy' | 'sulk';
// Одна обида весит как шесть поглаживаний: довести надо постараться (четыре тычка
// в лицо подряд), и забывается это не сразу. Три поглаживания подряд дают радость —
// вместе это 3 + 3 = 6, ровно одна обида.
const WORTH: Record<Deed, number> = { pat: 1, joy: 3, sulk: -6 };

/** new — первый раз; neutral — знакомы, но ни тепло ни холодно. */
export type Standing = 'new' | 'neutral' | 'kind' | 'wary';

export interface Memory {
  /** Который это визит; первый — 1. */
  readonly visits: number;
  /** Как она относится к гостю по прошлым визитам. */
  readonly standing: Standing;
  /** «Тепло» сейчас, с учётом этого визита: −12…12. */
  readonly warmth: number;
  /** Записать событие этого визита. */
  note(deed: Deed): void;
  /** Забыть всё. */
  forget(): void;
}

interface Stored {
  visits: number;
  warmth: number;
  last: number;
}

function read(): Stored | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Stored> | null;
    if (!raw || typeof raw !== 'object') return null;
    const { visits, warmth, last } = raw;
    if (!Number.isFinite(visits) || !Number.isFinite(warmth) || !Number.isFinite(last)) return null;
    return {
      visits: Math.max(1, Math.floor(visits as number)),
      warmth: Math.min(LIMIT, Math.max(-LIMIT, warmth as number)),
      last: last as number,
    };
  } catch {
    return null; // хранилище закрыто или в нём мусор — знакомимся заново
  }
}

function write(data: Stored): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch {
    /* без хранилища просто не запоминаем */
  }
}

/** Прочитать память и отметить визит. Вызывается один раз при загрузке, не в шаге симуляции. */
export function createMemory(): Memory {
  const now = Date.now();
  const stored = read();
  const data: Stored = stored ?? { visits: 1, warmth: 0, last: now };
  // Отношение — по тому, что было до этой загрузки. Перезагрузка сразу после обиды
  // визитом не считается, но обиду она помнит.
  const standing: Standing = !stored ? 'new' : data.warmth >= KIND_FROM ? 'kind' : data.warmth <= WARY_FROM ? 'wary' : 'neutral';
  if (stored && now - stored.last > VISIT_GAP) {
    data.visits++;
    data.warmth *= FADE;
  }
  data.last = now;
  write(data);

  return {
    get visits() {
      return data.visits;
    },
    standing,
    get warmth() {
      return data.warmth;
    },
    note(deed) {
      data.warmth = Math.min(LIMIT, Math.max(-LIMIT, data.warmth + WORTH[deed]));
      data.last = Date.now();
      write(data);
    },
    forget() {
      data.visits = 1;
      data.warmth = 0;
      try {
        localStorage.removeItem(STORE);
      } catch {
        /* нечего забывать */
      }
    },
  };
}
