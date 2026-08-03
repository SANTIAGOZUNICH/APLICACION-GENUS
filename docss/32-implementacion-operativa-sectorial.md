# Genus OS — Implementación operativa por sector

**Fecha:** 2026-07-20  
**Repositorio:** `SANTIAGOZUNICH/APLICACION-GENUS`  
**Rama:** `claude/genus-os-operational-ui`  
**Base:** `main` @ `680ede82166c07fcb3bb77269191884714024aef`  
**Estado:** Beta operativa sectorial — Preview, no Production

---

## Resumen

Entrega Beta del login sectorial y los módulos operativos por sector de planta, aplicada sobre la arquitectura existente (APIs, adapters Drive/Sheets, Live Sync, Planning, Workflow Engine y Role Engine) sin reescribirla.

**Alcance de esta entrega**

- Login split-screen con exactamente **6 accesos** de planta.
- Vistas operativas por sector: Elaboración, Envasado Masivo, Envasado Premium, Calidad, Materias Primas y Producción.
- Shell (sidebar, header, notificaciones, avatar).
- Corrección RBAC de decisión en Calidad (ver sección «Corrección RBAC»).

**No es**

- Un RBAC server-side completo.
- Sincronización multi-dispositivo de datos demo.
- Publicación a Production.

---

## Seis accesos activos

| Sector | Correo | Contraseña | `sectorId` |
|---|---|---|---|
| Elaboración | `elaboracion@laboratoriogenus.com.ar` | `elaboracion123` | `ELABORACION` |
| Producción | `produccion@laboratoriogenus.com.ar` | `produccion123` | `PRODUCCION` |
| Envasado Masivo | `emasivo@laboratoriogenus.com.ar` | `emasivo123` | `ENVASADO_MASIVO` |
| Envasado Premium | `epremium@laboratoriogenus.com.ar` | `epremium123` | `ENVASADO_PREMIUM` |
| Calidad | `calidad@laboratoriogenus.com.ar` | `calidad123` | `CALIDAD` |
| Materias Primas | `mp@laboratoriogenus.com.ar` | `mp123` | `MATERIA_PRIMA` |

Fuente: `frontend/src/features/os/auth/lib/mock-preview-users.ts`.

**No autentican** (retirados o nunca activos en este login):

- `deposito@laboratoriogenus.com.ar`
- `direccion@laboratoriogenus.com.ar`
- `masivo@laboratoriogenus.com.ar`
- `premium@laboratoriogenus.com.ar`

Las `SectorDefinition` de Depósito y Dirección en el Role Engine se conservan; solo se retiraron del mock de login.

---

## Funciones reales vs. demo

### Reales (infraestructura existente, sin modificar adapters/API core)

| Función | Fuente |
|---|---|
| WorkItems de Elaboración / Envasado / Producción (`GENUS_DATA_MODE=real`) | `useOperationalPlan` → `/api/v1/work-items` → adapters Drive/Sheets |
| QualityItems transferidos desde planta | Pipeline existente + `OperationalStore` |
| Guardar avance / Finalizar → Calidad | `saveWorkProgress` / `markWorkFinished` → Live Sync client |
| Aprobar / Rechazar (solo sesión CALIDAD) | `approveQualityItem` / `rejectQualityItem` → `postQualityDecision` |
| Navegación y experiencia por sector | Role Engine (`lib/role-engine/**`) extendido aditivamente |
| Historial | `completionEvents` + `qualityItems` |
| Planning nativo, Live Sync, Workflow Engine, `/api/v1/**` | Sin cambios estructurales |

### Demo — persisten en **localStorage** (`@mock-temp`)

Estas funciones **no sincronizan entre dispositivos** ni entre navegadores. Limpiar datos del sitio las borra. La entrega es **Beta**.

| Módulo | Adapter | Qué guarda |
|---|---|---|
| Documentos OE/OA | `order-documents-repository.ts` | Archivo (base64), autor, fecha, asociación |
| Stock Materias Primas | `materia-prima-repository.ts` | Código, nombre, lote, stock, unidad, vencimiento |
| Fórmulas / BOM | `formula-repository.ts` | 3 productos con fórmula; resto estimación marcada en UI |
| Checklist preparación MP | `mp-preparation-store.ts` | Qué MP se preparó, quién, cuándo |
| Trabajos de «Asignar trabajos» | `manual-work-items-repository.ts` | WorkItem completo + asignación |
| Notificaciones | `notifications-store.ts` | Notificaciones por sector destinatario |
| Preferencia «Línea opcional» | hook en `envasado-operational-view.tsx` | Boolean de UI (no dato de negocio) |

---

## Corrección RBAC — decisión de Calidad

### Problema

Producción puede navegar a «Ver sector → Calidad» montando el mismo `CalidadOperationalView`. Antes, los botones Aprobar/Rechazar eran los mismos que para Calidad: el Role Engine resolvía *pantalla*, no *permiso de acción* dentro de una vista compartida.

### Regla aplicada

Únicamente una sesión cuyo `sectorId` sea `CALIDAD` puede:

- Aprobar
- Rechazar
- Guardar decisiones de Calidad

Producción (y cualquier otro sector) puede **consultar** pendientes, aprobados, rechazados y detalles en **solo lectura**.

### Defensa (no solo ocultar botones)

1. **UI** (`calidad-operational-view.tsx`): sin botones Aprobar/Rechazar si `sectorId !== CALIDAD`; observación read-only; banner de consulta; label «Ver detalle».
2. **Handlers**: verifican `canDecideQuality(sectorId)` antes de llamar al store; muestran mensaje claro si se intenta decidir sin permiso.
3. **Store / action pipeline** (`approveQualityItem` / `rejectQualityItem`): exigen `actorSectorId` y pasan por `gateQualityDecision()`; si falla, **no** mutan localStorage ni llaman a la API.
4. **API Live Sync** (`/api/v1/live-sync/operations`): si el body trae `actorSectorId` distinto de `CALIDAD`, responde `403 QUALITY_DECISION_FORBIDDEN`.

No es un RBAC server-side de identidad completo (sigue documentado como futuro en `docss/29-identity-access.md`); es una defensa efectiva de acción en cliente + gate opcional en el endpoint.

### Tests

- `frontend/src/features/os/operational/lib/quality-decision-rbac.test.ts` — regla, gate y pipeline (CALIDAD sí / PRODUCCION y otros no mutan).
- Credenciales de los 6 accesos y rechazo de los 4 antiguos en `auth-contracts.test.ts`.

---

## Commits de la rama

1. `feat(os): Genus OS operativo — login sectorial, 6 accesos y módulos por sector`
2. `fix(os): correcciones de verificación — credenciales, RBAC y bug de merge de trabajos manuales`
3. `fix(os): RBAC de decisión en Calidad + documentación operativa` (este seguimiento)

Archivos del parche original: **46** (19 nuevos, 27 modificados). El commit de seguimiento agrega la corrección RBAC, tests y este documento.

---

## Limitaciones demo pendientes

1. **localStorage** para MP, documentos OE/OA, asignación manual y notificaciones — un solo navegador; no hay sync entre usuarios.
2. **Asignar trabajos** no escribe a Sheets/planning real: otro dispositivo no verá lo asignado.
3. **Fórmulas estimadas** para productos sin BOM cargado — marcadas en UI; no son dato de calidad.
4. **RBAC server-side de identidad** completo sigue siendo trabajo futuro; esta entrega cierra el gap de *decisión de Calidad* en el pipeline cliente.
5. Errores de lint/TS preexistentes en `main` (4 errores hooks + 2 en tests ajenos) no se tocáron salvo lo necesario para esta entrega.

---

## Verificación recomendada

Dentro de `/frontend`:

```bash
npm ci
npm test
npm run build
npm run lint
npx tsc --noEmit
```

Checklist manual: login de los 6 sectores, logout, Elaboración Nicolás/Cristian, avance/finalización, Masivo 4 líneas, Premium 2 líneas, Calidad aprobar/rechazar, Producción consultando Calidad **sin poder decidir**, pegado stock Excel, Control MP, asignación desde Producción, notificaciones, persistencia tras reload, responsive tablet.
