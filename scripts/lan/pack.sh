#!/usr/bin/env bash
# Переносная сборка вебки для установки в локальной сети (17.11): один архив, на машине клиента нужен только node.
#   bash scripts/lan/pack.sh [<коммит>]      -> печатает путь к <KX_PACK_DIR>/korvex-web-<sha>.tar.gz (по умолчанию ../korvex-lan-pack)
# Сборка — в чистой копии кода на этом коммите (git worktree; node_modules — жёсткими ссылками, места не занимает), KX_STANDALONE=1:
# Next кладёт сервер и только нужные пакеты в .next/standalone. К ним: .next/static, public/, drizzle/ (миграции), сервер выкатки
# (scripts/next-server.mjs + start.mjs), установка (scripts/lan-setup.mjs, собрана esbuild в один файл), webctl.sh и VERSION. Окружения (.env*), БД, models.config.json
# в архиве НЕТ: они у клиента в shared/ (webctl.sh ставит ссылки). Уже собранный архив того же коммита не пересобирается.
set -euo pipefail
APP=$(cd "$(dirname "$0")/../.." && pwd)
SHA=$(git -C "$APP" rev-parse --short=10 "${1:-HEAD}")
W=${KX_PACK_DIR:-$(dirname "$APP")/korvex-lan-pack}
B=$W/build-$SHA; O=$W/korvex-web-$SHA; T=$O.tar.gz
mkdir -p "$W"
if [ -s "$T" ]; then echo "$T"; exit 0; fi
log() { echo "[pack $(date -u +%T)] $*" >&2; }
[ -e "$B" ] && git -C "$APP" worktree remove --force "$B" 2>/dev/null || true
[ -e "$B" ] && { log "ОТКАЗ: $B остался от прошлой сборки — проверьте и уберите вручную"; exit 1; }
git -C "$APP" worktree add --detach "$B" "$SHA" >&2
trap 'git -C "$APP" worktree remove --force "$B" >/dev/null 2>&1 || true' EXIT
cp -al "$APP/node_modules" "$B/node_modules"
build() { (cd "$B" && KX_STANDALONE=1 KX_BUILD_CPUS=${KX_BUILD_CPUS:-4} NODE_OPTIONS=--max-old-space-size=4096 npx next build) >&2; }
# next 16.4 при первом запуске после совета об обновлении выходит с кодом 1 уже ПОСЛЕ сборки («повторите команду») — повтор один раз
build || { log "сборка вернула ошибку — повтор"; build; }
S=$B/.next/standalone
[ -f "$S/.next/required-server-files.json" ] || { log "ОТКАЗ: нет $S/.next/required-server-files.json"; exit 1; }
rm -rf "$O.tmp"; mkdir -p "$O.tmp"
cp -a "$S/." "$O.tmp/"
rm -f "$O.tmp"/.env* "$O.tmp/models.config.json"     # окружение и модели — только у клиента (shared/)
rm -rf "$O.tmp/data"
cp -a "$B/.next/static" "$O.tmp/.next/static"
cp -a "$B/public" "$O.tmp/public"
cp -a "$B/drizzle" "$O.tmp/drizzle"
mkdir -p "$O.tmp/scripts"
cp "$B/scripts/next-server.mjs" "$O.tmp/scripts/"
# установка — одним файлом: drizzle-orm в переносной сборке вшит в сервер (не пакетом), better-sqlite3 — пакетом рядом
(cd "$B" && node_modules/.bin/esbuild scripts/lan-setup.mjs --bundle --platform=node --format=esm --external:better-sqlite3 --log-level=warning --outfile="$O.tmp/scripts/lan-setup.mjs") >&2
cp "$B/scripts/lan/start.mjs" "$B/scripts/lan/webctl.sh" "$O.tmp/"
cp "$B/scripts/works_banner.sh" "$O.tmp/"   # webctl.sh notice — полоса «технические работы» на сайте этой машины
echo "$SHA $(git -C "$APP" log -1 --format=%cI "$SHA")" > "$O.tmp/VERSION"
# проверка: в архиве нет секретов и боевых данных
if find "$O.tmp" -name '.env*' -o -name 'korvex.db*' -o -name '*.key' | grep -q .; then log "ОТКАЗ: в сборке нашлись .env / БД / ключи"; exit 1; fi
rm -rf "$O"; mv "$O.tmp" "$O"
tar -czf "$T.tmp" -C "$W" "korvex-web-$SHA" && mv "$T.tmp" "$T"
( cd "$W" && sha256sum "korvex-web-$SHA.tar.gz" > "korvex-web-$SHA.tar.gz.sha256" )
log "готово: $(du -sh "$T" | cut -f1) $T"
echo "$T"
