# E2E local (navegador real + Postgres de prueba)

Pruebas end-to-end con Chromium (Playwright) contra la app real (`next build` + `next start`) y una base Postgres
**descartable** con las migraciones reales de `drizzle/`. Hoy cubre **Producción → Plan semanal**
(`src/integration/plan-semanal.e2e.integration.test.ts`, 16 escenarios).

## Correrlo

```bash
cd frontend
npm run test:e2e:plan-semanal
```

Eso solo: crea un Postgres nuevo, levanta el proxy, aplica migraciones, crea usuarios y datos de prueba, compila la
app, corre los 16 escenarios y al salir apaga todo y **borra la base**. Tarda ~2,5 min (casi todo es el build).

| Variable (opcional) | Para qué |
|---|---|
| `GENUS_E2E_SKIP_BUILD=1` | Reusar el build de `.next` de una corrida anterior del E2E |
| `GENUS_E2E_RUNS=3` | Correr el test N veces sobre la misma base (prueba que los datos se regeneran) |
| `GENUS_E2E_KEEP_DB=1` | No borrar el cluster al terminar (queda en `GENUS_E2E_PGDATA`) |
| `GENUS_E2E_PGDATA` | Carpeta del cluster descartable (default `/tmp/genus-e2e-pg`) |
| `GENUS_E2E_PORT`, `GENUS_E2E_PG_PORT` | Puertos de la app (3100) y de Postgres (55432) |
| `GENUS_E2E_DATABASE_URL` | Usar una base de prueba ya levantada en vez de crear un cluster (ver «Seguridad») |
| `GENUS_E2E_CHROMIUM_PATH` | Chromium a usar si la versión de Playwright no coincide con la instalada |

**Requisitos:** Node 20+, `npm ci`, binarios de Postgres (`initdb`, `pg_ctl`, `psql`; p. ej. `apt install postgresql`),
`openssl`, Chromium de Playwright, y permiso para escuchar en **127.0.0.1:443** (root o `CAP_NET_BIND_SERVICE`).

¿Por qué el puerto 443? La app usa el driver `@neondatabase/serverless`, que se conecta por `wss://<host>/v2`.
`local-pg-wsproxy.mjs` hace de ese endpoint para un Postgres local, así **la app corre sin ningún cambio** de código.

## Seguridad: nunca toca Production

Cinco barreras independientes (`e2e-safety.mjs`, con tests en `src/integration/e2e-safety.test.ts`):

1. Aborta si corre dentro de Vercel (`VERCEL`, `VERCEL_ENV`) o con `GENUS_ENV`/`NODE_ENV=production`.
2. Exige `GENUS_E2E_CONFIRM_DISPOSABLE_DB=yes` (el script lo pone solo para la base que él mismo crea).
3. La base tiene que ser **local** (`localhost`/`127.0.0.1`). Una remota exige además `GENUS_E2E_ALLOW_REMOTE_DB=yes`
   y está pensada solo para una **rama Neon descartable**.
4. La app bajo prueba tiene que ser local (`http://localhost:PUERTO`), nunca un deploy.
5. **Marca de base de prueba:** el setup crea la tabla `genus_e2e_marker` **solo si la base está vacía**. Una base con
   tablas y sin marca (Production, Preview o cualquier base real) se rechaza sin escribir nada, y el test vuelve a
   verificar la marca antes de tocar datos.

Además la app del E2E arranca con un entorno limpio (`env -i`): solo ve la base de prueba, sin credenciales de Google
ni otras variables heredadas, y el write-back a Google queda apagado (flags sin definir).

En `npm test` / CI normal el E2E **se salta solo** (no hay `GENUS_E2E_*`): no hace falta Postgres para el build.

## Qué verifica (Plan semanal)

1. La planilla aparece en el detalle del día.
2. Editar Cantidad guarda en la base y sube la versión.
3. Recargar la página muestra el valor guardado.
4. Copiar un rango (Cliente..Cantidad) deja TSV en el portapapeles.
5. Pegar 2 celdas (Cantidad + Unidad) guarda ambas.
6. Pegar en Observación guarda.
7. Un trabajo con decisión de Calidad muestra candados en todas sus celdas.
8. Escribir sobre una celda protegida no cambia la base y muestra el motivo.
9. Pegar sobre una protegida muestra «Celdas protegidas — NO se modifican».
10. Después de pegar, la base del trabajo protegido sigue intacta.
11. La columna Línea es de solo lectura.
12. `PATCH /api/v1/work-items/cells` directo a una celda protegida → 403 `PROTECTED`.
13. Versión vieja → `CONFLICT`, sin escribir.
14. Un trabajo de fecha pasada pide motivo y no deja aplicar sin él.
15. Con motivo se guarda y el motivo queda en `operational_events`.
16. Otro sector (Envasado) ve todo bloqueado y no puede escribir.

Datos de prueba: trabajos `E2E-*` creados por la API de planificación con usuarios `e2e-*@genus.test`. Las fechas se
calculan en cada corrida (lunes a viernes) y el reloj del navegador se fija a ese día, así funciona cualquier día.

## Problemas comunes

- **«el proxy no arrancó»** → falta permiso para el puerto 443 (correr como root o `sudo setcap cap_net_bind_service=+ep $(which node)`).
- **Playwright pide `npx playwright install`** → definir `GENUS_E2E_CHROMIUM_PATH` con un Chromium instalado.
- **Build sin memoria** → `NODE_OPTIONS=--max-old-space-size=8192 npm run test:e2e:plan-semanal`.
- Logs de la última corrida: `.e2e-local/` (`build.log`, `next.log`, `wsproxy.log`; ignorado por git).
