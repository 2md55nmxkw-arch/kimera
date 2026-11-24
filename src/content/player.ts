// Проигрыватель: официальное видео песни во встроенном плеере YouTube.
//
// До нажатия на «слушать» сайт к YouTube не обращается вовсе: рамка плеера создаётся
// только тогда. Адрес — youtube-nocookie.com, вариант без рекламных cookie. Закрыл
// плеер — рамка удаляется, музыка стихает, связь с YouTube обрывается.
import './player.css';

import { onLang, t, write } from './i18n';
import type { RecordItem } from './records';

export interface Player {
  play(item: RecordItem): void;
  stop(): void;
}

/** @param onChange вызывается, когда музыка включилась или выключилась */
export function createPlayer(onChange: (playing: boolean) => void): Player {
  let panel: HTMLElement | null = null;
  let current: RecordItem | null = null;

  function stop() {
    if (!panel) return;
    panel.remove(); // вместе с рамкой уходит и звук
    panel = null;
    current = null;
    onChange(false);
  }

  function labels() {
    if (!panel || !current) return;
    write(panel.querySelector('.player-title')!, current.fact.title.en);
    const close = panel.querySelector<HTMLButtonElement>('.player-close')!;
    close.setAttribute('aria-label', t('player.close'));
    close.title = t('player.close');
    panel.querySelector('.player-from')!.textContent = t('player.from');
    panel.querySelector<HTMLAnchorElement>('.player-open')!.textContent = t('player.open');
  }
  onLang(labels);

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel?.contains(document.activeElement)) stop();
  });

  return {
    stop,
    play(item) {
      stop();
      current = item;
      panel = document.createElement('aside');
      panel.className = 'player';
      panel.innerHTML = `
        <header>
          <span class="player-note" aria-hidden="true">♪</span>
          <span class="player-title"></span>
          <button class="player-close" type="button">×</button>
        </header>
        <div class="player-frame"></div>
        <p class="player-foot"><span class="player-from"></span> · <a class="player-open" target="_blank" rel="noopener noreferrer"></a></p>`;
      panel.querySelector<HTMLAnchorElement>('.player-open')!.href = item.fact.source;

      const frame = document.createElement('iframe');
      frame.title = item.fact.title.en;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      // Страница никому не сообщает, откуда пришёл посетитель, но YouTube без этого
      // отказывается играть. Плееру говорим только адрес сайта, без пути.
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = `https://www.youtube-nocookie.com/embed/${item.video}?autoplay=1&rel=0&playsinline=1`;
      panel.querySelector('.player-frame')!.append(frame);

      panel.querySelector('.player-close')!.addEventListener('click', stop);
      // Нажатия внутри плеера не должны доходить до сцены.
      for (const type of ['pointerdown', 'pointerup'] as const) panel.addEventListener(type, (e) => e.stopPropagation());
      document.body.append(panel);
      labels();
      onChange(true);
    },
  };
}
