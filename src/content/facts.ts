// Все факты о Тето, которые есть на сайте, — в одном месте.
//
// Сюда попадает только то, что перечислено в PLAN.md (разделы B2–B4) и сверено с
// официальным сайтом; у каждого факта стоит страница-источник. По памяти ничего
// не дописывается: если факта нет в плане, его нет и здесь.
//
// Факт сам ничего не показывает. Чтобы он появился на сцене, декорация привязывает
// его к месту в мире: labels.anchor('profile.bread', () => точка). Пока привязки
// нет, факт нигде не виден и в счётчик не входит (см. labels.ts).
//
// Японские названия остаются как в источнике; тон — короткая сухая музейная этикетка.

export type Lang = 'en' | 'ru';
export type Group = 'profile' | 'history' | 'design' | 'music';

export interface Fact {
  id: string;
  group: Group;
  /** Глава, где живёт факт: 0 — гримёрка, 1 — мастерская витражиста, 2 — стол художника. */
  chapter: 0 | 1 | 2;
  /** Дата так, как она записана в хронологии: 2008.04.01. Только у истории. */
  when?: string;
  title: Record<Lang, string>;
  /** Одно-два предложения. */
  text: Record<Lang, string>;
  /** Страница, с которой взят факт (у пластинки — адрес видео). */
  source: string;
  /** Как показать адрес источника, если сам он слишком длинный. */
  sourceText?: string;
}

const ABOUT = 'https://kasaneteto.jp/about/';
const CHRONOLOGY = 'https://kasaneteto.jp/chronology/';

type Row = [id: string, title: [en: string, ru: string], text: [en: string, ru: string], when?: string];

const group = (name: Group, chapter: Fact['chapter'], source: string, rows: Row[]): Fact[] =>
  rows.map(([id, [titleEn, titleRu], [textEn, textRu], when]) => ({
    id: `${name}.${id}`,
    group: name,
    chapter,
    ...(when ? { when } : {}),
    title: { en: titleEn, ru: titleRu },
    text: { en: textEn, ru: textRu },
    source,
  }));

// ── B2. Анкета: гримёрка ───────────────────────────────────────────────────
const PROFILE = group('profile', 0, ABOUT, [
  [
    'number',
    ['No. 0401', 'Номер 0401'],
    ['Worn on the left arm. It first read 04; after 1 April it became 0401.', 'На левой руке. Сначала был «04», после 1 апреля стал «0401».'],
  ],
  [
    'birthday',
    ['Birthday', 'День рождения'],
    ['1 April — the day she was first shown, in 2008.', '1 апреля — день, когда её впервые показали, в 2008 году.'],
  ],
  [
    'sheet',
    ['Particulars', 'Анкета'],
    ['Age: 31. Gender: chimera. Character: tsundere. Dislikes: DMC.', 'Возраст: 31. Пол: химера. Характер: цундэрэ. Не любит: DMC.'],
  ],
  ['height', ['Height', 'Рост'], ['159.5 cm, as the official profile gives it.', '159,5 см — так записано в официальном профиле.']],
  ['weight', ['Weight', 'Вес'], ['47 kg, as the official profile gives it.', '47 кг — так записано в официальном профиле.']],
  [
    'bread',
    ['French bread', 'Французский хлеб'],
    ['Entered in the profile as her favourite thing.', 'В профиле записан как любимая вещь.'],
  ],
  [
    'dvd',
    ['Rental DVDs', 'Прокат DVD'],
    ['Her skill, according to the profile: extending a DVD rental.', 'Её умение по профилю: продлевать прокат DVD.'],
  ],
  [
    'mic',
    ['Microphone', 'Микрофон'],
    ['She cannot sing; the profile says so. The motto: she will take any microphone.', 'Петь не умеет — так и записано в профиле. Девиз: возьмёт любой микрофон.'],
  ],
  ['norway', ['Norway', 'Норвегия'], ['Her favourite country.', 'Любимая страна.']],
  [
    'hair',
    ['Hair', 'Причёска'],
    ['Style: “tails like drills”. Colour: red-chestnut.', 'Причёска: «хвосты как дрели». Цвет: красно-каштановый.'],
  ],
  [
    'uniform',
    ['Uniform', 'Форма'],
    ['Clothing, in the words of the profile: “uniform (military)”.', 'Одежда, словами профиля: «форма (военная)».'],
  ],
  [
    'phrase',
    ['Catchphrase', 'Коронная фраза'],
    // Перевод — пересказ самой фразы, а не новый факт; японский текст дан как в источнике.
    ['君はじつに馬鹿だな — “You really are a fool.”', '君はじつに馬鹿だな — «Ну и дурак же ты».'],
  ],
]);

// ── B3. История в двенадцати окнах: мастерская витражиста ──────────────────
const HISTORY = group('history', 1, CHRONOLOGY, [
  [
    'proposal',
    ['First proposal', 'Первое предложение'],
    ['Proposed on the ニュー速VIP board. She was put together in 48 hours.', 'Предложена на доске «ニュー速VIP». Создана за 48 часов.'],
    '2008.03.30',
  ],
  [
    'hoax',
    ['A “new VOCALOID”', '«Новый VOCALOID»'],
    ['Shown on Nico Nico as a “new VOCALOID”. It was a joke.', 'Показана на Nico Nico как «новый VOCALOID». Это была шутка.'],
    '2008.04.01',
  ],
  ['utau', ['UTAU', 'UTAU'], ['Her first video on UTAU.', 'Первое видео на UTAU.'], '2008.04.06'],
  ['fame', ['Hall of fame', 'Зал славы'], ['Entered the “hall of fame”.', 'Попала в «зал славы».'], '2008.09.05'],
  ['twindrill', ['TWINDRILL', 'TWINDRILL'], ['The circle TWINDRILL is founded.', 'Основан кружок «Твиндрилл».'], '2009.07.01'],
  [
    'piapro',
    ['Piapro licence', 'Лицензия Piapro'],
    ['Licensed under Piapro. Commercial requests go through Crypton.', 'Лицензия Piapro. Коммерческие запросы идут через Crypton.'],
    '2010.04.01',
  ],
  ['day', ['Teto Day', 'День Тето'], ['Entered in the chronology as “Teto Day”.', 'В хронологии записан как «День Тето».'], '2011.10.10'],
  ['disc', ['Disc', 'Диск'], ['“0401 – The Best Days of 重音テト”.', '«0401 – The Best Days of 重音テト».'], '2012.10.10'],
  [
    'decade',
    ['Ten years', 'Десять лет'],
    ['Her tenth year. The trademark is registered.', 'Ей десять лет. Зарегистрирован товарный знак.'],
    '2018.04',
  ],
  [
    'synthv',
    ['Synthesizer V AI', 'Synthesizer V AI'],
    ['Synthesizer V AI 重音テト — as the chronology names it.', 'Synthesizer V AI 重音テト — так в хронологии.'],
    '2023.04.27',
  ],
  [
    'voices',
    ['Two in one year', 'Два за один год'],
    ['VOICEPEAK on 24 April, Synthesizer V 2 on 27 November.', 'VOICEPEAK — 24 апреля, Synthesizer V 2 — 27 ноября.'],
    '2025',
  ],
  [
    'eighteen',
    ['Eighteen years', 'Восемнадцать лет'],
    ['Eighteen years since the day she was shown.', 'Восемнадцать лет со дня показа.'],
    '2026.04.01',
  ],
]);

// ── B4. Лист дизайнера: стол художника ─────────────────────────────────────
// Это пометки от руки, поэтому они короче остальных: слово и две-три приметы.
const DESIGN = group('design', 2, ABOUT, [
  ['eyes', ['Eyes', 'Глаза'], ['Blood-red, oval, corners turned down.', 'Кроваво-красные, овальные, уголки вниз.']],
  ['hair', ['Hair', 'Волосы'], ['Red-chestnut. Tails “like drills”.', 'Красно-каштановые. Хвосты «как дрели».']],
  ['uniform', ['Clothes', 'Одежда'], ['“Uniform (military)”.', '«Форма (военная)».']],
  ['number', ['0401', '0401'], ['On the left arm. First 04, after 1 April 0401.', 'На левой руке. Сначала «04», после 1 апреля «0401».']],
  ['size', ['Size', 'Размеры'], ['159.5 cm, 47 kg.', '159,5 см, 47 кг.']],
  ['artist', ['Drawing', 'Рисунок'], ['線', '線']],
  ['voice', ['Voice', 'Голос'], ['小山乃舞世', '小山乃舞世']],
]);

export const FACTS: Fact[] = [...PROFILE, ...HISTORY, ...DESIGN];

const BY_ID = new Map(FACTS.map((fact) => [fact.id, fact]));

export const factById = (id: string): Fact | undefined => BY_ID.get(id);

/** Адрес источника без протокола и хвостовой черты — как он пишется на этикетке. */
export const sourceLabel = (fact: Fact): string =>
  fact.sourceText ?? fact.source.replace(/^https?:\/\//, '').replace(/\/$/, '');
