# 31 — Validación operativa Live Sync (Laboratorio Genus)

> **Estado:** Protocolo de validación manual — sin mocks, sin screenshots  
> **PR:** #53 sobre #52  
> **Objetivo:** Demostrar que Genus OS se comporta como un sistema operativo vivo

---

## Principio rector

| Capa | Rol |
|------|-----|
| **Google Sheets** | Fuente oficial de **planificación** (SEMANAS, PEDIDOS, LOTES) |
| **Genus OS** | Fuente oficial del **estado operativo en tiempo real** |

La comunicación entre Producción, Calidad, Elaboración, Envasado y Dirección ocurre **dentro de Genus OS**.  
Sheets planifica; Genus OS opera en vivo.

**No agregar infraestructura** (Redis, KV, webhooks, parse incremental) hasta que este protocolo pase en preview con datos reales.

---

## Tiempos objetivo

| Métrica | Objetivo | Cómo verificar |
|---------|----------|-----------------|
| Abrir `/mi-trabajo` | < 500 ms | DevTools → Network → `work-items` (2.º request en caliente) |
| Cambio en Google Sheets → Genus OS | 2–5 s | Editar celda en SEMANAS → observar indicador **Actualizado hace Xs** |
| Acción en Genus OS → otro usuario | < 1 s | Dos browsers distintos, misma preview URL |

---

## Pre-requisitos

1. Preview Vercel con `GENUS_DATA_MODE=real` y credenciales Google OK.
2. Ejecutar una vez: `GET /api/v1/drive/refresh?scope=all`
3. Cuatro browsers (o perfiles) abiertos **sin F5 manual** durante la prueba:

| Persona | Rol | Login preview |
|---------|-----|---------------|
| **Francisco Zapata** | Envasado Masivo | `masivo@laboratoriogenus.com.ar` / `masivo123` |
| **Agustina Zunich** | Producción | `produccion@laboratoriogenus.com.ar` / `produccion123` |
| **Santiago Zunich** | Calidad | `calidad@laboratoriogenus.com.ar` / `calidad123` |
| **Dirección** | Visión planta | `direccion@laboratoriogenus.com.ar` / `direccion123` |

4. Todos en `/mi-trabajo`, indicador **En vivo** (punto verde) visible.

---

## FLUJO 1 — Google Sheets → Genus OS

### Qué validar

Si alguien modifica **SEMANAS 2026**, **PEDIDOS 2026** o **ASIGNACIÓN DE LOTES 2026**, Genus OS detecta el cambio solo. Ningún usuario presiona F5 ni “Refrescar”.

### Pasos

1. Francisco tiene abierto Envasado Masivo con una orden real visible (cliente + producto + cantidad planificada).
2. Agustina tiene abierta Producción → pestaña **Envasados**, misma orden identificable.
3. En Google Sheets **SEMANAS 2026**, pestaña **ACONDICIONAMIENTO**, modificar la celda de **cantidad planificada** de esa orden (ej. cambiar un valor en la columna del día).
4. Esperar **2–5 segundos** (poll `modifiedTime` + SSE `snapshot.updated`).
5. **Criterio de éxito:**
   - Francisco ve el nuevo valor **sin tocar la página**.
   - Agustina ve el mismo cambio en **Planif.** **sin tocar la página**.
   - El indicador muestra algo como **Actualizado hace 3s** (no “Auto-refresh 30s”).

### Variantes opcionales

- **PEDIDOS 2026:** cambiar estado comercial de un OP que matchee → enriquecimiento visible si hay match (OP no bloquea si falta).
- **LOTES 2026:** modificar RL/estado calidad → Santiago ve el lote actualizado en Calidad.

---

## FLUJO 2 — Genus OS → otros usuarios

### Caso completo (escenario Laboratorio Genus)

Usar una **orden real** visible en SEMANAS para Envasado Masivo (Francisco).

---

#### Paso 1 — Francisco abre Genus OS

Francisco (`masivo@`) entra a `/mi-trabajo`.  
Ve una fila real: cliente, producto, **Planificadas** (cantidad de SEMANAS), **Terminadas** vacía.

---

#### Paso 2 — Francisco guarda avance

Francisco escribe en **Terminadas: `300`** y pulsa **Guardar avance**.

**Criterio de éxito (< 1 s):**

| Observador | Qué debe ver |
|------------|--------------|
| **Agustina** (Producción → Envasados) | Columna **Terminadas = 300** en la misma orden |
| **Dirección** | Igual que Agustina (vista planta agregada) |
| Francisco | Terminadas = 300 (optimista local + confirmación server) |

Nadie refresca la página.

---

#### Paso 3 — Francisco entrega a Calidad

Francisco pulsa **Entregar a Calidad** en la misma orden.

**Criterio de éxito (< 1 s):**

| Observador | Qué debe ver |
|------------|--------------|
| **Santiago** (Calidad) | Nuevo ítem en bandeja (granel o salida según tipo), estado **pendiente**, origen Envasado Masivo |
| **Agustina** | Estado de la orden → **revision** / transferido |
| **Dirección** | Actividad en feed + estado actualizado |

---

#### Paso 4 — Santiago aprueba

Santiago abre el ítem recibido, opcionalmente observación, pulsa **Aprobar**.

**Criterio de éxito (< 1 s):**

| Observador | Qué debe ver |
|------------|--------------|
| **Agustina** (Producción → Aprobados) | Ítem en lista de aprobados |
| **Dirección** | Mismo cambio + actividad de aprobación |
| Santiago | Estado **aprobado** sin refrescar |

---

#### Paso 5 — Rechazo (variante)

Repetir pasos 1–3 con otra orden. Santiago pulsa **Rechazar**.

Agustina y Dirección deben ver el ítem en **Rechazados** automáticamente.

---

## Checklist de merge Live Sync

Marcar **PASS / FAIL** en preview real:

| # | Gate | PASS |
|---|------|------|
| 1 | Sheets → Genus OS en 2–5 s, sin F5 | ☐ |
| 2 | Guardar avance → Producción ve Terminadas | ☐ |
| 3 | Entregar → Calidad recibe automático | ☐ |
| 4 | Aprobar/Rechazar → Producción + Dirección | ☐ |
| 5 | Indicador **En vivo** + **Actualizado hace Xs** | ☐ |
| 6 | Sin botón Refrescar manual en UI | ☐ |
| 7 | `/mi-trabajo` < 500 ms (request caliente) | ☐ |

**Solo si los 7 pasan:** evaluar si hace falta Redis/KV/webhooks.

---

## Limitaciones conocidas (aceptadas para validación v1)

1. **Misma instancia Vercel:** dos usuarios en preview comparten el server in-memory del lambda caliente. Si el lambda está frío o hay múltiples instancias, la propagación cross-usuario puede fallar — documentar en la prueba si ocurre.
2. **Acciones operativas no escriben a Sheets aún:** el estado en vivo vive en Genus OS; Sheets sigue siendo planificación.
3. **Cold start:** la primera apertura tras deploy puede tardar > 500 ms mientras calienta el snapshot.

Estas limitaciones **no** justifican agregar Redis hasta demostrar el flujo en un entorno caliente estable.

---

## Comandos útiles

```bash
# Estado Live Sync
curl -s "$BASE/api/v1/live-sync/status" | jq

# Refrescar índice Drive (solo una vez al inicio)
curl -s "$BASE/api/v1/drive/refresh?scope=all" | jq .criticalSheets
```

---

## Filosofía para el proyecto

> Google Sheets es la fuente oficial de planificación.  
> Genus OS es la fuente oficial del estado operativo en tiempo real.

Si con la arquitectura actual (snapshot in-memory + SSE + poll `modifiedTime` 4s) la experiencia es correcta para 2 años de operación en Laboratorio Genus, **mantener el sistema simple** tiene prioridad sobre infraestructura adicional.
