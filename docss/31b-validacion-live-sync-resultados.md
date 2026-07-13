# 31b — Resultados validación Live Sync (PR #53)

> **Fecha:** 2026-07-13 13:05 UTC  
> **Preview:** https://aplicacion-genus-git-cursor-l-9f5595-santizunich-2879s-projects.vercel.app  
> **Commit:** `1af6d7605963d0545e8f4b38cdec0d657edb7cd8`  
> **Deploy Vercel:** SUCCESS (12:55 UTC)

---

## Veredicto gate

| Criterio | Resultado |
|----------|-----------|
| 1. Sheets → Genus OS sin F5 | **NO EVALUADO** — acceso bloqueado |
| 2. Genus OS → otros sectores sin F5 | **NO EVALUADO** — acceso bloqueado |
| 3. Datos reales visibles | **NO EVALUADO** |
| 4. Sin duplicados ni retrocesos | **NO EVALUADO** |
| 5. Experiencia suficientemente rápida | **NO EVALUADO** |

### Gate PR #53: **FAIL** (bloqueo de acceso, no fallo funcional confirmado)

**Causa:** Preview protegido con **Vercel Deployment Protection (SSO)**. El agente cloud no dispone de `VERCEL_AUTOMATION_BYPASS_SECRET`.

**No se implementó Redis/KV/webhooks** — conforme instrucción.

---

## Tabla final de validación

| Flujo | Usuario | Dato modificado | Origen del cambio | Destino | Hora inicio | Hora aparición | Latencia | PASS/FAIL | Observaciones |
|-------|---------|-----------------|-------------------|---------|-------------|----------------|----------|-----------|---------------|
| ACCESO | — | env-check | Preview URL | API | 2026-07-13T13:05:06Z | — | 111ms | **FAIL** | Vercel SSO redirect — sin bypass |
| A | Francisco | SEMANAS (producto/cantidad) | Google Sheets | Genus OS | — | — | — | **SKIP** | Requiere bypass + edición manual |
| A | Francisco | Envasado Masivo | SEMANAS | API Masivo | — | — | — | **SKIP** | Idem |
| A | Belén / Premium | Envasado Premium | SEMANAS | API Premium | — | — | — | **SKIP** | Idem |
| A | Cristian/Nicolás | Elaboración | SEMANAS | API Elaboración | — | — | — | **SKIP** | Idem |
| B1 | Francisco | Terminadas=300 | Genus OS | Francisco | — | — | — | **SKIP** | API inaccesible |
| B1 | Agustina | Terminadas=300 | Francisco | Producción | — | — | — | **SKIP** | Idem |
| B1 | Dirección | Terminadas=300 | Francisco | Dirección | — | — | — | **SKIP** | Idem |
| B2 | Francisco | Entregar Calidad | Genus OS | revision | — | — | — | **SKIP** | Idem |
| B2 | Santiago | Entrega | Francisco | Calidad | — | — | — | **SKIP** | Idem |
| B2 | Agustina | Entrega | Francisco | Producción | — | — | — | **SKIP** | Idem |
| B2 | Dirección | Entrega | Francisco | Dirección | — | — | — | **SKIP** | Idem |
| B3 | Santiago | Aprobar/Rechazar | Calidad | Producción+Dirección | — | — | — | **SKIP** | Idem |
| CARGA | Francisco | cold/warm | /mi-trabajo | ENVASADO_MASIVO | — | — | — | **SKIP** | Objetivo warm <500ms no medido |
| CARGA | Agustina | cold/warm | /mi-trabajo | PRODUCCION | — | — | — | **SKIP** | Idem |
| SSE | todos | EventSource | live-sync/stream | 4 usuarios | — | — | — | **SKIP** | SSE no probado sin bypass |

---

## Errores detectados en esta ejecución

| Tipo | Detalle |
|------|---------|
| SSO | `GET /api/v1/env-check` → redirect Vercel SSO |
| SSE | No evaluado |
| Reconexiones | No evaluado |
| WorkItems duplicados | No evaluado |
| Multi-instancia Vercel | No evaluado (requiere 2 browsers + bypass) |

---

## Cómo completar la validación (Laboratorio Genus)

### 1. Obtener bypass de Vercel

En Vercel → Project → Settings → Deployment Protection → **Automation Bypass Secret**.

### 2. Flujo B + Carga + SSE (automático)

```bash
export BASE_URL="https://aplicacion-genus-git-cursor-l-9f5595-santizunich-2879s-projects.vercel.app"
export VERCEL_AUTOMATION_BYPASS_SECRET="***"

node frontend/scripts/validate-live-sync-operativa.mjs
```

### 3. Flujo A (Sheets → Genus OS)

Terminal 1 — iniciar watcher **antes** de editar SEMANAS:

```bash
export VALIDATION_MARKER="GENUS-TEST-$(date +%H%M)"
node frontend/scripts/validate-live-sync-operativa.mjs --flow-a
```

Terminal 2 — editar celda identificable en **SEMANAS 2026** (producto, cantidad, línea u observación con el marker).

Repetir para: Envasado Masivo, Premium, Elaboración Cristian/Nicolás.

### 4. Flujo B manual (4 browsers, sin F5)

Abrir simultáneamente con logins del doc `31-validacion-live-sync-operativa.md`:

- `masivo@` (Francisco)
- `produccion@` (Agustina)
- `calidad@` (Santiago)
- `direccion@` (Dirección)

Ejecutar casos 1–3 del protocolo y anotar latencias visuales.

---

## Lo que sí pasó en CI

| Check | Resultado |
|-------|-----------|
| Vercel deploy PR #53 | SUCCESS |
| Tests unitarios | 88 passing |
| Build Next.js | OK |

**Tests/build no aprueban el gate operativo** — solo validación en preview con datos reales.

---

## Próximo paso recomendado

1. Compartir `VERCEL_AUTOMATION_BYPASS_SECRET` al agente **o** ejecutar el script localmente desde una máquina con acceso al preview.
2. Completar tabla con PASS/FAIL reales.
3. Solo aprobar PR #53 si los 5 criterios del gate pasan.
4. Si falla por multi-instancia Vercel, **documentar evidencia** antes de evaluar KV — no implementar automáticamente.
