# Genus OS — Production Readiness Audit

> Fecha: 2026-07-30  
> Rama: `claude/genus-os-operational-ui` · PR #60  
> Base visual: Industrial Glass Night (`1f9fcd2` + commits de densidad/IDs)  
> Alcance: **READ-ONLY** + correcciones de código sin decisión empresarial  
> **merge=false · Production=false · migraciones no aplicadas · 0014 no aplicada**

---

## 1. Resumen ejecutivo

El Preview de Genus OS **no está autorizado para implementación empresarial todavía**.

Hallazgos estructurales:

| Severidad | Tema | Estado |
|---|---|---|
| **P0** | Identidad API forgeable (`x-genus-actor-email` / localStorage mock) | **Pendiente — requiere decisión / auth real** |
| **P0** | Contraseñas demo en bundle cliente | **Pendiente — requiere decisión** |
| **P1** | Persistencia mixta (Neon + localStorage + memoria Live Sync) | **Pendiente — plan de convergencia** |
| **P1** | Densidad/legibilidad tablas al 100% | **Corregido en código (este PR)** |
| **P2** | IDs OE/OA demasiado largos en UI | **Corregido (display-only)** |
| **P2** | 0014 diferida | **Intencional** |
| **P3** | Registros `TEST_*` en Preview | **Inventario — no borrar sin autorización** |

---

## 2. Tabla P0 / P1 / P2 / P3

### P0 — Bloqueante (antes de uso real en planta)

| ID | Hallazgo | Evidencia | Acción |
|---|---|---|---|
| P0-1 | APIs confían en headers `x-genus-actor-email` / sector sin sesión de servidor | `lib/orders/actor.ts`, `lib/inventory/http.ts`, `lib/planning/actor.ts` | Diseñar auth server-side (cookie/JWT). **No cambiar en esta tarea.** |
| P0-2 | Sesión mock en `localStorage` (`genus_os_auth_session`) falsificable | `mock-auth-adapter.ts`, `auth-session-storage.ts` | Reemplazar por sesión firmada. |
| P0-3 | Creamy chat acepta `actorSectorId` del body sin actor headers | `assistant/chat/route.ts` | Ligar a sesión autenticada. |
| P0-4 | Contraseñas demo en fuente/bundle | `mock-preview-users.ts` | Sacar del cliente; secrets server-only o IdP. |

### P1 — Crítico

| ID | Hallazgo | Evidencia | Acción |
|---|---|---|---|
| P1-1 | Work items / deliveries / progress / graneles / notificaciones aún localStorage o memoria | `manual-work-items-repository.ts`, `delivery-repository.ts`, `operational-store.ts`, `graneles-repository.ts`, `server-operational-state.ts` | Migrar a Neon con plan por dominio. |
| P1-2 | Live Sync state in-process (`Map`) — se pierde en cold start / multi-instancia | `server-operational-state.ts` | Persistencia durable + invalidación. |
| P1-3 | Densidad insuficiente a 1366/1440 (columnas de más, headers cortados) | Tablas MP/OE/OA | **Corregido**: tokens `--os-density-*`, collapse `2xl`, clamp 2 líneas. |
| P1-4 | Posible filtrado de errores técnicos al UI (`e.message` crudo) | Varias vistas operativas | Humanizar mensajes; checklist en siguientes sprints. |

### P2 — Importante

| ID | Hallazgo | Evidencia | Acción |
|---|---|---|---|
| P2-1 | IDs `OE-2026-######` largos en listados/notificaciones | Listados OE/OA, ME, Calidad | **Corregido**: `formatOperationalIdCompact` (tooltip = full). |
| P2-2 | Migración `0014` diferida | `migrate-if-database.mjs` + `APPLY_MIGRATION_0014` | Mantener diferida hasta autorización. |
| P2-3 | Dual-write local + live-sync | deliveries / progress | Documentar fuente de verdad por módulo. |
| P2-4 | Sidebar ancho excesivo restaba espacio a tablas | `--os-sidebar-width: 16rem` | **Ajustado** a `14.5rem`. |

### P3 — Mejora

| ID | Hallazgo | Acción |
|---|---|---|
| P3-1 | Cards operativas en móvil para más módulos | Extender patrón graneles/codificado |
| P3-2 | Inventario `TEST_*` | Limpieza controlada con autorización |
| P3-3 | `colors.ts` aún documenta hex claros de Glass Day | Actualizar docs de tokens |
| P3-4 | Invariante fórmulas 842/784 solo en CLI/smoke | Mantener como regresión; no tocar datos |

---

## 3. Auditoría técnica (estado)

| Check | Resultado |
|---|---|
| Vitest | Ejecutar en CI local post-cambios (ver entrega) |
| Build | Ejecutar post-cambios |
| Typecheck | Errores preexistentes en fixtures de test (no en archivos dens/IDs) |
| Lint | Preexistentes `set-state-in-effect` en combobox/remitos |
| Portales tema Night | Dialog/Drawer/Combobox en `.design-preview-root` (SHA Night) |
| Overflow | Contrato `os-no-x-scroll` + `scrollWidth <= clientWidth` |
| Auth forge | **Confirmado P0** |
| 0014 | **No aplicada** (gate) |
| Fórmulas | **842/784** — sin diffs en `lib/formulas/**` |

---

## 4. Auditoría funcional por sector

Estado de cobertura E2E en esta pasada:

| Flujo | Estado |
|---|---|
| Densidad visual transversal (MP, OE/OA, Calidad, shell) | Validar en Preview al 100% |
| IDs compactos en listados/notificaciones/ME | Cubierto por unit tests + wiring UI |
| E2E completo planta (asignar → remito → anulación) | **Parcial histórico en smokes previos**; re-ejecutar en Preview de este SHA |
| Doble clic / idempotencia / timeouts | **Pendiente campaña dedicada** (P1 residual) |
| Blob/Drive fallos | Parcial en smokes 0008/0009 |

No se afirma “cero errores”. Los P0 de autenticación impiden certificación empresarial.

---

## 5. Inventario `TEST_*` (sin borrar)

En capturas y smokes previos del Preview aparecen numerosos registros `TEST_*` (órdenes, remitos, stock).

| Ítem | Estado |
|---|---|
| Borrado | **No ejecutado** (requiere autorización explícita) |
| Propuesta | Script dry-run que liste tablas + FKs + conteos; cleanup por `created_by` / prefijo `TEST_` en ventana de Preview; backup Neon antes |
| Riesgo | Borrar sin mapa de FKs puede dejar huérfanos en movimientos/remitos |

**Acción pedida al owner:** autorizar inventario SQL exacto + cleanup en Preview únicamente.

---

## 6. Persistencia por módulo (fuente de verdad)

| Módulo | Persistencia actual |
|---|---|
| Orders OE/OA (API) | Neon (cuando `DATABASE_URL`) |
| Inventory MP/ME | Neon |
| Remitos / COA blob | Neon + Blob |
| Fórmulas | Neon (+ Drive sync) |
| Deliveries / progress / quality overlay | localStorage + Live Sync memoria |
| Graneles | localStorage (Neon vía 0014 diferida) |
| Notificaciones | localStorage + API parcial |
| Auth sesión | localStorage mock |

---

## 7. Seguridad — plan (sin implementar ahora)

1. Introducir sesión firmada (HttpOnly cookie) o IdP (Clerk/Auth0).  
2. Resolver actor **solo** desde sesión server-side.  
3. Deprecar confianza en `x-genus-actor-email` (mantener header solo como debug interno firmado).  
4. Quitar `MOCK_PREVIEW_USERS` passwords del bundle.  
5. Auditar Creamy/chat y uploads privados bajo la misma identidad.

---

## 8. Infraestructura (lectura)

| Tema | Nota |
|---|---|
| Preview vs Production | Separados; este trabajo solo Preview |
| Neon backups / restore | Verificar en consola Neon del proyecto Preview (owner) |
| Blob privado | Ya usado en COA/procedimientos; fallos deben reintentar con mensaje humano |
| Secretos | No rotar en esta tarea; no loguear tokens |
| 0014 | Gate `APPLY_MIGRATION_0014=1` — **off** |

---

## 9. Correcciones hechas en esta tarea (código)

1. Sistema `--os-density-*` + utilidades `.os-table-th/td`, `.os-cell-clamp`, `.os-mono-id`, `.os-row-actions`.  
2. `OperationalTable` soporta collapse `2xl`; celdas sin `break-all`.  
3. MP Stock/Ingresos/Compras: columnas prioritarias + headers cortos + “Más datos”.  
4. Sidebar más compacto; padding de página por tokens.  
5. `formatOperationalIdCompact` / `compactOperationalIdsInText` + tests.  
6. Wiring display en OE/OA list, editor, Calidad, ME salidas, notificaciones.

## 10. Pendiente explícito (no autorizado aquí)

- Auth real / P0-1…P0-4  
- Migración masiva localStorage → Neon  
- Aplicar 0014  
- Limpiar `TEST_*`  
- Merge / Production  

---

**Veredicto:** apto para **revisión de Preview** (densidad + IDs). **No apto** para go-live empresarial hasta resolver P0 de autenticación y plan de persistencia P1.
