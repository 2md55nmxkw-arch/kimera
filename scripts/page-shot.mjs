// Снимок страницы целиком: холст вместе с текстом и вёрсткой поверх него.
//
//   node scripts/page-shot.mjs <кадр> [параметры]        главная, замершая в состоянии кадра
//   node scripts/page-shot.mjs --page=/props.html …      любая другая страница
//
// Параметры:
//   --out=путь.png      куда сохранить (по умолчанию shots/page/<имя>-<ширина>.png)
//   --size=1280x720     размер окна;  --mobile — то же, что --size=390x844 --dpr=3
//   --dpr=1             плотность пикселей экрана
//   --webgpu            основной рендер вместо запасного WebGL 2 (в безголовом режиме холст
//                       WebGPU на снимок страницы не попадает — для сверки картинки есть shots)
//   --query=a=1&b=2     добавить к адресу
//   --wait=выражение    ждать, пока JS-выражение на странице не станет истинным
//   --do=код            выполнить на странице перед снимком (можно await)
//   --hover=x,y  --click=x,y   навести или кликнуть в точке окна, пиксели
//   --delay=мс          подождать перед снимком
//   --motion            не включать «уменьшение движения» (по умолчанию включено,
//                       чтобы переходы CSS не попадали в кадр на полпути)
//
// Ошибки из консоли страницы печатаются в конце — это самый быстрый способ узнать,
// что страница сломалась.
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const found = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!found) return fallback;
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : true;
};
const shot = args.find((a) => !a.startsWith('--'));
const page_ = opt('page', '/');
const mobile = opt('mobile', false);
const [width, height] = String(opt('size', mobile ? '390x844' : '1280x720')).split('x').map(Number);
const dpr = Number(opt('dpr', mobile ? 3 : 1));
const webgpu = opt('webgpu', false);

const chrome = [process.env.CHROME, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!chrome) throw new Error('не нашёл Chrome; укажи путь в переменной CHROME');

const query = new URLSearchParams(String(opt('query', '')));
if (shot) query.set('freeze', shot);
if (!webgpu) query.set('webgl', '');
const name = (shot ?? page_.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')) || 'page';
const out = path.resolve(root, String(opt('out', `shots/page/${name}-${width}${webgpu ? '-gpu' : ''}.png`)));

const server = await createServer({ root, logLevel: 'error', server: { port: 5299, strictPort: false } });
await server.listen();
const url = `http://localhost:${server.httpServer.address().port}${page_}?${query}`;

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--disable-vulkan-surface', '--hide-scrollbars'],
});
const problems = [];
let failed = '';
try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    hasTouch: Boolean(mobile),
    isMobile: Boolean(mobile),
    reducedMotion: opt('motion', false) ? 'no-preference' : 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`ошибка: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  const wait = opt('wait', shot ? 'window.__frozen === true' : null);
  if (wait) await page.waitForFunction(String(wait), null, { timeout: 60_000 });
  const code = opt('do', null);
  if (code) await page.evaluate(`(async () => { ${code} })()`);
  const at = (v) => String(v).split(',').map(Number);
  if (opt('hover', null)) await page.mouse.move(...at(opt('hover')));
  if (opt('click', null)) await page.mouse.click(...at(opt('click')));
  await page.waitForTimeout(Number(opt('delay', 250)));
  await mkdir(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
} catch (err) {
  failed = String(err.message ?? err).split('\n')[0];
} finally {
  await browser.close();
  await server.close();
}

for (const p of problems) console.log(`[page] ${p}`);
if (failed) {
  console.error(`[page] не получилось: ${failed}`);
  process.exit(1);
}
console.log(`[page] ${path.relative(root, out)} — ${width}×${height}${dpr !== 1 ? ` @${dpr}x` : ''}, ${webgpu ? 'WebGPU' : 'WebGL 2'}`);
