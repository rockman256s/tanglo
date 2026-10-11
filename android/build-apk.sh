#!/usr/bin/env bash
# Сборка APK игры Tanglo (WebView-обёртка). Использование: bash android/build-apk.sh
#
# SDK не качаем: JDK 17, Gradle 8.7 и архивы Android SDK 34 берутся из тулчейна другого
# проекта (переменная TOOLCHAIN), кеш зависимостей Gradle — копия в android/.build/gradle-home,
# сборка идёт офлайн. Рабочая песочница — в /tmp (в пути тулчейна есть пробел, а скрипты
# sdkmanager/gradle его не переваривают).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AND="$ROOT/android"
B="$AND/.build"
TOOLCHAIN="${TOOLCHAIN:-/home/roman/mini harness/my_mini_agent/android/.build}"
T=/tmp/wazegame-ab

# --- веб-часть игры → assets/www --------------------------------------------
WWW="$AND/app/src/main/assets/www"
rm -rf "$WWW"
mkdir -p "$WWW"
cp "$ROOT/index.html" "$ROOT/style.css" "$ROOT/icon-192.png" "$WWW/"
cp -r "$ROOT/src" "$WWW/src"
[ -d "$ROOT/levels" ] && cp -r "$ROOT/levels" "$WWW/levels"
echo "assets: $(du -sh "$WWW" | cut -f1)"

# --- тулчейн в песочнице -----------------------------------------------------
if [ ! -x "$T/jdk/bin/java" ] || [ ! -x "$T/gradle/bin/gradle" ] || [ ! -d "$T/sdk/platforms/android-34" ]; then
  echo "== песочница тулчейна: $T =="
  rm -rf "$T"
  mkdir -p "$T/sdk/platforms" "$T/sdk/build-tools"
  cp -a --reflink=auto "$(ls -d "$TOOLCHAIN"/jdk-17* | head -1)" "$T/jdk"
  cp -a --reflink=auto "$TOOLCHAIN/gradle-8.7" "$T/gradle"
  unzip -q -o "$TOOLCHAIN/sdk-cache/platform.zip" -d "$T/sdk/platforms"
  unzip -q -o "$TOOLCHAIN/sdk-cache/bt.zip" -d "$T/sdk/build-tools"
  [ -d "$T/sdk/build-tools/android-14" ] && mv "$T/sdk/build-tools/android-14" "$T/sdk/build-tools/34.0.0"
  unzip -q -o "$TOOLCHAIN/sdk-cache/pt.zip" -d "$T/sdk"
  # платформа в архиве лежит под другим именем каталога
  for d in "$T/sdk/platforms"/*; do [ "$(basename "$d")" != android-34 ] && mv "$d" "$T/sdk/platforms/android-34"; done
  mkdir -p "$T/sdk/licenses"
  printf '\n8933bad161af4178b1185d1a37fbf41ea5269c55\nd56f5187479451eabf01fb78af6dfcb131a6481e\n24333f8a63b6825ea9c5514f83c2829b004d1fee\n' > "$T/sdk/licenses/android-sdk-license"
fi

if [ ! -d "$B/gradle-home/caches/modules-2" ]; then
  echo "== кеш зависимостей Gradle =="
  mkdir -p "$B/gradle-home/caches"
  cp -a --reflink=auto "$TOOLCHAIN/gradle-home/caches/modules-2" "$B/gradle-home/caches/"
fi

export JAVA_HOME="$T/jdk"; export PATH="$JAVA_HOME/bin:$PATH"
# HOME в проекте: там debug.keystore — подпись одна и та же от сборки к сборке,
# иначе установка поверх старой версии падает
export HOME="$B/home"; export ANDROID_USER_HOME="$B/home/.android"; mkdir -p "$ANDROID_USER_HOME"
export ANDROID_HOME="$T/sdk"; export ANDROID_SDK_ROOT="$T/sdk"
export GRADLE_USER_HOME="$B/gradle-home"
printf 'sdk.dir=%s\n' "$T/sdk" > "$AND/local.properties"

# --- сборка ------------------------------------------------------------------
echo "== assembleDebug =="
set +e
"$T/gradle/bin/gradle" -p "$AND" --offline --no-daemon -Duser.home="$HOME" "${@:-assembleDebug}" > "$B/build.log" 2>&1
RC=$?
set -e
if [ $RC -ne 0 ]; then
  echo "BUILD FAILED:"
  grep -E "error:|What went wrong" -A8 "$B/build.log" | head -40
  echo "(полный лог: android/.build/build.log)"
  exit 1
fi
APK=$(find "$AND/app/build/outputs/apk" -name "*.apk" | head -1)
cp "$APK" "$AND/Tanglo-debug.apk"
ls -la "$AND/Tanglo-debug.apk"
