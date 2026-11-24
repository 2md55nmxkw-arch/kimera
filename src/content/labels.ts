// Этикетки: информация живёт на вещах.
//
// Факт привязывают к месту — к точке в мире (anchor) или на экране (anchorOnScreen).
// В первых двух главах на этом месте появляется булавка с номером; навёл, нажал или
// дошёл до неё с клавиатуры — рядом открывается музейная этикетка. В главе с
// наброском фактов-пометки написаны от руки прямо на листе, со стрелками.
// Счётчик в углу считает открытое; что найдено, помнит только этот браузер.
//
// Булавки и пометки — единственное, что здесь ловит мышь: линза, тычки и прокрутка
// работают как раньше.
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/600.css';
import './labels.css';

import * as THREE from 'three/webgpu';
import type { Frame, Part } from '../core/contracts';
import { FACTS, factById, sourceLabel, type Fact } from './facts';
import { arrow, seedOf } from './hand';
import { onLang, pick, t, write } from './i18n';
import { place, type Box } from './place';

/** Где на экране голова: центр и радиус в пикселях. Этикетка её не закрывает. */
export interface Head {
  x: number;
  y: number;
  r: number;
}

type Where = (head: Head) => { x: number; y: number } | null;

/** Примерный силуэт фигуры по голове: пометки от руки на него не ложатся. */
const figure = (h: Head): Box[] => [
  { x: h.x - h.r * 2.05, y: h.y - h.r * 1.75, w: h.r * 4.1, h: h.r * 2.9 }, // голова с хвостами
  { x: h.x - h.r * 1.75, y: h.y + h.r * 1.0, w: h.r * 3.5, h: 4000 }, // всё, что ниже
];

interface Entry {
  fact: Fact;
  where: Where;
  /** С какой стороны от точки ставить подпись: градусы, 0 — справа, 90 — сверху. */
  side: number;
  el: HTMLElement;
  /** Кнопка в этикетке (у пластинки — «слушать»). */
  action: (() => void) | null;
  /** Для пометки от руки: стрелка и то, где стоит текст. */
  path: SVGPathElement | null;
  x: number;
  y: number;
  noteX: number;
  noteY: number;
  on: boolean;
}

export interface Labels extends Part {
  /** Привязать факт к точке в мире. Функция вызывается каждый кадр; null — точки сейчас нет. */
  anchor(factId: string, at: () => THREE.Vector3 | null, side?: number): void;
  /**
   * То же для записи, которой нет среди фактов (пластинка), с кнопкой в этикетке.
   * @param action что сделать по кнопке
   */
  anchorItem(item: Fact, at: () => THREE.Vector3 | null, side: number, action: () => void): void;
  /**
   * Привязать факт к месту на экране, пиксели.
   * @param pointer рисовать ли стрелку (пометке-подписи на полях она не нужна)
   */
  anchorOnScreen(factId: string, at: Where, side?: number, pointer?: boolean): void;
}

const STORE = 'kimera:found';
const SVG = 'http://www.w3.org/2000/svg';

const recall = (): Set<string> => {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? '[]') as unknown;
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
};
const remember = (found: Set<string>) => {
  try {
    localStorage.setItem(STORE, JSON.stringify([...found]));
  } catch {
    /* без хранилища найденное живёт до перезагрузки */
  }
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: Element): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
};
const boxOf = (node: Element | null): Box | null => {
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
};

export function createLabels(camera: THREE.PerspectiveCamera, head: () => Head): Labels {
  const layer = el('div', 'labels', document.body);
  const leader = document.createElementNS(SVG, 'svg');
  leader.setAttribute('class', 'leader');
  const leaderLine = document.createElementNS(SVG, 'line');
  leader.append(leaderLine);
  layer.append(leader);

  const card = el('aside', 'card', layer);
  card.setAttribute('role', 'status');
  const cardKicker = el('p', 'card-kicker', card);
  const cardTitle = el('h3', 'card-title', card);
  const cardText = el('p', 'card-text', card);
  const cardAction = el('button', 'card-action', card);
  cardAction.type = 'button';
  cardAction.hidden = true;
  const cardSource = el('a', 'card-source', card);
  cardSource.target = '_blank';
  cardSource.rel = 'noopener noreferrer';

  // Для читалок экрана: все факты главы обычным списком.
  const list = el('ol', 'labels-list', layer);

  const counter = document.querySelector<HTMLElement>('#hud-found');
  const reset = document.querySelector<HTMLButtonElement>('#hud-reset');

  const entries: Entry[] = [];
  const found = recall();
  const narrow = matchMedia('(max-width: 640px)');
  const projected = new THREE.Vector3();

  let chapter = -1;
  let hover: Entry | null = null;
  let focus: Entry | null = null;
  let pinned: Entry | null = null;
  let open: Entry | null = null;
  let boil = -1;

  // Номер — среди своих: у фактов главы свой счёт, у пластинок свой.
  const numberOf = (entry: Entry) =>
    entries
      .filter((e) => e.fact.chapter === entry.fact.chapter && (e.fact.group === 'music') === (entry.fact.group === 'music'))
      .indexOf(entry) + 1;

  function count() {
    if (!counter) return;
    const total = entries.length;
    const have = entries.filter((e) => found.has(e.fact.id)).length;
    const text = `${String(have).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    if (counter.textContent !== text) counter.textContent = text;
    counter.title = t('hud.found.long', have, total);
    counter.hidden = total === 0;
    if (reset) reset.hidden = have === 0;
  }

  function mark(entry: Entry) {
    if (found.has(entry.fact.id)) return;
    found.add(entry.fact.id);
    entry.el.classList.add('is-found');
    remember(found);
    count();
  }

  function fill(entry: Entry) {
    const { fact } = entry;
    if (fact.group === 'design') {
      write(entry.el.querySelector('.note-title')!, pick(fact.title));
      write(entry.el.querySelector('.note-text')!, pick(fact.text));
    } else {
      entry.el.setAttribute('aria-label', t('label.pin', numberOf(entry), pick(fact.title)));
    }
  }

  function fillList() {
    list.setAttribute('aria-label', t('label.list'));
    list.textContent = '';
    for (const entry of entries) {
      if (entry.fact.chapter !== chapter) continue;
      const item = document.createElement('li');
      write(item, `${entry.fact.when ? `${entry.fact.when} — ` : ''}${pick(entry.fact.title)}. ${pick(entry.fact.text)}`);
      list.append(item);
    }
  }

  function showCard(entry: Entry | null) {
    if (entry === open) return;
    open = entry;
    card.classList.toggle('is-on', entry !== null);
    leader.classList.toggle('is-on', entry !== null && !narrow.matches);
    for (const e of entries) e.el.classList.toggle('is-open', e === entry);
    if (!entry) return;
    const { fact } = entry;
    write(cardKicker, `${t(`group.${fact.group}`)} · ${fact.when ?? String(numberOf(entry)).padStart(2, '0')}`);
    write(cardTitle, pick(fact.title));
    write(cardText, pick(fact.text));
    cardAction.hidden = !entry.action;
    if (entry.action) cardAction.textContent = t('record.play');
    cardSource.href = fact.source;
    cardSource.textContent = sourceLabel(fact);
    mark(entry);
    placeCard();
  }

  /** Поставить этикетку рядом с булавкой: не на лицо, не на текст главы, не за экран. */
  function placeCard() {
    if (!open || narrow.matches) {
      card.style.translate = '';
      return;
    }
    const h = head();
    const section = document.querySelectorAll('.copy section')[chapter];
    const hard = [boxOf(section?.querySelector('.plate') ?? null), ...[...document.querySelectorAll('.hud > *')].map(boxOf)].filter(
      (b): b is Box => b !== null,
    );
    const size = { w: card.offsetWidth, h: card.offsetHeight };
    const spot = place({
      anchor: { x: open.x, y: open.y },
      size,
      side: open.side,
      gap: 22,
      bounds: { x: 12, y: 12, w: innerWidth - 24, h: innerHeight - 24 },
      face: { x: h.x - h.r, y: h.y - h.r, w: h.r * 2, h: h.r * 2 },
      hard,
      soft: figure(h),
    });
    card.style.translate = `${Math.round(spot.x)}px ${Math.round(spot.y)}px`;
    // Выноска — от булавки к ближайшей точке этикетки.
    const cx = Math.min(Math.max(open.x, spot.x), spot.x + size.w);
    const cy = Math.min(Math.max(open.y, spot.y), spot.y + size.h);
    leaderLine.setAttribute('x1', String(open.x));
    leaderLine.setAttribute('y1', String(open.y));
    leaderLine.setAttribute('x2', String(cx));
    leaderLine.setAttribute('y2', String(cy));
  }

  /** Пометка от руки: текст сбоку от детали и стрелка к ней. */
  function placeNote(entry: Entry, seed: number) {
    const note = entry.el;
    const size = { w: note.offsetWidth, h: note.offsetHeight };
    const moved = Math.hypot(entry.x - entry.noteX, entry.y - entry.noteY) > 14;
    if (moved || !note.dataset.placed) {
      const h = head();
      const spot = place({
        anchor: { x: entry.x, y: entry.y },
        size,
        side: entry.side,
        gap: entry.path ? 46 : 0,
        bounds: { x: 12, y: 56, w: innerWidth - 24, h: innerHeight - 112 },
        face: { x: h.x - h.r, y: h.y - h.r, w: h.r * 2, h: h.r * 2 },
        hard: [
          ...figure(h),
          ...[...document.querySelectorAll('.hud > *, .tools')].map(boxOf).filter((b): b is Box => b !== null),
        ],
        soft: entries.filter((e) => e !== entry && e.on && e.el.dataset.placed).map((e) => boxOf(e.el)).filter((b): b is Box => b !== null),
      });
      note.style.translate = `${Math.round(spot.x)}px ${Math.round(spot.y)}px`;
      note.dataset.placed = `${spot.x},${spot.y}`;
      entry.noteX = entry.x;
      entry.noteY = entry.y;
    }
    if (!entry.path) return;
    const [nx, ny] = note.dataset.placed.split(',').map(Number);
    // Стрелка выходит из ближнего к детали края текста и не доходит до самой детали.
    const fromX = Math.min(Math.max(entry.x, nx), nx + size.w);
    const fromY = Math.min(Math.max(entry.y, ny), ny + size.h);
    const len = Math.hypot(entry.x - fromX, entry.y - fromY) || 1;
    const tipX = entry.x - ((entry.x - fromX) / len) * 9;
    const tipY = entry.y - ((entry.y - fromY) / len) * 9;
    entry.path.setAttribute('d', len > 24 ? arrow([fromX - nx, fromY - ny], [tipX - nx, tipY - ny], seed) : '');
  }

  const need = (factId: string): Fact => {
    const fact = factById(factId);
    if (!fact) throw new Error(`нет факта «${factId}» в content/facts.ts`);
    return fact;
  };
  /** Точка в мире → точка на экране. */
  const onScreen =
    (at: () => THREE.Vector3 | null): Where =>
    () => {
      const world = at();
      if (!world) return null;
      projected.copy(world).project(camera);
      if (projected.z > 1) return null; // точка за камерой
      return { x: ((projected.x + 1) / 2) * innerWidth, y: ((1 - projected.y) / 2) * innerHeight };
    };

  function add(fact: Fact, where: Where, side: number, pointer = true, action: (() => void) | null = null) {
    const note = fact.group === 'design';
    const node = el(note ? 'div' : 'button', note ? 'note' : 'pin', layer);
    let path: SVGPathElement | null = null;
    if (note) {
      node.tabIndex = 0;
      el('b', 'note-title', node);
      el('span', 'note-text', node);
      if (pointer) {
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'note-arrow');
        path = document.createElementNS(SVG, 'path');
        svg.append(path);
        node.append(svg);
      }
    }
    const entry: Entry = { fact, where, side, el: node, action, path, x: -1e4, y: -1e4, noteX: -1e4, noteY: -1e4, on: false };
    entries.push(entry);
    // У пластинки вместо номера нота: это не факт, а то, что можно послушать.
    if (!note) node.textContent = fact.group === 'music' ? '♪' : String(numberOf(entry));
    if (fact.group === 'music') node.classList.add('is-record');
    if (found.has(fact.id)) node.classList.add('is-found');

    const refresh = () => showCard(pinned ?? hover ?? focus);
    node.addEventListener('pointerenter', () => {
      if (note) mark(entry);
      else hover = entry;
      refresh();
    });
    node.addEventListener('pointerleave', () => {
      if (hover === entry) hover = null;
      refresh();
    });
    node.addEventListener('focus', () => {
      if (note) mark(entry);
      else focus = entry;
      refresh();
    });
    node.addEventListener('blur', () => {
      if (focus === entry) focus = null;
      refresh();
    });
    // Нажатие на булавку не должно дойти до сцены: иначе Тето получит тычок, а линза — зажатие.
    for (const type of ['pointerdown', 'pointerup'] as const) node.addEventListener(type, (e) => e.stopPropagation());
    if (!note) {
      node.addEventListener('click', () => {
        pinned = pinned === entry ? null : entry;
        refresh();
      });
    }
    fill(entry);
    count();
    if (chapter >= 0) fillList();
  }

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    pinned = null;
    hover = null;
    (document.activeElement as HTMLElement | null)?.blur();
    showCard(null);
  });
  // Нажали мимо — закреплённая этикетка закрывается.
  addEventListener('pointerdown', () => {
    if (!pinned) return;
    pinned = null;
    showCard(hover ?? focus);
  });
  for (const type of ['pointerdown', 'pointerup'] as const) card.addEventListener(type, (e) => e.stopPropagation());
  cardAction.addEventListener('click', () => {
    const run = open?.action;
    // Этикетка своё дело сделала: дальше работает то, что она запустила.
    pinned = null;
    hover = null;
    showCard(null);
    run?.();
  });
  addEventListener('resize', placeCard);

  let sure = 0;
  reset?.addEventListener('click', () => {
    // Два нажатия подряд: одно случайное не должно стирать найденное.
    if (performance.now() - sure > 4000) {
      sure = performance.now();
      reset.textContent = t('hud.reset.sure');
      return;
    }
    sure = 0;
    reset.textContent = '×';
    found.clear();
    remember(found);
    for (const entry of entries) entry.el.classList.remove('is-found');
    count();
  });

  onLang(() => {
    for (const entry of entries) {
      fill(entry);
      delete entry.el.dataset.placed;
    }
    fillList();
    count();
    const was = open;
    open = null;
    showCard(was);
  });

  return {
    anchor(factId, at, side = 0) {
      add(need(factId), onScreen(at), side);
    },
    anchorItem(item, at, side, action) {
      add(item, onScreen(at), side, true, action);
    },
    anchorOnScreen(factId, at, side = 0, pointer = true) {
      add(need(factId), at, side, pointer);
    },
    reset() {
      pinned = null;
      hover = null;
      showCard(null);
    },
    step(frame: Frame) {
      // Этикетки видны в спокойной части главы: пока линза заливает экран, им не место.
      const calm = frame.q > 0.2 && frame.q < 0.63;
      if (frame.chapter !== chapter) {
        chapter = frame.chapter;
        pinned = null;
        showCard(null);
        fillList();
      }
      const h = head();
      const step = frame.still ? 0 : Math.floor(frame.t * 8);
      const redraw = step !== boil;
      boil = step;
      let moved = false;

      for (const entry of entries) {
        const at = calm && entry.fact.chapter === chapter ? entry.where(h) : null;
        const on = at !== null && at.x > 8 && at.y > 8 && at.x < innerWidth - 8 && at.y < innerHeight - 8;
        if (on !== entry.on) {
          entry.on = on;
          entry.el.classList.toggle('is-on', on);
          if (!on && open === entry) {
            pinned = null;
            showCard(null);
          }
        }
        if (!on || !at) continue;
        const note = entry.fact.group === 'design';
        if (Math.abs(at.x - entry.x) > 0.3 || Math.abs(at.y - entry.y) > 0.3) {
          entry.x = at.x;
          entry.y = at.y;
          // Положение задаётся свойством translate, а не transform: оно применяется раньше
          // scale, и увеличение при наведении не сдвигает булавку с её места.
          if (!note) entry.el.style.translate = `${at.x.toFixed(1)}px ${at.y.toFixed(1)}px`;
          if (entry === open) moved = true;
        }
        // Пометки «кипят» вместе с рисунком: стрелка перерисовывается восемь раз в секунду.
        if (note && (redraw || !entry.el.dataset.placed)) placeNote(entry, seedOf(entry.fact.id) + step);
      }
      if (moved) placeCard();
    },
  };
}

/** Сколько фактов всего заведено в данных — для проверки, что ничего не потерялось. */
export const FACT_COUNT = FACTS.length;
