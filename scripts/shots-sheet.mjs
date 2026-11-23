// Собирает все кадры набора в один сводный лист: shots/<набор>/_sheet.png.
//
//   node scripts/shots-sheet.mjs [набор] [--cols=4] [--cell=400]
//
// Удобно просматривать набор целиком одной картинкой. Имена кадров идут по порядку
// слева направо, сверху вниз — тем же списком, что печатает скрипт.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');
const args = process.argv.slice(2);
const num = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const set = args.find((a) => !a.startsWith('--')) ?? 'current';
const cols = num('cols', 4);
const cellW = num('cell', 400);
const cellH = Math.round((cellW * 9) / 16);
const gap = 6;

const files = (await readdir(path.join(root, set))).filter((f) => f.endsWith('.png') && !f.startsWith('_')).sort();
const rows = Math.ceil(files.length / cols);
const sheet = new PNG({ width: cols * (cellW + gap) + gap, height: rows * (cellH + gap) + gap });
sheet.data.fill(40);
for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;

for (const [index, file] of files.entries()) {
  const src = PNG.sync.read(await readFile(path.join(root, set, file)));
  // Вписываем кадр в ячейку целиком, сохраняя пропорции.
  const scale = Math.min(cellW / src.width, cellH / src.height);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const x0 = gap + (index % cols) * (cellW + gap) + Math.floor((cellW - w) / 2);
  const y0 = gap + Math.floor(index / cols) * (cellH + gap) + Math.floor((cellH - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Усреднение по площади: мелкие штрихи не превращаются в рябь.
      const sx0 = Math.floor(x / scale);
      const sy0 = Math.floor(y / scale);
      const sx1 = Math.min(src.width, Math.max(sx0 + 1, Math.floor((x + 1) / scale)));
      const sy1 = Math.min(src.height, Math.max(sy0 + 1, Math.floor((y + 1) / scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const k = (sy * src.width + sx) * 4;
          r += src.data[k];
          g += src.data[k + 1];
          b += src.data[k + 2];
        }
      }
      const n = (sx1 - sx0) * (sy1 - sy0);
      const o = ((y0 + y) * sheet.width + x0 + x) * 4;
      sheet.data[o] = r / n;
      sheet.data[o + 1] = g / n;
      sheet.data[o + 2] = b / n;
    }
  }
}

await writeFile(path.join(root, set, '_sheet.png'), PNG.sync.write(sheet));
console.log(`[sheet] shots/${set}/_sheet.png — ${cols} в ряд:`);
files.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f.replace(/\.png$/, '')}`));
