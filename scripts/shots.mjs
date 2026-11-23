// Снимает контрольные кадры в безголовом Chrome.
//
//   node scripts/shots.mjs [набор] [--webgpu] [--only=имя,имя]
//   node scripts/shots.mjs --perf [--webgpu]      замер времени кадра вместо съёмки
//
// По умолчанию кадры снимаются запасным рендером WebGL 2, с --webgpu — основным.
// Оба идут через настоящую видеокарту; для WebGPU в безголовом режиме на Linux
// обязателен флаг --disable-vulkan-surface, без него достаётся программный адаптер.
//
// Поднимает свой dev-сервер, открывает страницу с ?shots=<набор>, ждёт, пока она
// снимет все кадры (см. src/core/capture.ts), и кладёт их в shots/<набор>/.
// Путь к браузеру можно задать переменной CHROME.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const webgl = !args.includes('--webgpu');
const perf = args.includes('--perf');
const set = args.find((a) => !a.startsWith('--')) ?? (perf ? 'perf' : 'current');
if (!/^[\w.-]+$/.test(set)) throw new Error(`плохое имя набора: ${set}`);

const candidates = [
  process.env.CHROME,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) throw new Error('не нашёл Chrome; укажи путь в переменной CHROME');

const out = path.join(root, 'shots', set);
await rm(out, { recursive: true, force: true });

const server = await createServer({ root, logLevel: 'warn', server: { port: 5199, strictPort: false } });
await server.listen();
const port = server.httpServer.address().port;
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
// --q=low|medium|high — снять или замерить на другом уровне качества.
const q = args.find((a) => a.startsWith('--q='))?.slice(4);
const url = `http://localhost:${port}/?${perf ? 'perf' : 'shots'}=${set}${webgl ? '&webgl' : ''}${only ? `&only=${only}` : ''}${q ? `&q=${q}` : ''}`;
// Флаги графики можно подменить целиком: SHOTS_GPU_FLAGS="--use-angle=vulkan …"
const gpuFlags = process.env.SHOTS_GPU_FLAGS?.split(' ').filter(Boolean) ?? [
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--use-angle=gl-egl',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--disable-vulkan-surface',
];

const profile = await mkdtemp(path.join(tmpdir(), 'kimera-shots-'));
const browser = spawn(
  chrome,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=1280,720',
    ...gpuFlags,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    url,
  ],
  { stdio: 'ignore' },
);

// Если скрипт прервали снаружи, браузер не должен остаться висеть.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    browser.kill('SIGKILL');
    process.exit(130);
  });
}

const doneFile = path.join(out, perf ? '_perf.json' : '_done.json');
const deadline = Date.now() + 240_000;
let failed = '';
while (!existsSync(doneFile)) {
  if (Date.now() > deadline) {
    failed = 'страница не закончила за 4 минуты';
    break;
  }
  if (browser.exitCode !== null) {
    failed = `Chrome вышел с кодом ${browser.exitCode}`;
    break;
  }
  await new Promise((r) => setTimeout(r, 300));
}

browser.kill();
await server.close();
await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});

if (failed) {
  console.error(`[shots] ${failed}`);
  process.exit(1);
}
const done = JSON.parse(await readFile(doneFile, 'utf8'));
if (perf) {
  console.log(`[perf] ${done.backend}, ${done.size}; 16.7 мс — потолок для 60 кадров в секунду`);
  for (const row of done.rows) {
    console.log(`  ${row.name.padEnd(22)} ${row.ms.toFixed(1).padStart(6)} мс на кадр, из них шаг симуляции ${row.cpu.toFixed(1)} мс`);
  }
} else {
  console.log(`[shots] ${set}: ${done.shots.length} кадров, рендер ${done.backend} → shots/${set}/`);
}
console.log(`[shots] ${done.gpu}`);
