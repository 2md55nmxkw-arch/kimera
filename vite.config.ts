import { defineConfig } from 'vite';

export default defineConfig({
  // 'mpa': отсутствующие файлы отдают 404, а не index.html.
  // Так проверка «лежит ли модель в public/models» не получает HTML вместо VRM.
  appType: 'mpa',
  build: { target: 'esnext' },
});
