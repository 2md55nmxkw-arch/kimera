// Афиши: по одному кадру на шкуру → public/poster/default.webp, mosaic.webp, sketch.webp.
//
//   node scripts/posters.mjs [--frame=02-default-clear] [--size=1600x900] [--max=150]
//
// Зачем они: без WebGPU и WebGL 2 сцены нет, и главная показывает три кадра вместо
// неё (блок .fallback в index.html, правила в src/pages/veil.css); те же кадры стоят
// в программке. Переснимать — после любой заметной перемены сцены, персонажа или шкур.
//
// Как снимается. Страница замирает в состоянии контрольного кадра (?freeze=<кадр>,
// см. src/core/capture.ts) — та же поза, тот же ракурс, что в shots. Потом этот один
// кадр рисуется трижды, каждый раз целиком в одной шкуре и без линзы. Готовые PNG из
// shots/ тут не годятся: в них у каждой главы своя поза и свой ракурс, а запасная
// страница режет одно тело на три полосы — кадры обязаны совпадать пиксель в пиксель.
//
// Сжатие — в самом браузере: холст → WebP, качество подбирается делением пополам так,
// чтобы файл уложился в --max килобайт. Никаких программ для картинок в системе не нужно.
//
//   --frame=имя     контрольный кадр, в чьём состоянии снимать
//   --size=ШxВ      размер афиш; полосы в veil.css рассчитаны на 16:9
//   --max=150       потолок размера одного файла, КБ
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const frame = opt('frame', '02-default-clear');
const [width, height] = opt('size', '1600x900').split('x').map(Number);
const max = Number(opt('max', 150)) * 1000; // «не больше 150 КБ» считаем строго, по тысяче
// Порядок — как в списке шкур (src/skins/index.ts): номер шкуры и есть номер в этом списке.
const SKINS = ['default', 'mosaic', 'sketch'];

const chrome = [process.env.CHROME, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!chrome) throw new Error('не нашёл Chrome; укажи путь в переменной CHROME');

const server = await createServer({ root, logLevel: 'error', server: { port: 5399, strictPort: false } });
await server.listen();
// Холст WebGPU в безголовом режиме прочитать нельзя, поэтому афиши снимает запасной рендер.
const url = `http://localhost:${server.httpServer.address().port}/?freeze=${frame}&webgl`;

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl', '--hide-scrollbars'],
});
const problems = [];
const made = [];
let failed = '';
try {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`ошибка: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction('window.__frozen === true', null, { timeout: 60_000 });

  for (const [index, name] of SKINS.entries()) {
    const shot = await page.evaluate(
      async ({ index, max }) => {
        const { rig, u } = window.__kimera;
        if (!rig || !u?.skinA || !u?.lens) throw new Error('у страницы нет ручек rig и u: посмотри, что отдаёт __kimera в src/main.ts');
        // Весь кадр — одна шкура: линза нулевого радиуса и за экраном, следа нет.
        u.skinA.value = index;
        u.skinB.value = index;
        u.lens.value = 0;
        u.trailGain.value = 0;
        u.pointer.value.set(-2, -2);
        rig.render();
        // Холст читается сразу после рендера, в той же задаче: потом кадр уйдёт на экран.
        const png = rig.canvas.toDataURL('image/png');
        const image = new Image();
        image.src = png;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        const encode = (quality) => {
          const data = canvas.toDataURL('image/webp', quality);
          if (!data.startsWith('data:image/webp')) throw new Error('браузер не умеет кодировать WebP');
          const base64 = data.slice(data.indexOf(',') + 1);
          return { quality, base64, bytes: Math.floor((base64.length * 3) / 4) };
        };
        // Лучшее качество, при котором файл ещё укладывается в потолок.
        let low = 0.2;
        let high = 0.95;
        let best = encode(low);
        for (let i = 0; i < 8 && best.bytes <= max; i++) {
          const mid = (low + high) / 2;
          const tried = encode(mid);
          if (tried.bytes <= max) {
            best = tried;
            low = mid;
          } else {
            high = mid;
          }
        }
        return { ...best, width: canvas.width, height: canvas.height };
      },
      { index, max },
    );
    if (shot.bytes > max) throw new Error(`${name}: даже на худшем качестве ${Math.round(shot.bytes / 1000)} КБ — уменьши --size`);
    const file = path.join(root, 'public', 'poster', `${name}.webp`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(shot.base64, 'base64'));
    made.push(`  ${`${name}.webp`.padEnd(14)} ${shot.width}×${shot.height}  ${String(Math.round(shot.bytes / 1000)).padStart(3)} КБ  качество ${shot.quality.toFixed(2)}`);
  }
} catch (err) {
  failed = String(err.message ?? err).split('\n')[0];
} finally {
  await browser.close();
  await server.close();
}

for (const p of problems) console.log(`[posters] ${p}`);
if (failed) {
  console.error(`[posters] не получилось: ${failed}`);
  process.exit(1);
}
console.log(`[posters] кадр ${frame} в трёх шкурах → public/poster/`);
for (const line of made) console.log(line);
