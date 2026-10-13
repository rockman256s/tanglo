#!/usr/bin/env bash
# Ключ загрузки (upload key) для Google Play. Запускать один раз, руками: пароль вводите сами.
# Ключ и пароль лежат в android/.build/release/ (вне git). Сохраните копию upload.jks и пароль
# в менеджере паролей: при потере ключ загрузки сбрасывается через поддержку Play, но это дни.
set -euo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.build/release"
KT=/tmp/wazegame-ab/jdk/bin/keytool
[ -x "$KT" ] || { echo "нет JDK: сначала bash android/build-apk.sh"; exit 1; }
[ -t 0 ] || { echo "нужен обычный терминал: скрипт спрашивает пароль с клавиатуры"; exit 1; }
mkdir -p "$D"
[ -f "$D/upload.jks" ] && { echo "ключ уже есть: $D/upload.jks"; exit 1; }
read -rsp "Пароль для ключа (от 8 символов): " PW; echo
read -rsp "Ещё раз: " PW2; echo
[ "$PW" = "$PW2" ] && [ ${#PW} -ge 8 ] || { echo "пароли не совпадают или короче 8"; exit 1; }
"$KT" -genkeypair -keystore "$D/upload.jks" -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 \
  -validity 10000 -storepass "$PW" -keypass "$PW" -dname "CN=RockMan LLC, O=RockMan LLC"
umask 077
printf 'storeFile=.build/release/upload.jks\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$PW" "$PW" > "$D/keystore.properties"
chmod 600 "$D/upload.jks"
echo "готово: $D/upload.jks"
