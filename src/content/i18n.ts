// Языки страницы: английский основной, русский — переключателем в углу или ?lang=ru.
//
// Весь видимый текст страницы лежит здесь, в разметке только ключи:
//   <p data-t="ch1.text"></p>            — текст элемента
//   <button data-t-label="hud.reset">    — aria-label и подсказка
// Так страница не бывает переведена наполовину: чего нет в словаре, того нет на экране.
// Тексты фактов живут отдельно, в facts.ts, и выбираются через pick().
//
// Выбор языка помнит только браузер (localStorage), наружу он не уходит.
import type { Lang } from './facts';

export type { Lang } from './facts';

const EN = {
  'doc.title': 'KIMERA — one body, three skins',

  'ch1.word': 'Kimera',
  'ch1.lede': 'One body, three skins.',
  'ch1.head': '01 — Default',
  'ch1.text':
    'The model as it is, lit and nothing more. She began as an April Fools’ hoax in 2008 and is a chimera by design, so the two skins that follow are stitched over this same body.',
  'ch2.word': 'Mosaic',
  'ch2.head': '02 — Mosaic',
  'ch2.text':
    'A rose window cut around her head: fine shards for the figure, large ones for the glass behind. Each shard takes one colour from the point under its centre, and the ones tilted toward your cursor catch the light.',
  'ch3.word': 'Sketch',
  'ch3.head': '03 — Sketch',
  'ch3.text':
    'Pencil on paper, redrawn eight times a second. Every line is three light passes of an unsteady hand, the shadows are only hinted at, and the construction lines were never erased. The loop closes here: under the lens is the first skin again.',

  'skin.0': 'Default',
  'skin.1': 'Mosaic',
  'skin.2': 'Sketch',

  'hud.hint': 'move: peek · hold: tear · scroll: shed · marks: read',
  'hud.starting': 'starting',
  'hud.model': '{0} · VRM',
  'hud.standin': '{0} · stand-in figure',
  'hud.credit': '重音テト © 線/小山乃舞世/TWINDRILL · fan work',
  'hud.found': 'found',
  'hud.found.long': 'Labels found: {0} of {1}',
  'hud.reset': 'Forget what was found',
  'hud.reset.sure': 'forget?',
  'hud.lang': 'Language',
  'hud.tools': 'Labels, language, programme',
  'hud.programme': 'programme',

  'reach.kicker': 'curtain',
  'reach.title': 'Touch the glass. She knocks back.',
  'reach.link': 'Read the programme',
  'reach.foot': 'A fan work. Unsigned.',

  'group.profile': 'Profile',
  'group.history': 'History',
  'group.design': 'Design sheet',
  'label.pin': 'Label {0}: {1}',
  'label.source': 'Source',
  'label.close': 'Close',
  'label.list': 'Labels in this chapter',
};

export type Key = keyof typeof EN;

const RU: Record<Key, string> = {
  'doc.title': 'KIMERA — одно тело, три шкуры',

  'ch1.word': 'Kimera',
  'ch1.lede': 'Одно тело, три шкуры.',
  'ch1.head': '01 — Как есть',
  'ch1.text':
    'Модель как есть: свет и больше ничего. Она началась с первоапрельского розыгрыша 2008 года и по замыслу химера — поэтому две следующие шкуры пришиты к этому же телу.',
  'ch2.word': 'Мозаика',
  'ch2.head': '02 — Мозаика',
  'ch2.text':
    'Витражная роза, вырезанная вокруг её головы: фигура из мелких осколков, стекло за ней из крупных. Каждый осколок берёт один цвет из точки под своим центром, а те, что повёрнуты к курсору, ловят свет.',
  'ch3.word': 'Набросок',
  'ch3.head': '03 — Набросок',
  'ch3.text':
    'Карандаш по бумаге, восемь раз в секунду заново. Каждая линия — три лёгких прохода нетвёрдой руки, тени только намечены, а линии построения так и не стёрты. Здесь круг замыкается: под линзой снова первая шкура.',

  'skin.0': 'Как есть',
  'skin.1': 'Мозаика',
  'skin.2': 'Набросок',

  'hud.hint': 'веди: загляни · держи: разорви · листай: сбрось · метки: читай',
  'hud.starting': 'запуск',
  'hud.model': '{0} · VRM',
  'hud.standin': '{0} · манекен',
  'hud.credit': '重音テト © 線/小山乃舞世/TWINDRILL · фанатская работа',
  'hud.found': 'найдено',
  'hud.found.long': 'Найдено этикеток: {0} из {1}',
  'hud.reset': 'Забыть найденное',
  'hud.reset.sure': 'забыть?',
  'hud.lang': 'Язык',
  'hud.tools': 'Этикетки, язык, программка',
  'hud.programme': 'программка',

  'reach.kicker': 'занавес',
  'reach.title': 'Тронь стекло — она постучит в ответ.',
  'reach.link': 'Открыть программку',
  'reach.foot': 'Фанатская работа. Без подписи.',

  'group.profile': 'Анкета',
  'group.history': 'История',
  'group.design': 'Лист дизайнера',
  'label.pin': 'Этикетка {0}: {1}',
  'label.source': 'Источник',
  'label.close': 'Закрыть',
  'label.list': 'Этикетки этой главы',
};

const DICT: Record<Lang, Record<Key, string>> = { en: EN, ru: RU };
const STORE = 'kimera:lang';
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ru';

const recall = (): Lang | null => {
  try {
    const v = localStorage.getItem(STORE);
    return isLang(v) ? v : null;
  } catch {
    return null; // хранилище закрыто — остаёмся на английском
  }
};
const remember = (lang: Lang) => {
  try {
    localStorage.setItem(STORE, lang);
  } catch {
    /* без хранилища язык живёт до перезагрузки */
  }
};

const fromUrl = new URLSearchParams(location.search).get('lang');
let current: Lang = isLang(fromUrl) ? fromUrl : (recall() ?? 'en');
// Язык из адреса — тоже выбор посетителя: запоминаем, как и нажатие на переключатель.
if (isLang(fromUrl)) remember(fromUrl);

const listeners = new Set<(lang: Lang) => void>();
/** Элементы, которым текст задали из кода: при смене языка его надо пересобрать. */
const said = new Map<HTMLElement, () => string>();

export const lang = (): Lang => current;

/** Строка на текущем языке; {0}, {1}… заменяются аргументами. */
export function t(key: Key, ...args: (string | number)[]): string {
  return DICT[current][key].replace(/\{(\d)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

/** Значение на текущем языке из пары { en, ru } — так хранятся тексты фактов. */
export const pick = <T>(pair: Record<Lang, T>): T => pair[current];

// Японское письмо: кана, иероглифы и их знаки препинания.
const JA = /[　-ヿ㐀-鿿＀-￯]+/g;

/**
 * Записать текст в элемент. Японские куски оборачиваются в <span lang="ja">: у
 * моноширинного и рукописного шрифтов нет иероглифов, и без пометки браузер взял
 * бы для них случайный системный шрифт.
 */
export function write(el: Element, text: string): void {
  if (!JA.test(text)) {
    el.textContent = text;
    return;
  }
  JA.lastIndex = 0;
  el.textContent = '';
  let from = 0;
  for (const match of text.matchAll(JA)) {
    if (match.index > from) el.append(text.slice(from, match.index));
    const span = document.createElement('span');
    span.lang = 'ja';
    span.textContent = match[0];
    el.append(span);
    from = match.index + match[0].length;
  }
  if (from < text.length) el.append(text.slice(from));
}

/**
 * Показать в элементе строку из словаря и держать её в актуальном языке:
 * при переключении текст обновится сам.
 */
export function say(el: HTMLElement, key: Key, ...args: (string | number)[]): void {
  const make = () => t(key, ...args);
  said.set(el, make);
  write(el, make());
}

/** Заполнить всё, что размечено ключами, внутри root. */
export function applyTo(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-t]')) {
    if (said.has(el)) continue;
    const text = t(el.dataset.t as Key);
    write(el, text);
    // Крупное слово главы подгоняется под число букв (см. .word в style.css).
    if (el.classList.contains('word')) el.style.setProperty('--chars', String(text.length));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-t-label]')) {
    const text = t(el.dataset.tLabel as Key);
    el.setAttribute('aria-label', text);
    if (el.tagName === 'BUTTON') el.title = text;
  }
}

function refresh(): void {
  document.documentElement.lang = current;
  document.title = t('doc.title');
  applyTo(document);
  for (const [el, make] of said) write(el, make());
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  remember(next);
  // Если язык был задан в адресе, адрес должен говорить то же, что и страница.
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', next);
    history.replaceState(history.state, '', url);
  }
  refresh();
  for (const listener of listeners) listener(next);
}

/** Сообщать о смене языка. Возвращает функцию отписки. */
export function onLang(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Переключатель языка: кнопки с data-lang внутри root. */
export function bindLangSwitch(root: ParentNode): void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-lang]')];
  const mark = () => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.lang === current));
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      if (isLang(b.dataset.lang)) setLang(b.dataset.lang);
    });
  }
  onLang(mark);
  mark();
}

// Модуль подключается отложенным скриптом: к этому моменту разметка уже разобрана.
refresh();
