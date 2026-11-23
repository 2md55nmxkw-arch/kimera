#!/usr/bin/env bash
# Готовит свежую рабочую копию (git worktree) к работе: в ней нет ни зависимостей,
# ни модели персонажа — оба в .gitignore. Зависимости берутся жёсткими ссылками из
# основной копии (мгновенно и без лишнего места), модель — ссылкой на тот же файл.
# В основной копии ничего не делает. Запускать из корня рабочей копии: npm run setup
set -euo pipefail

here="$(git rev-parse --show-toplevel)"
main="$(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}')"
cd "$here"

if [ "$main" = "$here" ]; then
  echo "[setup] это основная копия, готовить нечего"
  exit 0
fi

if [ ! -d node_modules ]; then
  if cp -al "$main/node_modules" node_modules 2>/dev/null; then
    echo "[setup] зависимости: жёсткие ссылки на основную копию"
  elif cp -r --reflink=auto "$main/node_modules" node_modules 2>/dev/null; then
    echo "[setup] зависимости: скопированы"
  else
    rm -rf node_modules
    npm ci --prefer-offline --no-audit --no-fund
  fi
  # Кэш сборщика у каждой копии свой, иначе параллельные серверы мешают друг другу.
  rm -rf node_modules/.vite
fi

mkdir -p public/models
if [ ! -e public/models/teto.vrm ]; then
  if [ -e "$main/public/models/teto.vrm" ]; then
    ln "$main/public/models/teto.vrm" public/models/teto.vrm 2>/dev/null \
      || ln -s "$main/public/models/teto.vrm" public/models/teto.vrm
    echo "[setup] модель: ссылка на основную копию"
  else
    echo "[setup] модели в основной копии нет — на сцене будет манекен" >&2
  fi
fi
echo "[setup] готово: $here"
