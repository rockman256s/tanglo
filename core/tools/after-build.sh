#!/usr/bin/env bash
# Дождаться полной сборки уровней, проверить их кодом игры, экспортировать в игру и пересобрать APK.
# Запуск: setsid nohup bash core/tools/after-build.sh > core/after-build.log 2>&1 &
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/core"
while pgrep -f "tools/build.js --from 1 --to 2000[0]" >/dev/null; do sleep 60; done
tr '\r' '\n' < build-full.log | tail -2
node tools/check.js levels | tail -16 || { echo "ПРОВЕРКА НЕ ПРОШЛА — экспорт и APK не делаю"; exit 1; }
node tools/export.js
bash "$ROOT/android/build-apk.sh" | tail -2
cp "$ROOT/android/WAZE-debug.apk" "$ROOT/android/WAZE-20000-levels.apk"
ls -la "$ROOT"/android/*.apk
du -sh "$ROOT/levels"
echo ГОТОВО
