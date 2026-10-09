#!/usr/bin/env bash
# E2E local de «prioridad de Semanas en Mi trabajo» — vínculo explícito tarea de Semanas ↔ work item (0042).
# Postgres DESCARTABLE + migraciones reales + login real + planificación nativa + COPIA LOCAL de SEMANAS 2026
# (nunca Google, nunca Neon, nunca Production). Deja capturas en $OUT.
#
#   npm run test:e2e:semanas-mi-trabajo    (desde frontend/)
#
# Qué hace:
#   1. Guardas: aborta dentro de Vercel o con VERCEL_ENV/GENUS_ENV=production.
#   2. Postgres DESCARTABLE: si no se pasa GENUS_E2E_DATABASE_URL, crea un cluster nuevo en $GENUS_E2E_PGDATA
#      (por defecto /tmp/genus-e2e-pg) con initdb y lo borra al terminar.
#   3. Proxy WebSocket→Postgres (scripts/e2e/local-pg-wsproxy.mjs) en 127.0.0.1:443, porque la app usa el driver Neon.
#   4. Migraciones reales + marca de base de prueba + usuarios de prueba (scripts/e2e/setup-e2e-db.mjs).
#   5. `next dev` (la copia local del libro solo se habilita fuera de producción) con planificación nativa.
#   6. Corre scripts/e2e/semanas-mi-trabajo-validate.mjs (Chromium) y apaga app, proxy y Postgres.
#
# Requisitos: Node 20+, binarios de Postgres (initdb/pg_ctl), openssl, Chromium de Playwright
# (o GENUS_E2E_CHROMIUM_PATH) y permiso para escuchar en el puerto 443 (root o CAP_NET_BIND_SERVICE).
# Ver scripts/e2e/README.md.
set -euo pipefail

cd "$(dirname "$0")/../.."   # frontend/
FRONTEND_DIR="$(pwd)"
STATE_DIR="$FRONTEND_DIR/.e2e-local"
mkdir -p "$STATE_DIR"

if [[ -n "${VERCEL:-}" || -n "${VERCEL_ENV:-}" || "${GENUS_ENV:-}" == "production" ]]; then
  echo "[e2e] ABORTADO: este script nunca corre en Vercel ni en producción." >&2
  exit 1
fi

PORT="${GENUS_E2E_PORT:-3280}"
PG_PORT="${GENUS_E2E_PG_PORT:-55432}"
PGDATA_DIR="${GENUS_E2E_PGDATA:-/tmp/genus-e2e-pg}"
PG_PASSWORD="${GENUS_E2E_PG_PASSWORD:-genus-e2e-local}"
PIDS=()
STARTED_PG=0

find_pg_bin() {
  if command -v pg_ctl >/dev/null 2>&1; then dirname "$(command -v pg_ctl)"; return; fi
  ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1
}
as_pg_user() {
  # Postgres no corre como root: en contenedores root se usa el usuario "postgres".
  if [[ "$(id -u)" == "0" ]]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi
}

cleanup() {
  local code=$?
  # Cada proceso arrancó en su propio grupo (setsid): se mata el grupo entero (npx → next-server, etc.).
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && { kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; }; done
  if [[ "$STARTED_PG" == "1" ]]; then
    as_pg_user "'$PG_BIN/pg_ctl' -D '$PGDATA_DIR/data' -m fast stop" >/dev/null 2>&1 || true
    [[ "${GENUS_E2E_KEEP_DB:-}" == "1" ]] || rm -rf "$PGDATA_DIR"
  fi
  exit $code
}
trap cleanup EXIT INT TERM

if [[ -z "${GENUS_E2E_DATABASE_URL:-}" ]]; then
  PG_BIN="$(find_pg_bin)"
  [[ -x "$PG_BIN/initdb" ]] || { echo "[e2e] No encuentro initdb/pg_ctl. Instalá Postgres o pasá GENUS_E2E_DATABASE_URL." >&2; exit 1; }
  rm -rf "$PGDATA_DIR"
  mkdir -p "$PGDATA_DIR"
  echo "$PG_PASSWORD" > "$PGDATA_DIR/pwfile"
  if [[ "$(id -u)" == "0" ]]; then chown -R postgres "$PGDATA_DIR"; fi
  as_pg_user "'$PG_BIN/initdb' -D '$PGDATA_DIR/data' -U genus --auth=password --pwfile='$PGDATA_DIR/pwfile'" >/dev/null
  as_pg_user "'$PG_BIN/pg_ctl' -D '$PGDATA_DIR/data' -l '$PGDATA_DIR/pg.log' -w -o \"-p $PG_PORT -k '$PGDATA_DIR' -c listen_addresses=127.0.0.1\" start" >/dev/null
  STARTED_PG=1
  as_pg_user "PGPASSWORD='$PG_PASSWORD' '$PG_BIN/psql' -q -h 127.0.0.1 -p $PG_PORT -U genus -d postgres -c 'create database genus_e2e'"
  # El host DEBE ser "localhost": el driver Neon arma wss://localhost/v2 (puerto 443, el proxy).
  export GENUS_E2E_DATABASE_URL="postgres://genus:${PG_PASSWORD}@localhost/genus_e2e"
  echo "[e2e] Postgres descartable en 127.0.0.1:$PG_PORT ($PGDATA_DIR)"
fi
export GENUS_E2E_CONFIRM_DISPOSABLE_DB=yes
export GENUS_E2E_BASE_URL="http://localhost:$PORT"
if [[ -z "${GENUS_E2E_CHROMIUM_PATH:-}" && -x /opt/pw-browsers/chromium ]]; then export GENUS_E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium; fi

CERT_DIR="$STATE_DIR/certs"
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# Nunca probar contra un servidor/proxy que no levantó este script (p. ej. uno viejo apuntando a otra base).
for p in "$PORT" 443; do
  if port_busy "$p"; then echo "[e2e] ABORTADO: el puerto $p ya está en uso. Cerrá ese proceso y reintentá." >&2; exit 1; fi
done

GENUS_E2E_SYSTEM_CA="${NODE_EXTRA_CA_CERTS:-}" setsid node scripts/e2e/local-pg-wsproxy.mjs --cert-dir "$CERT_DIR" --pg-port "$PG_PORT" --listen-port 443 > "$STATE_DIR/wsproxy.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 50); do [[ -f "$CERT_DIR/ca-bundle.pem" ]] && grep -q "wss://" "$STATE_DIR/wsproxy.log" 2>/dev/null && break; sleep 0.2; done
grep -q "wss://" "$STATE_DIR/wsproxy.log" || { cat "$STATE_DIR/wsproxy.log" >&2; echo "[e2e] el proxy no arrancó (¿permiso para el puerto 443?)" >&2; exit 1; }
export NODE_EXTRA_CA_CERTS="$CERT_DIR/ca-bundle.pem"

node scripts/e2e/setup-e2e-db.mjs

XLSX="${GENUS_SEMANAS_FIXTURE_XLSX:-$FRONTEND_DIR/../SEMANAS 2026.xlsx}"
[[ -f "$XLSX" ]] || { echo "[e2e] No encuentro la copia local: $XLSX" >&2; exit 1; }
# La app ve SOLO la base de prueba y la copia local del libro: nada de credenciales Google ni variables de producción.
setsid env -i PATH="$PATH" HOME="${HOME:-/root}" NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA_CERTS" \
  NO_PROXY="localhost,127.0.0.1" NODE_ENV=development \
  DATABASE_URL="$GENUS_E2E_DATABASE_URL" GENUS_AUTH_BACKEND=neon \
  GENUS_PLANNING_SOURCE=native NEXT_PUBLIC_GENUS_PLANNING_SOURCE=native \
  GENUS_DATA_MODE=demo NEXT_PUBLIC_GENUS_DATA_MODE=demo NEXT_TELEMETRY_DISABLED=1 \
  GENUS_SEMANAS_FIXTURE_XLSX="$XLSX" SEMANAS_TODAY_OVERRIDE=2026-05-06 \
  npx next dev -H 127.0.0.1 -p "$PORT" > "$STATE_DIR/next-mi-trabajo.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 200); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/login" && break; sleep 0.5; done
GENUS_E2E_BASE_URL="http://localhost:$PORT" node scripts/e2e/semanas-mi-trabajo-validate.mjs
