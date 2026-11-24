// Проигрыватель: официальное видео песни во встроенном плеере YouTube.
//
// До нажатия на «слушать» сайт к YouTube не обращается вовсе: рамка плеера создаётся
// только тогда. Адрес — youtube-nocookie.com, вариант без рекламных cookie. Закрыл
// плеер — рамка удаляется, музыка стихает, связь с YouTube обрывается.
//
// Сам звук странице недоступен (плеер чужой), но плеер умеет сообщать, играет ли
// он и на какой секунде песня. По этим сообщениям Тето танцует в темпе песни и
// замирает на паузе. Если плеер молчит, считаем, что музыка играет, пока он открыт.
import './player.css';

import { onLang, t, write } from './i18n';
import type { RecordItem } from './records';

export interface Player {
  play(item: RecordItem): void;
  stop(): void;
  /** Подпись автора танца для пластинки item (null — убрать). */
  credit(item: RecordItem, text: string | null): void;
}

export interface PlayerEvents {
  /** Плеер открыли или закрыли: какая пластинка стоит (null — никакой). */
  onRecord(item: RecordItem | null): void;
  /** Музыка пошла или встала. */
  onPlaying(playing: boolean, item: RecordItem): void;
  /** На какой секунде песня сейчас. */
  onTime(seconds: number): void;
}

const YOUTUBE = 'https://www.youtube-nocookie.com';

export function createPlayer(events: PlayerEvents): Player {
  let panel: HTMLElement | null = null;
  let frame: HTMLIFrameElement | null = null;
  let current: RecordItem | null = null;
  let playing = false;
  let heard = false; // плеер прислал хоть одно сообщение
  let knock = 0;
  let giveUp = 0;
  let dance: string | null = null; // чьё движение танцует Тето под эту пластинку

  function setPlaying(next: boolean) {
    if (next === playing || !current) return;
    playing = next;
    events.onPlaying(playing, current);
  }

  function stop() {
    if (!panel) return;
    clearInterval(knock);
    clearTimeout(giveUp);
    if (current) setPlaying(false);
    panel.remove(); // вместе с рамкой уходит и звук
    panel = null;
    frame = null;
    current = null;
    events.onRecord(null);
  }

  // Сообщения плеера: строка JSON с полем info, в котором состояние и время.
  addEventListener('message', (e) => {
    if (!frame || e.origin !== YOUTUBE || e.source !== frame.contentWindow) return;
    let data: { info?: { playerState?: number; currentTime?: number } | null };
    try {
      data = JSON.parse(typeof e.data === 'string' ? e.data : '{}');
    } catch {
      return;
    }
    heard = true;
    const info = data.info;
    if (!info) return;
    // 1 — играет; всё остальное (пауза, загрузка, конец) — нет.
    if (typeof info.playerState === 'number') setPlaying(info.playerState === 1);
    if (typeof info.currentTime === 'number') events.onTime(info.currentTime);
  });

  function labels() {
    if (!panel || !current) return;
    write(panel.querySelector('.player-title')!, current.fact.title.en);
    const close = panel.querySelector<HTMLButtonElement>('.player-close')!;
    close.setAttribute('aria-label', t('player.close'));
    close.title = t('player.close');
    panel.querySelector('.player-from')!.textContent = t('player.from');
    panel.querySelector<HTMLAnchorElement>('.player-open')!.textContent = t('player.open');
    const by = panel.querySelector<HTMLElement>('.player-dance')!;
    by.hidden = !dance;
    by.textContent = dance ? `${t('player.dance')} · ${dance}` : '';
  }
  onLang(labels);

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel?.contains(document.activeElement)) stop();
  });

  return {
    stop,
    credit(item, text) {
      if (item !== current) return;
      dance = text;
      labels();
    },
    play(item) {
      stop();
      dance = null;
      current = item;
      playing = false;
      heard = false;
      panel = document.createElement('aside');
      panel.className = 'player';
      panel.innerHTML = `
        <header>
          <span class="player-note" aria-hidden="true">♪</span>
          <span class="player-title"></span>
          <button class="player-close" type="button">×</button>
        </header>
        <div class="player-frame"></div>
        <p class="player-foot"><span class="player-from"></span> · <a class="player-open" target="_blank" rel="noopener noreferrer"></a></p>
        <p class="player-foot player-dance" hidden></p>`;
      panel.querySelector<HTMLAnchorElement>('.player-open')!.href = item.fact.source;

      const box = document.createElement('iframe');
      frame = box;
      box.title = item.fact.title.en;
      box.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      // Страница никому не сообщает, откуда пришёл посетитель, но YouTube без этого
      // отказывается играть. Плееру говорим только адрес сайта, без пути.
      box.referrerPolicy = 'strict-origin-when-cross-origin';
      const query = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', enablejsapi: '1', origin: location.origin });
      box.src = `${YOUTUBE}/embed/${item.video}?${query}`;
      // Плеер начинает рассказывать о себе, только когда его об этом попросят.
      box.addEventListener('load', () => {
        const ask = () => box.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YOUTUBE);
        ask();
        knock = window.setInterval(() => (heard ? clearInterval(knock) : ask()), 500);
        // Так и не ответил — танцуем, пока плеер открыт.
        giveUp = window.setTimeout(() => {
          if (!heard) setPlaying(true);
        }, 4000);
      });
      panel.querySelector('.player-frame')!.append(box);

      panel.querySelector('.player-close')!.addEventListener('click', stop);
      // Нажатия внутри плеера не должны доходить до сцены.
      for (const type of ['pointerdown', 'pointerup'] as const) panel.addEventListener(type, (e) => e.stopPropagation());
      document.body.append(panel);
      labels();
      events.onRecord(item);
    },
  };
}
