// Программка: титры, права, источники, шрифты и техника — страница на бумаге.
// Тексты лежат в programme.copy.ts, здесь только данные, одинаковые на любом языке,
// и вёрстка. Автор сайта анонимен: ни имени, ни подписи, ни контакта.
import dela from '@fontsource/dela-gothic-one/metadata.json';
import serif from '@fontsource/instrument-serif/metadata.json';
import mono from '@fontsource-variable/martian-mono/metadata.json';
import { version as vrmVersion } from '@pixiv/three-vrm/package.json';
import { REVISION } from 'three/src/constants.js';
import { programmeCopy, type Lang, type ProgrammeCopy } from './programme.copy';

// ── данные ──────────────────────────────────────────────────────────────

/** Подпись о правах — дословно, знак в знак; менять её нельзя. */
const RIGHTS_LINE = '重音テト © 線/小山乃舞世/TWINDRILL';

const LINKS = {
  official: 'https://kasaneteto.jp/',
  guideline: 'https://kasaneteto.jp/guideline/',
  about: 'https://kasaneteto.jp/about/',
  chronology: 'https://kasaneteto.jp/chronology/',
};

/** Шкуры в порядке глав. */
const SKINS = [
  { kana: '素顔', name: 'Default' },
  { kana: '硝子', name: 'Mosaic' },
  { kana: '素描', name: 'Sketch' },
];

/**
 * Шрифты. Название, автор и лицензия берутся из самих пакетов @fontsource,
 * чтобы подпись не разошлась с тем, что на самом деле лежит на сайте.
 */
const FACES = [
  { meta: dela, css: 'dela', sample: 'KIMERA キメラ' },
  { meta: serif, css: 'serif', sample: 'One body, three skins.' },
  { meta: mono, css: 'mono', sample: 'move: peek · hold: tear · scroll: shed' },
].map(({ meta, css, sample }) => {
  // «Copyright 2020 The … Project Authors (https://…)» → год и авторы.
  const [, year = '', authors = ''] = /^Copyright (\d{4}) (.+?) \(/.exec(meta.license.attribution) ?? [];
  return { family: meta.family, css, sample, year, authors, licence: meta.license.type, licenceUrl: meta.license.url };
});

// ── вёрстка ─────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ja = (s: string) => `<span lang="ja">${esc(s)}</span>`;
/** Ссылка наружу: без передачи адреса этой страницы и без доступа к её окну. */
const out = (href: string, text: string) =>
  `<a href="${href}" rel="noreferrer noopener" target="_blank">${esc(text)}<span class="host">${href.replace(/^https:\/\//, '')}</span></a>`;
const section = (n: number, id: string, title: string, body: string) => `
  <section class="part" id="${id}" aria-labelledby="${id}-title">
    <h2 id="${id}-title"><b>${String(n).padStart(2, '0')}</b>${esc(title)}</h2>
    <div class="body">${body}</div>
  </section>`;
const row = (role: string, value: string) => `<div><dt>${esc(role)}</dt><dd>${value}</dd></div>`;

function render(c: ProgrammeCopy): string {
  // Разделы по порядку — из них же собирается оглавление в шапке.
  const parts: [string, string][] = [
    ['piece', c.piece.title],
    ['bill', c.bill.title],
    ['company', c.company.title],
    ['rights', c.rights.title],
    ['sources', c.sources.title],
    ['type', c.type.title],
    ['machinery', c.machinery.title],
  ];
  const ticket = `
    <a class="ticket" href="./">
      <span class="stub">
        <b>${esc(c.ticket.admit)}</b>
        <span>${esc(c.ticket.row)} <i>04</i> · ${esc(c.ticket.seat)} <i>01</i></span>
        <span>${esc(c.ticket.price)}</span>
      </span>
      <span class="tear">${esc(c.ticket.enter)}<i aria-hidden="true">→</i></span>
    </a>`;

  return `
  <header class="head">
    <figure class="cover" role="img" aria-label="${esc(c.cover)}">
      <i class="strip strip-head"></i><i class="strip strip-torso"></i><i class="strip strip-skirt"></i>
      <svg class="seams" viewBox="0 0 400 500" aria-hidden="true">
        <path d="M-8 240.5 408 214.5" /><path class="stitch" d="M-8 240.5 408 214.5" />
        <path d="M-8 390.5 408 364.5" /><path class="stitch" d="M-8 390.5 408 364.5" />
      </svg>
    </figure>
    <p class="kana" lang="ja" aria-hidden="true">プログラム</p>
    <nav class="contents" aria-label="${esc(c.contents)}">
      <ol>${parts.map(([id, title], i) => `<li><a href="#${id}"><b>${String(i + 1).padStart(2, '0')}</b>${esc(title)}</a></li>`).join('')}</ol>
    </nav>
    <h1 class="word">${esc(c.title)}</h1>
    <p class="lede">${esc(c.lede)}</p>
    ${ticket}
  </header>

  ${section(1, 'piece', c.piece.title, c.piece.text.map((p) => `<p>${esc(p)}</p>`).join(''))}

  ${section(
    2,
    'bill',
    c.bill.title,
    `<ol class="roll acts">${SKINS.map(
      (k, i) => `
      <li><span class="act"><b>${String(i + 1).padStart(2, '0')}</b>${ja(k.kana)}<strong>${k.name}</strong></span><span class="line">${esc(c.bill.acts[i])}</span></li>`,
    ).join('')}</ol>
    <p class="aside">${esc(c.bill.note)}</p>`,
  )}

  ${section(
    3,
    'company',
    c.company.title,
    `<dl class="roll">
      ${row(c.company.character, `${ja('重音テト')} Kasane Teto`)}
      ${row(c.company.illustration, ja('線'))}
      ${row(c.company.voice, ja('小山乃舞世'))}
      ${row(c.company.model, `<a href="https://rurunerune.booth.pm/items/8000175" rel="noopener noreferrer">${ja('rurune式重音テト')}</a> <small>${esc(c.company.modelNote)}</small> ${esc(c.company.modelBy)} rurune`)}
      ${row(c.company.dance, `Motion by sir vee <small>${esc(c.company.danceNote)}</small>`)}
      ${row(c.company.staging, `<em>${esc(c.company.unsigned)}</em>`)}
    </dl>
    <p class="stamp"><small>${esc(c.company.rights)}</small>${ja(RIGHTS_LINE)}</p>`,
  )}

  ${section(
    4,
    'rights',
    c.rights.title,
    `${c.rights.text.map((p) => `<p>${esc(p)}</p>`).join('')}
    <ul class="links">
      <li>${out(LINKS.guideline, c.rights.guideline)}</li>
      <li>${out(LINKS.official, c.rights.official)}</li>
    </ul>`,
  )}

  ${section(
    5,
    'sources',
    c.sources.title,
    `<p>${esc(c.sources.text)}</p>
    <ul class="links">
      <li>${out(LINKS.about, c.sources.about)}</li>
      <li>${out(LINKS.chronology, c.sources.chronology)}</li>
    </ul>`,
  )}

  ${section(
    6,
    'type',
    c.type.title,
    `<ul class="faces">${FACES.map(
      (f, i) => `
      <li>
        <p class="specimen specimen-${f.css}" lang="en" aria-hidden="true">${esc(f.sample)}</p>
        <p class="face"><strong>${esc(f.family)}</strong><span>${esc(c.type.roles[i])}</span></p>
        <p class="licence">© ${f.year} ${esc(f.authors)}<br /><a href="${f.licenceUrl}" rel="noreferrer noopener" target="_blank">${esc(c.type.licence)}</a> <span class="spdx">(${f.licence})</span></p>
      </li>`,
    ).join('')}</ul>
    <p class="aside">${esc(c.type.note)}</p>`,
  )}

  ${section(
    7,
    'machinery',
    c.machinery.title,
    `<dl class="roll">
      ${row(c.machinery.renderer, `three.js r${REVISION} <small>MIT</small>`)}
      ${row(c.machinery.character, `@pixiv/three-vrm ${vrmVersion} <small>MIT</small>`)}
      ${row(c.machinery.graphics, esc(c.machinery.graphicsValue))}
      ${row(c.machinery.skins, esc(c.machinery.skinsValue))}
      ${row(c.machinery.privacy, esc(c.machinery.privacyValue))}
    </dl>`,
  )}

  <footer class="curtain">
    <p class="word" aria-hidden="true">${esc(c.curtain)}</p>
    ${ticket}
    <p class="fine" lang="ja">${esc(RIGHTS_LINE)}</p>
  </footer>`;
}

// ── язык ────────────────────────────────────────────────────────────────

const STORE = 'kimera:lang';
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ru';

/** Английский — основной; русский включается переключателем или ?lang=ru. */
function recall(): Lang {
  const asked = new URLSearchParams(location.search).get('lang');
  if (isLang(asked)) return asked;
  try {
    const kept = localStorage.getItem(STORE);
    if (isLang(kept)) return kept;
  } catch {
    /* хранилище закрыто — остаётся английский */
  }
  return 'en';
}

const main = document.querySelector<HTMLElement>('#programme')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.lang button')];

/**
 * Слово в шапке и слово «занавес» стоят ровно в ширину набора. Для этого нужна
 * ширина слова в кеглях — она своя у каждого языка и меняется, когда догружается шрифт.
 */
function fit() {
  for (const [selector, name] of [
    ['.head .word', '--em'],
    ['.curtain .word', '--em-end'],
  ]) {
    const word = main.querySelector<HTMLElement>(selector);
    if (!word) continue;
    const size = parseFloat(getComputedStyle(word).fontSize);
    const text = document.createRange();
    text.selectNodeContents(word);
    const width = text.getBoundingClientRect().width;
    if (size > 0 && width > 0) main.style.setProperty(name, (width / size).toFixed(3));
  }
}

function show(lang: Lang) {
  const c = programmeCopy[lang];
  document.documentElement.lang = lang;
  document.title = c.pageTitle;
  main.innerHTML = render(c);
  fit();
  document.querySelector('.lang')?.setAttribute('aria-label', c.language);
  for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

for (const b of buttons) {
  b.addEventListener('click', () => {
    const lang = b.dataset.lang;
    if (!isLang(lang)) return;
    try {
      localStorage.setItem(STORE, lang); // остаётся в браузере, никуда не уходит
    } catch {
      /* без хранилища выбор живёт до закрытия страницы */
    }
    show(lang);
  });
}

show(recall());
// Шрифт заголовка приходит позже текста: перемерить, когда он на месте.
document.fonts.addEventListener('loadingdone', fit);
void document.fonts.ready.then(fit);
