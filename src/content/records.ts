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

// Темп: у первых четырёх — половина темпа песни по справочникам (ChordWiki, RemyWiki;
// у «Liar Dancer» — по любительской нотной записи). У остальных темп песни найти не
// удалось, стоит общий; в такт они попадают только случайно.
const GUESS = 96;

export const RECORDS: RecordItem[] = [
  record(1, '19y8YTbvri8', 'メズマライザー', 'Mesmerizer', 'サツキ', true, ['#e0418f', '#35c7c0'], 'hypno', 92.5),
  record(2, 'LLjfal8jCYI', 'オーバーライド', 'Override', '吉田夜世', false, ['#f08a24', '#201c22'], 'glitch', 102),
  record(3, 'Soy4jGPHr3g', 'テトリス', 'Tetoris', '柊マグネタイト', false, ['#d8322e', '#f3e9d2'], 'blocks', 85),
  record(4, 'UHbmkxv-874', 'ライアーダンサー', 'Liar Dancer', 'マサラダ', false, ['#6a3fb0', '#f2c230'], 'liar', 85),
  record(5, 'F38EuG2dAyM', 'イガク', 'Igaku', '原口沙輔', false, ['#eef0ee', '#2f8f6b'], 'clinic', GUESS),
  record(6, 'HTxwOxFt5d4', '人マニア', 'Hito Mania', '原口沙輔', false, ['#1f3fa8', '#f4d23c'], 'peek', GUESS),
  record(7, 'sqK-jh4TDXo', 'Machine Love', 'Machine Love', 'Jamie Paige', false, ['#c9ced6', '#e0418f'], 'robot', GUESS),
  // Запись с концерта «テトライブ2025», выложена издателем на канале «Kasane Teto - Topic».
  record(8, '7ZAbvc-uT9s', 'おちゃめ機能', 'Ochame Kinou', 'ゴジマジP', false, ['#f3b6c8', '#7a2d4a'], 'sway', GUESS),
];
