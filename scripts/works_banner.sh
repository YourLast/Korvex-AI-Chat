#!/usr/bin/env bash
# Полоса «Идут технические работы…» на сайте (на языке интерфейса человека) — на время тяжёлых работ на сервере:
# полные гейты на движке, сборки на всех ядрах. Без выкатки и без ключа: сайт читает файл флага при каждом опросе статуса (20 с).
#   works_banner.sh on [минут]   — включить или продлить (по умолчанию 180 мин, не больше 1440); после срока гаснет сам, даже если скрипт упал
#   works_banner.sh off          — снять
#   works_banner.sh show         — что сейчас
# Продление (on, пока горит) не возвращает полосу тем, кто её закрыл крестиком; новое включение после off или срока — возвращает.
# Файл: KX_WORKS_FILE или data/works_banner.json рядом с этим скриптом (живая вебка — app/scripts/works_banner.sh → app/data/).
set -eu
F=${KX_WORKS_FILE:-$(cd "$(dirname "$0")/.." && pwd)/data/works_banner.json}
now_ms() { date +%s%3N; }
case "${1:-show}" in
  on)
    M=${2:-180}
    [[ "$M" =~ ^[0-9]+$ ]] && (( M >= 1 && M <= 1440 )) || { echo "минуты: 1…1440" >&2; exit 2; }
    N=$(now_ms); U=$(( N + M * 60000 )); S=$N
    if [ -f "$F" ]; then
      read -r OS OU < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(int(d.get("since",0)), int(d.get("until",0)))' "$F" 2>/dev/null || echo "0 0")
      (( OU > N )) && S=$OS   # ещё горит — продлеваем, подпись прежняя
      (( OU > U )) && U=$OU   # не укорачиваем чужой более длинный срок
    fi
    T=$(mktemp "$F.XXXXXX"); printf '{"since":%s,"until":%s}\n' "$S" "$U" > "$T"; chmod 644 "$T"; mv -f "$T" "$F"
    echo "works on до $(date -d @$(( U / 1000 )) '+%d.%m %H:%M')" ;;
  off)
    rm -f "$F"; echo "works off" ;;
  show)
    if [ -f "$F" ]; then
      python3 -c 'import json,sys,time; d=json.load(open(sys.argv[1])); u=d.get("until",0)/1000; print("works", "on до "+time.strftime("%d.%m %H:%M", time.localtime(u)) if u>time.time() else "истёк (не показывается)")' "$F"
    else echo "works off"; fi ;;
  *) echo "on [минут] | off | show" >&2; exit 2 ;;
esac
