import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Приёмник контрольных кадров (только dev-сервер): страница снимает кадр и шлёт
 * PNG сюда, файл ложится в shots/<набор>/<имя>.png. См. src/core/capture.ts.
 */
function shots(): Plugin {
  const safe = /^[\w.-]+$/;
  return {
    name: 'kimera-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shots', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const set = url.searchParams.get('set') ?? '';
          // /save — кадр PNG, /done — итог съёмки, /perf — итог замера скорости.
          const report = { '/done': '_done', '/perf': '_perf' }[url.pathname];
          const name = report ?? url.searchParams.get('name') ?? '';
          if (req.method !== 'POST' || !safe.test(set) || !safe.test(name)) {
            res.statusCode = 400;
            res.end();
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const dir = path.resolve(server.config.root, 'shots', set);
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, report ? `${report}.json` : `${name}.png`), Buffer.concat(chunks));
          res.statusCode = 204;
          res.end();
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

export default defineConfig({
  // 'mpa': отсутствующие файлы отдают 404, а не index.html.
  // Так проверка «лежит ли модель в public/models» не получает HTML вместо VRM.
  appType: 'mpa',
  build: { target: 'esnext' },
  server: { watch: { ignored: ['**/shots/**'] } },
  plugins: [shots()],
});
