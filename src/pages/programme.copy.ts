// Тексты программки: по одному простому объекту на язык, без вёрстки и без логики.
// Так их можно целиком перенести в общий модуль переводов сайта, когда он появится.
//
// Здесь только то, что переводится. Имена, подпись о правах, адреса и сведения о
// шрифтах — в programme.ts: это данные, они одинаковы на любом языке.
//
// Факты о Тето — только из PLAN.md (B2–B4), они сверены с официальным сайтом.
// Автор сайта анонимен: ни имени, ни подписи, ни контакта здесь быть не должно.

export type Lang = 'en' | 'ru';

export interface ProgrammeCopy {
  /** Заголовок вкладки. */
  pageTitle: string;
  title: string;
  lede: string;
  /** Что на обложке — для читалок экрана. */
  cover: string;
  /** Подпись переключателя языка для читалок экрана. */
  language: string;
  /** Подпись оглавления для читалок экрана. */
  contents: string;
  /** Билет — он же ссылка на главную. */
  ticket: { admit: string; row: string; seat: string; price: string; enter: string };
  piece: { title: string; text: string[] };
  bill: { title: string; note: string; acts: string[] };
  company: {
    title: string;
    character: string;
    illustration: string;
    voice: string;
    model: string;
    modelNote: string;
    modelBy: string;
    dance: string;
    danceNote: string;
    rights: string;
    staging: string;
    unsigned: string;
  };
  rights: { title: string; text: string[]; guideline: string; official: string };
  sources: { title: string; text: string; about: string; chronology: string };
  type: { title: string; note: string; roles: [string, string, string]; licence: string };
  machinery: {
    title: string;
    renderer: string;
    character: string;
    graphics: string;
    graphicsValue: string;
    skins: string;
    skinsValue: string;
    privacy: string;
    privacyValue: string;
  };
  /** Последняя строка, как «занавес» в конце программки. */
  curtain: string;
}

export const programmeCopy: Record<Lang, ProgrammeCopy> = {
  en: {
    pageTitle: 'Programme — KIMERA',
    title: 'Programme',
    lede: 'A pocket theatre for one chimera.',
    cover: 'Kasane Teto, one pose in three skins: the head as modelled, the torso in stained glass, the skirt in pencil.',
    language: 'Language',
    contents: 'Contents',
    ticket: { admit: 'Admit one', row: 'Row', seat: 'Seat', price: 'Free', enter: 'To the stage' },
    piece: {
      title: 'The piece',
      text: [
        'KIMERA is a pocket theatre with a cast of one: Kasane Teto, a single 3-D figure shown three ways at once.',
        'Each chapter dresses her in another skin — as she is, in stained glass, in pencil — and the lens under your cursor stitches the next one over the same body.',
        'In her official profile the entry for sex reads “chimera”; the piece takes the word literally.',
      ],
    },
    bill: {
      title: 'In order of appearance',
      note: 'On the cover: one pose, photographed three times and stitched back into one body.',
      acts: [
        'The model as it is, lit and nothing more.',
        'A rose window: every shard takes a single colour.',
        'Pencil on paper, redrawn eight times a second.',
      ],
    },
    company: {
      title: 'Company',
      character: 'Character',
      illustration: 'Illustration',
      voice: 'Voice',
      model: '3-D model',
      modelNote: 'free VRM',
      modelBy: 'by',
      dance: 'Dance',
      danceNote: 'for Mesmerizer',
      rights: 'Rights',
      staging: 'Staging',
      unsigned: 'unsigned',
    },
    rights: {
      title: 'Rights',
      text: [
        'This is a non-commercial fan work. Nothing here is sold, and nothing here is advertised.',
        'It is made to follow the official character guideline. It is not affiliated with the rights holders, and they have not endorsed it.',
      ],
      guideline: 'Character guideline',
      official: 'Official site',
    },
    sources: {
      title: 'Sources',
      text: 'Every fact about the character on this site was taken from her official site, and from nowhere else.',
      about: 'Profile and origin',
      chronology: 'Chronology',
    },
    type: {
      title: 'Type',
      note: 'All three typefaces are served from this site; nothing is fetched from a font service.',
      roles: ['Titles', 'Asides', 'Labels'],
      licence: 'SIL Open Font License 1.1',
    },
    machinery: {
      title: 'Machinery',
      renderer: 'Renderer',
      character: 'Character runtime',
      graphics: 'Graphics',
      graphicsValue: 'WebGPU, with a WebGL 2 fallback',
      skins: 'Skins',
      skinsValue: 'three shaders over one render of the scene',
      privacy: 'Front of house',
      privacyValue: 'no analytics, no cookies; nothing is asked of other sites until you play a record — the video then comes from YouTube',
    },
    curtain: 'Curtain',
  },

  ru: {
    pageTitle: 'Программка — KIMERA',
    title: 'Программка',
    lede: 'Карманный театр одной химеры.',
    cover: 'Касане Тето, одна поза в трёх шкурах: голова как есть, торс витражом, юбка карандашом.',
    language: 'Язык',
    contents: 'Содержание',
    ticket: { admit: 'На одно лицо', row: 'Ряд', seat: 'Место', price: 'Бесплатно', enter: 'На сцену' },
    piece: {
      title: 'О пьесе',
      text: [
        'KIMERA — карманный театр с труппой из одной актрисы: Касане Тето, одна трёхмерная фигура, показанная тремя способами сразу.',
        'В каждой главе на ней другая шкура — как есть, витраж, карандаш, — а линза под курсором пришивает следующую к тому же телу.',
        'В её официальном профиле в графе «пол» написано «химера»; здесь это слово понято буквально.',
      ],
    },
    bill: {
      title: 'В порядке появления',
      note: 'На обложке — одна поза, снятая трижды и сшитая обратно в одно тело.',
      acts: [
        'Модель как есть: свет и больше ничего.',
        'Витражная роза: у каждого осколка один цвет.',
        'Карандаш на бумаге, перерисованный восемь раз в секунду.',
      ],
    },
    company: {
      title: 'Труппа',
      character: 'Персонаж',
      illustration: 'Рисунок',
      voice: 'Голос',
      model: '3D-модель',
      modelNote: 'бесплатная VRM',
      modelBy: 'автор —',
      dance: 'Танец',
      danceNote: 'под Mesmerizer',
      rights: 'Права',
      staging: 'Постановка',
      unsigned: 'без подписи',
    },
    rights: {
      title: 'Права',
      text: [
        'Это некоммерческая фанатская работа. Здесь ничего не продаётся и ничего не рекламируется.',
        'Она сделана по официальным правилам использования персонажа. С правообладателями она не связана и ими не одобрена.',
      ],
      guideline: 'Правила использования персонажа',
      official: 'Официальный сайт',
    },
    sources: {
      title: 'Источники',
      text: 'Все факты о персонаже на этом сайте взяты с её официального сайта — и больше ниоткуда.',
      about: 'Профиль и происхождение',
      chronology: 'Хронология',
    },
    type: {
      title: 'Шрифты',
      note: 'Все три шрифта лежат на этом сайте; к сервисам шрифтов он не обращается.',
      roles: ['Заголовки', 'Реплики', 'Этикетки'],
      licence: 'SIL Open Font License 1.1',
    },
    machinery: {
      title: 'Машинерия',
      renderer: 'Рендер',
      character: 'Персонаж в браузере',
      graphics: 'Графика',
      graphicsValue: 'WebGPU, запасной вариант — WebGL 2',
      skins: 'Шкуры',
      skinsValue: 'три шейдера поверх одного рендера сцены',
      privacy: 'Фойе',
      privacyValue: 'без аналитики и cookie; к другим сайтам страница не обращается, пока не поставишь пластинку — тогда видео приходит с YouTube',
    },
    curtain: 'Занавес',
  },
};
