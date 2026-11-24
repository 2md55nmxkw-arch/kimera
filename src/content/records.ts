// Пластинки в гримёрке: песни, где поёт Тето.
//
// Самих песен на сайте нет и быть не может — они принадлежат авторам. Пластинка
// открывает официальное видео автора во встроенном плеере YouTube, и только после
// нажатия: до него сайт к YouTube не обращается (см. content/player.ts).
//
// Каждая запись сверена с YouTube (служба oEmbed, 2026-11-24): название и канал
// взяты оттуда дословно, встраивание автором разрешено. Добавляя пластинку,
// проверь её так же: https://www.youtube.com/oembed?url=<адрес видео>&format=json
import type { DanceName } from '../actor/dance';
import type { MotionClip, MotionInfo } from '../actor/motion';
import type { ShowInfo } from '../fx/show';
import type { Fact } from './facts';

export interface RecordItem {
  /** Номер видео на YouTube. */
  video: string;
  /** Два цвета конверта: фон и рисунок. */
  sleeve: [string, string];
  /** Какой танец Тето танцует под эту песню (actor/dance.ts). */
  dance: DanceName;
  /**
   * Темп танца, движений в минуту. У быстрых песен это половина темпа самой песни:
   * танцевать на каждую долю при 185 ударах в минуту было бы суетой.
   */
  tempo: number;
  /**
   * Танец из файла (actor/motion.ts), если для песни есть готовое движение. Файла на
   * месте может и не быть — он не коммитится, — тогда идёт свой танец.
   */
  motion?: MotionInfo;
  /** Шоу на сцене, пока играет пластинка (fx/show.ts). Есть не у всех. */
  show?: ShowInfo;
  /** То, что показывает этикетка. */
  fact: Fact;
}

const record = (
  n: number,
  video: string,
  title: string,
  latin: string,
  by: string,
  duet: boolean,
  sleeve: [string, string],
  dance: DanceName,
  tempo: number,
): RecordItem => ({
  video,
  sleeve,
  dance,
  tempo,
  fact: {
    id: `music.${n}`,
    group: 'music',
    chapter: 0,
    title: { en: title, ru: title },
    text: {
      en: `${latin}. By ${by}. ${duet ? 'Sung by Hatsune Miku and Kasane Teto.' : 'Sung by Kasane Teto.'}`,
      ru: `${latin}. Автор — ${by}. ${duet ? 'Поют Хацунэ Мику и Касане Тето.' : 'Поёт Касане Тето.'}`,
    },
    source: `https://www.youtube.com/watch?v=${video}`,
    sourceText: 'youtube.com',
  },
});

// Темп — половина темпа песни. Откуда темп песни:
//   Mesmerizer 185, Igaku 170, Hito Mania 150 — RemyWiki (справочник ритм-игр,
//     там темп берут из самих игр);
//   Override 204, Tetoris 170, Ochame Kinou 150 — ChordWiki; у концертной записи
//     Ochame Kinou сервис SongBPM показывает те же 150;
//   Liar Dancer 170 — любительская нотная запись;
//   Machine Love 175 — Tunebat, Musicstax, SongBPM (машинный разбор записи).
// С какой секунды видео начинается первый такт, не знаем: темп совпадает, сильная
// доля — как повезёт.

// Mesmerizer: движение для MMD «Teto Mesmerizer Motion by sir vee» (условия автора:
// подписывать, файл не раздавать; дорожку собирает scripts/motion.mjs).
//
// Движение сделано под первые 24 секунды песни, для двоих: Мику танцует первые
// восемь тактов, Тето в это время стоит заворожённая, потом они меняются. У нас
// Тето одна, а в клипе в начале танцуют обе, поэтому её очередь сдвинута на начало:
// танец — с удара после паузы, как у Мику в файле. Дальше, до конца песни, те же
// восемь тактов «стоит» и восемь «танцует» идут по кругу.
//
// Откуда числа: звук в архиве с движением — это начало песни (обрыв звука на 1.19 с
// совпадает со сменой чёрного экрана на вспышку в клипе), бит вступает на 1.43 с,
// темп по звуку — 185. Танец Тето в файле позже танца Мику на 313 кадров.
function mesmerizer(): MotionClip[] {
  const drop = 1.43;
  const block = (32 * 60) / 185;
  const turn = 313 / 30;
  const clips: MotionClip[] = [{ at: 0, file: 0, fade: 0 }]; // вступительная поза
  for (let k = 0; drop + k * block < 170; k++) {
    const at = drop + k * block;
    clips.push(
      k % 2 === 0
        ? { at, file: drop + turn, fade: k ? 0.25 : 0.4 } // танцует
        : { at, file: drop, min: 2.2, fade: 0.5, hold: 0.65 }, // стоит: сначала доигрывает последнюю позу
    );
  }
  return clips;
}

export const RECORDS: RecordItem[] = [
  {
    ...record(1, '19y8YTbvri8', 'メズマライザー', 'Mesmerizer', 'サツキ', true, ['#e0418f', '#35c7c0'], 'hypno', 92.5),
    motion: { url: '/motions/mesmerizer.kmt', clips: mesmerizer() },
    show: { kind: 'hypno', colors: ['#e0418f', '#35c7c0'], bpm: 185, drop: 1.43 },
  },
  record(2, 'LLjfal8jCYI', 'オーバーライド', 'Override', '吉田夜世', false, ['#f08a24', '#201c22'], 'glitch', 102),
  record(3, 'Soy4jGPHr3g', 'テトリス', 'Tetoris', '柊マグネタイト', false, ['#d8322e', '#f3e9d2'], 'blocks', 85),
  record(4, 'UHbmkxv-874', 'ライアーダンサー', 'Liar Dancer', 'マサラダ', false, ['#6a3fb0', '#f2c230'], 'liar', 85),
  record(5, 'F38EuG2dAyM', 'イガク', 'Igaku', '原口沙輔', false, ['#eef0ee', '#2f8f6b'], 'clinic', 85),
  record(6, 'HTxwOxFt5d4', '人マニア', 'Hito Mania', '原口沙輔', false, ['#1f3fa8', '#f4d23c'], 'peek', 75),
  record(7, 'sqK-jh4TDXo', 'Machine Love', 'Machine Love', 'Jamie Paige', false, ['#c9ced6', '#e0418f'], 'robot', 87.5),
  // Запись с концерта «テトライブ2025», выложена издателем на канале «Kasane Teto - Topic».
  record(8, '7ZAbvc-uT9s', 'おちゃめ機能', 'Ochame Kinou', 'ゴジマジP', false, ['#f3b6c8', '#7a2d4a'], 'sway', 75),
];
