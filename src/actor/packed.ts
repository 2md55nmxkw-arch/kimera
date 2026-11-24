// Вшитая модель: на опубликованном сайте модель лежит не файлом .vrm, а в своём
// виде (.kmd), который читает только этот сайт.
//
// Зачем. Автор модели запрещает её перезаливать и раздавать. Сайту модель нужна,
// чтобы её показывать, а не чтобы отдавать: поэтому готового .vrm, который можно
// скачать по ссылке и унести, на сайте нет. Это не защита от того, кто полезет
// разбирать страницу, — так устроена любая игра с чужими моделями внутри, — а способ
// не превращать сайт в место раздачи файла. Модель берут у автора (см. README).
//
// Вид файла: «KMDL», длина исходного файла, дальше его байты, сложенные по модулю два
// с потоком чисел. Тем же способом файл собирает scripts/assets.mjs.

const MAGIC = 0x4c444d4b; // «KMDL»
const SEED = 0x6b1d3a57;

/** Развернуть вшитую модель обратно в байты glTF. */
export function unpack(buffer: ArrayBuffer): ArrayBuffer {
  const head = new DataView(buffer);
  if (buffer.byteLength < 8 || head.getUint32(0, true) !== MAGIC) throw new Error('это не вшитая модель');
  const length = head.getUint32(4, true);
  const words = new Uint32Array(buffer.slice(8));
  let x = SEED ^ length || 1;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] ^= x;
  }
  return words.buffer.slice(0, length);
}

/** Скачать файл целиком, сообщая о ходе загрузки (0…1). */
export async function download(url: string, onProgress?: (loaded: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`не скачалось: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    // Сервер может отдавать файл сжатым: тогда байт придёт больше, чем обещано.
    if (total > 0) onProgress?.(Math.min(loaded / total, 1));
  }
  const all = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all.buffer;
}
