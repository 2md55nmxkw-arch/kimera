// Пластинки в гримёрке: песни, где поёт Тето.
//
// Самих песен на сайте нет и быть не может — они принадлежат авторам. Пластинка
// открывает официальное видео автора во встроенном плеере YouTube, и только после
// нажатия: до него сайт к YouTube не обращается (см. content/player.ts).
//
// Каждая запись сверена с YouTube (служба oEmbed, 2026-11-24): название и канал
// взяты оттуда дословно, встраивание автором разрешено. Добавляя пластинку,
// проверь её так же: https://www.youtube.com/oembed?url=<адрес видео>&format=json
import type { Fact } from './facts';

export interface RecordItem {
  /** Номер видео на YouTube. */
  video: string;
  /** Два цвета конверта: фон и рисунок. */
  sleeve: [string, string];
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
): RecordItem => ({
  video,
  sleeve,
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

export const RECORDS: RecordItem[] = [
  record(1, '19y8YTbvri8', 'メズマライザー', 'Mesmerizer', 'サツキ', true, ['#e0418f', '#35c7c0']),
  record(2, 'LLjfal8jCYI', 'オーバーライド', 'Override', '吉田夜世', false, ['#f08a24', '#201c22']),
  record(3, 'Soy4jGPHr3g', 'テトリス', 'Tetoris', '柊マグネタイト', false, ['#d8322e', '#f3e9d2']),
  record(4, 'UHbmkxv-874', 'ライアーダンサー', 'Liar Dancer', 'マサラダ', false, ['#6a3fb0', '#f2c230']),
];
