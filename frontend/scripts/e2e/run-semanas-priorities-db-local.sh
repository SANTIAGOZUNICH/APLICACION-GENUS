#!/usr/bin/env bash
# Prioridades de Semanas contra un Postgres DESCARTABLE real (migraciones reales + proxy). Limpia al salir.
#
#   npm run test:e2e:semanas-priorities-db          (desde frontend/)
#
# Qué hace:
#   1. Guardas: aborta dentro de Vercel o con VERCEL_ENV/GENUS_ENV=production.
#   2. Postgres DESCARTABLE: si no se pasa GENUS_E2E_DATABASE_URL, crea un cluster nuevo en $GENUS_E2E_PGDATA
#      (por defecto /tmp/genus-e2e-pg) con initdb y lo borra al terminar.
#   3. Proxy WebSocket→Postgres (scripts/e2e/local-pg-wsproxy.mjs) en 127.0.0.1:443, porque la app usa el driver Neon.
#   4. Migraciones reales + marca de base de prueba + usuarios de prueba (scripts/e2e/setup-e2e-db.mjs).
#   5. Build de la app (en .next: reemplaza un build previo) con planificación nativa, y `next start` en 127.0.0.1:$GENUS_E2E_PORT.
#   6. Corre src/integration/plan-semanal.e2e.integration.test.ts y apaga app, proxy y Postgres.
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

PORT="${GENUS_E2E_PORT:-3100}" # (la app no se levanta; la guarda de e2e-safety exige una URL local)
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
if port_busy 443; then echo "[e2e] ABORTADO: el puerto 443 ya está en uso." >&2; exit 1; fi
GENUS_E2E_SYSTEM_CA="${NODE_EXTRA_CA_CERTS:-}" setsid node scripts/e2e/local-pg-wsproxy.mjs --cert-dir "$CERT_DIR" --pg-port "$PG_PORT" --listen-port 443 > "$STATE_DIR/wsproxy.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 50); do [[ -f "$CERT_DIR/ca-bundle.pem" ]] && grep -q "wss://" "$STATE_DIR/wsproxy.log" 2>/dev/null && break; sleep 0.2; done
grep -q "wss://" "$STATE_DIR/wsproxy.log" || { cat "$STATE_DIR/wsproxy.log" >&2; echo "[e2e] el proxy no arrancó (¿permiso para el puerto 443?)" >&2; exit 1; }
export NODE_EXTRA_CA_CERTS="$CERT_DIR/ca-bundle.pem"
node scripts/e2e/setup-e2e-db.mjs
# Secuencial: comparten la MISMA base y un test renombra temporalmente la tabla de prioridades (migración pendiente).
npx vitest run src/integration/semanas-priorities.db.integration.test.ts src/integration/semanas-links.db.integration.test.ts --no-file-parallelism --reporter=verbose
