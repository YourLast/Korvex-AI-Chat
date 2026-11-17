#!/usr/bin/env bash
# Вебка Korvex в локальной сети (17.11): без systemd, npm и докера — переносной node и переносная сборка (scripts/lan/pack.sh).
#   webctl.sh install <korvex-web-<sha>.tar.gz>   распаковать в rel/<sha> (проверка .sha256 рядом с архивом, если есть)
#   webctl.sh switch <sha>                        выкатка без простоя: новый процесс рядом на том же порту (reusePort) -> здоров ->
#                                                 старому «доводка» (SIGUSR2: доводит ходы и гаснет сам); current -> <sha>, prev -> прежняя
#   webctl.sh rollback                            то же на prev (откат одной командой)
#   webctl.sh start | ensure                      поднять current, если процесса нет (ensure — для сторожа cron; молчит, когда всё живо)
#   webctl.sh stop                                SIGTERM процессу (аварийно: идущие ходы сохраняются частично)
#   webctl.sh status                              версия, pid, здоровье
# Раскладка ($KX_WEB_HOME, по умолчанию — папка, где лежит этот webctl.sh; запуск из rel/<sha>/ — на две папки выше): node/ (bin/node), rel/<sha>/, current|prev -> rel/<sha>, shared/{.env.local,
# models.config.json,web.env,data/}, logs/, run/. Ничего не удаляет (удалять — только решением владельца машины) — старые
# rel/<sha>, журналы и бэкапы БД копятся; лишнее убирает человек. Процессы снимает только по точному PID из run/.
set -u
_here=$(cd "$(dirname "$0")" && pwd)
case "$_here" in */rel/*) _here=$(cd "$_here/../.." && pwd) ;; esac
W=${KX_WEB_HOME:-$_here}
NODE=${KX_NODE:-$W/node/bin/node}
L=$W/logs; R=$W/run; SH=$W/shared
mkdir -p "$L" "$R" "$W/rel" "$SH/data"
PORT=28100; BIND=127.0.0.1; ADMIN_PORTS=28190-28199; HEALTH_S=180
[ -f "$SH/web.env" ] && . "$SH/web.env"     # PORT, BIND, ADMIN_PORTS, HEALTH_S (без секретов: секреты — в shared/.env.local и файлах ключей)
say() { echo "[webctl $(date -u +%T)] $*"; }
die() { echo "[webctl] ОТКАЗ: $*" >&2; exit 1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
cur_pid() { cat "$R/web.pid" 2>/dev/null; }
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null; }

launch() {   # launch <rel dir> -> печатает "<pid> <служебный порт>"
  local d=$1 id ap= p lo hi
  id=$(basename "$d")
  lo=${ADMIN_PORTS%-*}; hi=${ADMIN_PORTS#*-}
  for p in $(seq "$lo" "$hi"); do port_free "$p" && { ap=$p; break; }; done
  [ -n "$ap" ] || die "нет свободного служебного порта в $ADMIN_PORTS"
  local log=$L/web_${id}_$(date -u +%Y%m%d_%H%M%S).log
  ( cd "$d" && exec setsid env DATA_DIR="$SH/data" PORT="$PORT" KX_BIND="$BIND" KX_ADMIN_PORT="$ap" KX_INSTANCE="$id-$(date -u +%H%M%S)" \
      NODE_ENV=production NODE_OPTIONS=--max-old-space-size=1024 "$NODE" start.mjs ) >> "$log" 2>&1 < /dev/null &
  echo "$! $ap $log"
}

backup_db() {   # горячий бэкап перед выкаткой (новая версия может накатить миграцию); файлы копятся — см. шапку
  local db=$SH/data/korvex.db
  [ -f "$db" ] || return 0
  ( cd "$W/current" 2>/dev/null || cd "$1"; "$NODE" -e "const D=require('better-sqlite3');const s=new D(process.argv[1],{readonly:true,fileMustExist:true});s.backup(process.argv[2]).then(()=>s.close())" "$db" "$db.bak_$(date -u +%Y%m%d_%H%M%S)" ) \
    || die "бэкап БД не удался — выкатка не начата"
}

do_switch() {
  local id=$1 d=$W/rel/$1 old new ap log t
  [ -f "$d/start.mjs" ] || die "нет сборки $d (сначала install)"
  [ -x "$NODE" ] || die "нет node: $NODE"
  [ -f "$SH/.env.local" ] || die "нет $SH/.env.local"
  ln -sfn "$SH/.env.local" "$d/.env.local"; ln -sfn "$SH/models.config.json" "$d/models.config.json"
  old=$(cur_pid); alive "$old" || old=
  backup_db "$d"
  read -r new ap log < <(launch "$d")
  [ -n "${new:-}" ] || die "новый процесс не запущен"
  say "новый процесс $new ($id), служебный порт $ap, журнал $log"
  t=0
  until [ "$(code "http://127.0.0.1:$ap/__kx/health")" = 200 ] && [ "$(code "http://127.0.0.1:$ap/login")" = 200 ]; do
    if ! alive "$new" || [ $t -ge "$HEALTH_S" ]; then
      alive "$new" && kill -TERM "$new"
      die "новая версия $id не поднялась за ${t} с (журнал $log); работает прежняя"
    fi
    sleep 2; t=$((t+2))
  done
  [ "$(code "http://$BIND:$PORT/login")" = 200 ] || say "ВНИМАНИЕ: общий порт $PORT ответил не 200"
  if [ -n "$old" ]; then kill -USR2 "$old" && say "прежнему процессу $old — доводка (доведёт ходы и выйдет сам)"; fi
  local was; was=$(readlink "$W/current" 2>/dev/null || true)
  [ -n "$was" ] && [ "$was" != "rel/$id" ] && ln -sfn "$was" "$W/prev"
  ln -sfn "rel/$id" "$W/current"
  echo "$new" > "$R/web.pid"; echo "$ap" > "$R/web.admin_port"
  echo "$(date -u +%FT%TZ) switch $id pid $new (было ${was:-—}, pid ${old:-—})" >> "$L/deploys.log"
  say "готово: current = $id"
}

case "${1:-status}" in
  install)
    f=${2:?архив korvex-web-<sha>.tar.gz}; [ -f "$f" ] || die "нет файла $f"
    if [ -f "$f.sha256" ]; then (cd "$(dirname "$f")" && sha256sum -c "$(basename "$f").sha256" >/dev/null) || die "sha256 архива не совпал"; fi
    id=$(basename "$f" .tar.gz); id=${id#korvex-web-}
    [ -e "$W/rel/$id" ] && { say "уже распакована: rel/$id"; exit 0; }
    tmp=$W/rel/.unpack-$id; mkdir -p "$tmp"
    tar -xzf "$f" -C "$tmp" || die "архив не распаковался"
    mv "$tmp/korvex-web-$id" "$W/rel/$id" && rmdir "$tmp"
    say "распакована rel/$id ($(cat "$W/rel/$id/VERSION"))" ;;
  switch) do_switch "${2:?sha}" ;;
  rollback)
    p=$(readlink "$W/prev" 2>/dev/null) || die "нет prev"
    do_switch "$(basename "$p")" ;;
  start|ensure)
    p=$(cur_pid)
    if alive "$p"; then [ "$1" = start ] && say "уже работает: pid $p"; exit 0; fi
    [ -L "$W/current" ] || die "нет current (сначала install + switch)"
    d=$(readlink -f "$W/current")
    read -r new ap log < <(launch "$d")
    [ -n "${new:-}" ] || die "процесс не запущен"
    echo "$new" > "$R/web.pid"; echo "$ap" > "$R/web.admin_port"
    echo "$(date -u +%FT%TZ) $1 $(basename "$d") pid $new" >> "$L/deploys.log"
    say "поднята $(basename "$d"): pid $new, журнал $log" ;;
  stop)
    p=$(cur_pid); alive "$p" || { say "не работает"; exit 0; }
    kill -TERM "$p"; say "SIGTERM $p" ;;
  status)
    p=$(cur_pid); ap=$(cat "$R/web.admin_port" 2>/dev/null)
    echo "current: $(readlink "$W/current" 2>/dev/null || echo —)   prev: $(readlink "$W/prev" 2>/dev/null || echo —)"
    echo "версия: $(cat "$W/current/VERSION" 2>/dev/null || echo —)"
    if alive "$p"; then echo "pid $p: жив; здоровье $(code "http://127.0.0.1:$ap/__kx/health"), общий порт $BIND:$PORT -> $(code "http://$BIND:$PORT/login")"; else echo "процесс: не работает"; fi
    tail -3 "$L/deploys.log" 2>/dev/null ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
