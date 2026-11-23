// Сравнивает два набора контрольных кадров попиксельно.
//
//   node scripts/shots-compare.mjs [эталон] [проверяемый]
//
// По умолчанию baseline и current. Для каждого кадра печатает среднюю разницу
// (в ступенях яркости 0…255) и долю заметно изменившихся пикселей. Различающиеся
// кадры кладёт картинкой разницы в shots/_diff/. Код выхода 1, если есть расхождения.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');
const [a = 'baseline', b = 'current'] = process.argv.slice(2).filter((x) => !x.startsWith('--'));

const MEAN_LIMIT = 0.5; // средняя разница по кадру, ступеней из 255
const SHARE_LIMIT = 0.002; // доля пикселей, изменившихся заметно
const NOTICEABLE = 12; // с какой разницы пиксель считается изменившимся

const read = async (file) => PNG.sync.read(await readFile(file));
const meta = async (set) => JSON.parse(await readFile(path.join(root, set, '_done.json'), 'utf8'));

for (const set of [a, b]) {
  if (!existsSync(path.join(root, set, '_done.json'))) {
    console.error(`[compare] набора shots/${set} нет — сними его: npm run shots -- ${set}`);
    process.exit(2);
  }
}
const [ma, mb] = [await meta(a), await meta(b)];
if (ma.backend !== mb.backend) {
  console.warn(`[compare] наборы сняты разным рендером (${ma.backend} и ${mb.backend}) — мелкие расхождения ожидаемы`);
}

const diffDir = path.join(root, '_diff');
await rm(diffDir, { recursive: true, force: true });

const frames = async (set) => (await readdir(path.join(root, set))).filter((f) => f.endsWith('.png') && !f.startsWith('_')).sort();
const names = await frames(a);
const extra = (await frames(b)).filter((f) => !names.includes(f));
let bad = 0;

for (const file of names) {
  const other = path.join(root, b, file);
  if (!existsSync(other)) {
    console.log(`✗ ${file}: нет в ${b}`);
    bad++;
    continue;
  }
  const [pa, pb] = [await read(path.join(root, a, file)), await read(other)];
  if (pa.width !== pb.width || pa.height !== pb.height) {
    console.log(`✗ ${file}: размер ${pa.width}×${pa.height} против ${pb.width}×${pb.height}`);
    bad++;
    continue;
  }
  const diff = new PNG({ width: pa.width, height: pa.height });
  let sum = 0;
  let changed = 0;
  let peak = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    const d = Math.max(
      Math.abs(pa.data[i] - pb.data[i]),
      Math.abs(pa.data[i + 1] - pb.data[i + 1]),
      Math.abs(pa.data[i + 2] - pb.data[i + 2]),
    );
    sum += d;
    if (d > NOTICEABLE) changed++;
    if (d > peak) peak = d;
    // Картинка разницы: исходник в сером, изменения красным.
    const grey = (pa.data[i] * 0.3 + pa.data[i + 1] * 0.6 + pa.data[i + 2] * 0.1) * 0.35 + 150;
    const k = Math.min(1, d / 48);
    diff.data[i] = grey + (255 - grey) * k;
    diff.data[i + 1] = grey * (1 - k);
    diff.data[i + 2] = grey * (1 - k);
    diff.data[i + 3] = 255;
  }
  const pixels = pa.data.length / 4;
  const mean = sum / pixels;
  const share = changed / pixels;
  const ok = mean <= MEAN_LIMIT && share <= SHARE_LIMIT;
  console.log(
    `${ok ? '✓' : '✗'} ${file.padEnd(30)} средняя ${mean.toFixed(3)}  изменилось ${(share * 100).toFixed(3)}%  пик ${peak}`,
  );
  if (!ok) {
    bad++;
    await mkdir(diffDir, { recursive: true });
    await writeFile(path.join(diffDir, file), PNG.sync.write(diff));
  }
}
for (const file of extra) console.log(`+ ${file}: новый кадр, в ${a} его нет`);

console.log(bad ? `[compare] расходятся ${bad} из ${names.length}; разница в shots/_diff/` : `[compare] все ${names.length} кадров совпали`);
process.exit(bad ? 1 : 0);
