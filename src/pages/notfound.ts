// 404: язык, крошки ластика и ссылка домой. Без скрипта страница остаётся
// читаемой по-английски — он только дорисовывает.
type Lang = 'en' | 'ru';

const COPY: Record<Lang, Record<string, string>> = {
  en: {
    title: 'This page was erased.',
    aside: 'Or nobody got round to drawing it.',
    back: '← back to the stage',
  },
  ru: {
    title: 'Эту страницу стёрли.',
    aside: 'Или до неё просто не дошли руки.',
    back: '← вернуться на сцену',
  },
};

// Тот же ключ, что у главной (content/i18n.ts): язык выбирают один раз на весь сайт.
const STORE = 'kimera:lang';
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ru';

function recall(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(STORE);
    if (isLang(stored)) return stored;
  } catch {
    /* хранилище закрыто — остаёмся на английском */
  }
  return 'en';
}

const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-lang]')];

function apply(lang: Lang): void {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) {
    el.textContent = COPY[lang][el.dataset.t ?? ''] ?? el.textContent;
  }
  for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

for (const b of buttons) {
  b.addEventListener('click', () => {
    if (!isLang(b.dataset.lang)) return;
    try {
      localStorage.setItem(STORE, b.dataset.lang);
    } catch {
      /* без хранилища язык живёт до перезагрузки */
    }
    apply(b.dataset.lang);
  });
}
apply(recall());

// Страницу 404 сервер отдаёт по любому адресу, в том числе вложенному, поэтому
// ссылки домой ведут в корень сайта, а не «на уровень выше».
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-home]')) {
  link.href = import.meta.env.BASE_URL;
}

// Крошки вдоль полосы от ластика. Расставлены по формуле, а не случайно: страница
// каждый раз выглядит одинаково.
const crumbs = document.querySelector<HTMLElement>('.crumbs');
if (crumbs) {
  const rnd = (i: number, salt: number) => {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 22; i++) {
    const along = rnd(i, 1);
    const crumb = document.createElement('i');
    // Полоса идёт через середину цифр с подъёмом вправо; крошки ложатся под её
    // нижним краем. Координаты — в долях размера цифр, как у самой полосы.
    crumb.style.setProperty('--x', (-0.08 + along * 2.1 + (rnd(i, 2) - 0.5) * 0.12).toFixed(3));
    crumb.style.setProperty('--y', (0.67 - along * 0.15 + rnd(i, 3) * 0.14).toFixed(3));
    crumb.style.setProperty('--s', (0.012 + rnd(i, 4) * 0.02).toFixed(4));
    crumb.style.setProperty('--k', (0.45 + rnd(i, 5) * 0.5).toFixed(2));
    crumb.style.setProperty('--r', `${Math.round(rnd(i, 6) * 180)}deg`);
    crumb.style.setProperty('--d', along.toFixed(2));
    crumbs.append(crumb);
  }
}
