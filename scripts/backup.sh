#!/bin/sh
# Óránkénti MongoDB mentés — a `backup` service entrypointja.
# Design: docs/superpowers/specs/2026-08-06-mongo-backup-design.md
set -eu

MONGO_URL="${MONGO_URL:-mongodb://mongo:27017/filler}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_HOURLY_HOURS="${KEEP_HOURLY_HOURS:-24}"
KEEP_DAILY_DAYS="${KEEP_DAILY_DAYS:-14}"

log() {
  echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

# A fájlnév időbélyegét (kassza-YYYYMMDD-HHMMSS.tar.gz) epoch másodpercre
# fordítja. Szándékosan nem az mtime-ból dolgozunk: egy cp vagy rsync friss
# mtime-ot adna egy régi mentésnek, és a takarítás elhinné neki.
name_to_epoch() {
  stamp="${1#kassza-}"
  stamp="${stamp%.tar.gz}"
  day=$(echo "${stamp%-*}" | sed 's/\(....\)\(..\)\(..\)/\1-\2-\3/')
  hms=$(echo "${stamp#*-}" | sed 's/\(..\)\(..\)\(..\)/\1:\2:\3/')
  date -d "$day $hms" +%s
}

run_backup() {
  ts=$(date '+%Y%m%d-%H%M%S')
  work=$(mktemp -d)

  if ! mongodump --uri="$MONGO_URL" --out="$work/dump" --quiet; then
    log "HIBA: a mongodump nem futott le, ez az óra kimarad"
    rm -rf "$work"
    return 1
  fi

  # A .part kiterjesztés + atomi mv együtt garantálja, hogy félkész archívum
  # soha ne látszódjon érvényes mentésnek — se a takarításnak, se embernek,
  # aki visszaállítana belőle.
  part="$BACKUP_DIR/.kassza-$ts.tar.gz.part"
  if ! tar -czf "$part" -C "$work" dump; then
    log "HIBA: a tömörítés nem sikerült, ez az óra kimarad"
    rm -f "$part"
    rm -rf "$work"
    return 1
  fi
  rm -rf "$work"
  mv "$part" "$BACKUP_DIR/kassza-$ts.tar.gz"

  log "kész: kassza-$ts.tar.gz ($(du -h "$BACKUP_DIR/kassza-$ts.tar.gz" | cut -f1))"
}

# Rétegzett megőrzés: 24 órán belül minden, azon túl naponta egy, 14 nap után
# semmi. A határok a KEEP_* env változókból jönnek.
prune() {
  now=$(date +%s)
  hourly_cutoff=$((now - KEEP_HOURLY_HOURS * 3600))
  daily_cutoff=$((now - KEEP_DAILY_DAYS * 86400))
  kept_day=''
  removed=0

  # Legújabbtól a legrégebbi felé haladunk, így minden napból az első, amit
  # látunk, a nap legfrissebb mentése — az marad meg napi példánynak.
  # A `ls` szóhatár szerinti feldarabolása itt biztonságos: a fájlneveket
  # ugyanez a script gyártja, fix `kassza-<számok>.tar.gz` formában. Kézzel
  # bemásolt, szóközös nevű fájlon a name_to_epoch elhasal, és a `continue`
  # egyszerűen kihagyja — törölni nem tud rosszat.
  for path in $(ls -1 "$BACKUP_DIR"/kassza-*.tar.gz 2>/dev/null | sort -r); do
    base=$(basename "$path")
    fts=$(name_to_epoch "$base") || continue
    day="${base#kassza-}"
    day="${day%%-*}"

    if [ "$fts" -ge "$hourly_cutoff" ]; then
      continue
    fi
    if [ "$fts" -lt "$daily_cutoff" ] || [ "$day" = "$kept_day" ]; then
      rm -f "$path"
      removed=$((removed + 1))
      continue
    fi
    kept_day="$day"
  done

  if [ "$removed" -gt 0 ]; then
    kept=$(ls -1 "$BACKUP_DIR"/kassza-*.tar.gz 2>/dev/null | wc -l)
    log "takarítás: $removed törölve, $kept megmaradt"
  fi
}

mkdir -p "$BACKUP_DIR"
# Előző futásból ottfelejtett félkész archívumok.
rm -f "$BACKUP_DIR"/.kassza-*.tar.gz.part

log "indul — cél: $BACKUP_DIR, forrás: $MONGO_URL"
log "megőrzés: ${KEEP_HOURLY_HOURS} órán át óránként, ${KEEP_DAILY_DAYS} napon át naponta"

while true; do
  # Egy hibás óra ne állítsa meg a sorozatot: a || true tartja életben a
  # ciklust, a hiba oka a logban marad.
  run_backup || true
  prune || true

  # A következő egész óráig alszunk, nem fix 3600-at — így a mentések nem
  # sodródnak el a dump futásidejével.
  now=$(date +%s)
  next=$(((now / 3600 + 1) * 3600))
  log "következő mentés: $(date -d "@$next" '+%Y-%m-%d %H:%M:%S')"
  sleep $((next - now))
done
