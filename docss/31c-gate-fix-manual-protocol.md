# 31c — Protocolo manual post-fix gate (PR #52 + #53)

> **Fecha:** 2026-07-13  
> **Fixes:** líneas envasado (PlannerParser) + discovery PEDIDOS 2026

---

## 1. Líneas envasado — resultado parser local

| Métrica | Valor |
|---------|-------|
| Masivo | 213 |
| Premium | 115 |
| Con línea | 129 (L1=76, L2=30, L3=23) |
| Sin línea (legacy) | 199 — bloques sin L1–L4 en sheet |
| Sin línea inesperada | **0** |

Los bloques legacy (semanas 1–15 aprox.) no definen L1/L2/L3 en `ACONDICIONAMIENTO`; es geometría real del sheet, no bug del parser.

---

## 2. Flujo A manual — Sheets → Genus OS

### Setup

| Campo | Valor |
|-------|-------|
| Archivo | SEMANAS 2026 |
| Pestaña | ELABORACION |
| Celda | **H8** |
| Valor actual | 95KG |
| Edición | 96KG (restaurar a 95KG después) |
| Marker | `GENUS-TEST-HHMM` |

### Navegadores abiertos antes de editar

1. **Cristian** — `/mi-trabajo` → Elaboración → Cristian
2. **Producción** — Agustina
3. (Opcional) **Dirección**

### Medición

```bash
export BASE_URL="https://<preview-url>"
export VALIDATION_MARKER="GENUS-TEST-$(date +%H%M)"
node frontend/scripts/validate-live-sync-operativa.mjs --flow-a
```

Registrar:

| Evento | Timestamp |
|--------|-----------|
| Guardado en Sheets | T0 |
| `modifiedTime` detectado (poll 4s) | T1 |
| `snapshot.updated` SSE | T2 |
| UI Cristian sin F5 | T3 |
| UI Producción sin F5 | T4 |

**Gate:** T3−T0 y T4−T0 entre 2–5 s.

---

## 3. Prueba multi-instancia

### Sesiones

| Sesión | Usuario | Sector | Modo |
|--------|---------|--------|------|
| A | Francisco | Envasado Masivo | Normal |
| B | Agustina | Producción | Incógnito / otro dispositivo |
| C (opc.) | Santiago | Calidad | Tercera sesión |

### Protocolo

1. Francisco: `Terminadas=300` en primer ítem visible.
2. Sin F5 en B: verificar columna Terminadas = 300.
3. Registrar latencia A→B.
4. Francisco: **Entregar a Calidad**.
5. Santiago (C): verificar ítem en bandeja Calidad sin F5.

### Si falla (estado in-memory entre lambdas)

Documentar:

- Latencia medida
- ¿POST 200 pero SSE sin evento?
- ¿`operationalOverlay.revision` incrementa en B?
- Request IDs / `x-vercel-id` de POST vs SSE

**No implementar KV** hasta evidencia. Solución mínima propuesta: sticky sessions o externalizar solo `ServerOperationalState` (fuera de scope actual).

### Simulación API (dos clientes independientes)

```bash
# Sesión A — POST
curl -X POST "$BASE_URL/api/v1/live-sync/operations" \
  -H "x-vercel-protection-bypass: $BYPASS" \
  -H "Content-Type: application/json" \
  -d '{"action":"save_progress","itemId":"...","sector":"ENVASADO_MASIVO","finishedQty":"300","observation":"MULTI-TEST","updatedBy":"Francisco"}'

# Sesión B — GET inmediato (otro terminal, sin cookie compartida)
curl "$BASE_URL/api/v1/work-items?sector=PRODUCCION" \
  -H "x-vercel-protection-bypass: $BYPASS"
```

---

## 4. PEDIDOS 2026 — verificación post-deploy

```bash
curl "$BASE_URL/api/v1/drive/refresh?scope=all" -H "x-vercel-protection-bypass: $BYPASS"
```

Confirmar `criticalSheets.pedidos_2026` presente.

Si sigue ausente: revisar mime (xlsx vs Google Sheet) y nombre en Drive. Bloqueo externo documentado en `31d-pedidos-discovery.md`.
