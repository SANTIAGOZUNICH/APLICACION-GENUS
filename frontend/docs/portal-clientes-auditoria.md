# Portal de Clientes — auditoría, autenticación y seguimiento en tiempo real (PR 2)

Alcance auditado: `src/lib/portal/*`, `src/app/entregas/**`, `src/app/api/v1/portal-admin`, `src/features/portal/*`, vista interna `portal-clientes-view`, migraciones 0052–0055.

## 1. Hallazgos

| # | Hallazgo | Severidad | Estado |
|---|----------|-----------|--------|
| 1 | **Datos simulados**: solo existen en el modo demostración (`demo-data.ts`, cookie `genus_portal_demo` separada, token de un solo uso emitido a personal interno). Ningún dato ficticio llega a un cliente real. | Informativo | Sin cambios (verificado) |
| 2 | **Datos reales**: el portal lee `work_items`, `production_pedidos`, entregas (`work_item_deliveries`/`_lines`) y la confirmación explícita «Listo para entregar» (`portal_availability_marks`). No hay cargas manuales. | Informativo | Sin cambios |
| 3 | **Aislamiento**: el cliente sale SIEMPRE de la sesión (`session.clientId`), nunca de parámetros; los trabajos se vinculan por igualdad exacta de alias (un nombre pertenece a un solo cliente por índice único); los ids que viajan son HMAC opacos por cliente. Se verificó con dos clientes (integración + E2E) incluyendo `?clientId=` ajeno. | Informativo | Verificado + tests |
| 4 | Un pedido **recién recibido** (sin trabajos) o con **todos sus trabajos cancelados** no aparecía: el cliente no veía nada. | Media | **Corregido**: renglones «Pedido recibido» y «Cancelado» |
| 5 | Los productos **cancelados desaparecían** en silencio de un pedido de varios productos. | Media | **Corregido**: figuran «Cancelado» y no bloquean el estado del pedido |
| 6 | Solo 4 etapas técnicas (Elaboración/Envasado/Listo/Entregado); sin «Pedido recibido» ni «Pedido programado»; no había vista de **pedido** (cada producto era una tarjeta suelta). | Media | **Corregido**: 6 estados comerciales + bloque de pedido con progreso por producto |
| 7 | `toClientPayload` era una *lista negra* (solo quitaba `ready`): un campo nuevo en las filas operativas habría llegado al navegador. | Media | **Corregido**: serialización por **lista blanca** campo por campo (`overview.ts`), con test de contaminación |
| 8 | Acceso solo por código de cliente + correo autorizado + código temporal: obligaba a tener correo. | Funcional | **Agregado** usuario + contraseña (el acceso por correo sigue igual) |
| 9 | `resolvePortalSession` exigía un correo autorizado vigente: una sesión sin correo no podía existir. | Funcional | **Corregido** (LEFT JOIN a `portal_users`; se revalida usuario y cliente en cada solicitud) |
| 10 | Actualización cada 60 s con `setInterval` (seguía en segundo plano, descargaba todo en cada vuelta). | Media | **Corregido**: `useAutoSync` de GENUS OS (15 s, pausado en segundo plano, retoma al volver) + ETag/`If-None-Match` → 304 sin cuerpo; re-render solo si cambió |
| 11 | `findClientWorkIds` trae TODOS los trabajos vivos (id, cliente) y filtra por alias en memoria en cada solicitud. Con polling multiplica la carga. | Baja | **Documentado** (el filtro usa `clientKey` en JS; pasarlo a SQL requiere una columna normalizada). Mitigado por el 304 y el pausado en segundo plano; candidato a columna/índice `client_key` en `work_items`. |
| 12 | Cookie de sesión: `HttpOnly`, `SameSite=Lax`, `Secure` en producción, `Path=/entregas`, 12 h, token opaco de 256 bits con solo el hash en base; CSRF por `Origin`. | Informativo | Correcto (sin cambios) |
| 13 | Una transferencia entre sectores (Elaboración → Envasado → Codificado) NO se cuenta como entrega: solo las entregas finales registradas. «Listo para entregar» exige la confirmación explícita del último sector. | Informativo | Correcto; es la señal que usa la derivación |
| 14 | Existentes en `main` (no introducidos por este PR): el test `migration-reconcile` falla porque `0068_me_load_order` no está en `ALLOWED_RECONCILE_MIGRATIONS`; el test de integración `portal-disponibilidad` n.º 18 (huella de integridad) falla en `main`. | Aviso | No se tocaron (fuera de alcance); reportados |

## 2. Cambios

### Usuario y contraseña
- Migración **0096_portal_usuarios** (aditiva, reconcile-safe): tabla `portal_users` (usuario único normalizado, correo opcional, hash bcrypt, estado, intentos fallidos, `locked_until`, último acceso, cambio obligatorio), `portal_sessions.user_id` y `portal_sessions.email` pasa a admitir NULL.
- Se reutiliza el hash de GENUS OS (`@/lib/auth/password`, bcrypt costo 12). Contraseñas nunca en texto plano ni en auditoría/logs.
- Realm de autenticación propio del portal (cookie `genus_portal_session`, tablas `portal_*`): se **extendió** de forma aditiva en vez de mezclarlo con `genus_session`, que identifica personal interno con sector/rol; así un cliente jamás obtiene una sesión interna.
- Fuerza bruta: límite persistente por IP y por usuario (`portal_rate_limits`) + bloqueo progresivo persistente por usuario (5 fallos → 5 min, 8 → 30 min, 12 → 4 h; se olvidan tras 24 h sin fallos). Sin enumeración: mismo mensaje y costo (hash señuelo) para usuario inexistente, desactivado, mala clave o cliente suspendido; el bloqueo responde igual que el límite (429).
- Sesiones: se revocan al desactivar, dar de baja, restablecer o cambiar la contraseña, y al suspender/deshabilitar al cliente. Contraseña temporal (alta o restablecimiento) obliga a elegir una propia antes de ver datos (`PASSWORD_CHANGE_REQUIRED`, 403).
- Administración (`/api/v1/portal-admin`, `view=users` y acciones `create_user`, `activate_user`, `deactivate_user`, `reset_user_password`, `update_user`, `remove_user`): **solo Dirección y Administración** (validado en el servicio). Panel en «Portal de Clientes» (Administración lo ve en su barra lateral con solo la sección de usuarios). Muestra último acceso, bloqueo, sesiones vivas; la contraseña temporal se muestra una sola vez.

### Estados comerciales (`order-status.ts`, funciones puras)
1 Pedido recibido · 2 Pedido programado · 3 En elaboración · 4 En envasado · 5 Listo para entregar · 6 Entregado.
- `deriveClientProductStatus` y `deriveClientOrderStatus`: el pedido toma el estado del producto MENOS avanzado; «Listo para entregar» solo si TODOS los productos vigentes están listos/entregados; si no, progreso por producto («Productos listos o entregados: 1 de 2»). Entregas parciales no son «Entregado». Cancelados no bloquean; pedido 100 % cancelado figura cancelado. Reproceso (rechazo de Calidad abierto) impide «Listo/Entregado» sin exponer el motivo.
- Señal de «Listo»: la confirmación explícita (`portal_availability_marks`, «Marcar listo para entregar» del último sector) — es la que ya usa el sistema; no se inventó otra.
- Seguimiento: `GET /entregas/api/overview` con ETag; el cliente consulta cada 15 s solo con la pestaña visible.

## 3. Pruebas
- Unitarias: `order-status.test.ts`, `user-rules.test.ts`, `overview.test.ts` (estados, whitelist con contaminación, pedidos recibidos/cancelados, reproceso), `migration-reconcile.test.ts`.
- Integración Postgres: `src/integration/portal-usuarios.db.integration.test.ts` (`npm run test:e2e:portal-usuarios-db`): permisos por sector, login sin correo, aislamiento entre dos clientes, revocación de sesiones, bloqueo, límite por IP, cambio obligatorio de contraseña, ETag/304, estados comerciales con datos reales.
- E2E Chromium: `scripts/e2e/portal-usuarios-validate.mjs` (`npm run test:e2e:portal-usuarios`): login, aislamiento, actualización automática sin recarga, pausa en segundo plano, desactivación en vivo, móvil 390 px.

## 4. Variables de entorno
Ninguna nueva. Se siguen usando `PORTAL_AUTH_SECRET` (recomendada; si falta se deriva de la conexión a la base), `PORTAL_PUBLIC_BASE_URL`, `PORTAL_EMAIL_MODE` (solo para el ingreso por correo).

## 5. Vínculo por ID del cliente (migración 0098) — pedido asignado que no aparecía en el portal

**Síntoma (producción):** se creó el cliente «GENUS TEST» con acceso al portal, se asignó un pedido desde Producción (formulario «Nuevo pedido») y el pedido no aparecía.

**Causa raíz (reproducida con Postgres real, `portal-vinculo.db.integration.test.ts`):** el portal vinculaba por NOMBRE y el cliente del pedido es texto libre.
1. Mayúsculas, tildes y espacios no rompen el vínculo (se normalizan), pero cualquier otra diferencia sí: «GENUS-TEST», «GENUS TEST S.A.» o «GENUSTEST» pasaban por el gancho `ensureClientIdentitySafe`, que creaba OTRO cliente «automático» con ese nombre: el pedido quedaba asignado a un cliente que nadie usa y el cliente real no lo veía.
2. Un pedido SIN trabajos solo se mostraba con estado vacío o `INGRESO`: el formulario permite elegir el estado y con `EN ELABORACIÓN`, `EN ENVASADO`, etc. el pedido quedaba invisible hasta que existiera un trabajo.
3. Los trabajos se vinculaban por el nombre del TRABAJO, no por el de su pedido: un trabajo con otro texto no seguía a su pedido.

**Solución:** `portal_clients.id` es el vínculo principal.
- `production_pedidos.portal_client_id` y `work_items.portal_client_id` (nullable, indexadas). El formulario de Pedidos ofrece un selector/autocompletado (nombre comercial + alias) que guarda el ID; si se tipea el texto, el servidor lo resuelve contra clientes y alias normalizados y vincula SOLO si es inequívoco (nombre nuevo → cliente nuevo como antes; nombre que coincide con 2+ clientes → no se vincula). El ID elegido manda aunque el texto sea otro.
- Los trabajos heredan el ID de su pedido (prevalece el del pedido); sin pedido, el del nombre resuelto. Editar otro campo del pedido conserva el ID; cambiar el cliente reasigna pedido y trabajos.
- El portal lista por ID. Los históricos sin ID se ven por nombre únicamente si apunta a UN solo cliente. Un pedido vinculado por ID y sin trabajos se muestra con su estado manual (recibido / en elaboración / en envasado; nunca «Listo» ni «Entregado», que exigen evidencia operativa), con producto, cantidad (Q), OP y fecha.
- Push y firma (ETag) usan `loadPortalOverview`: la misma asociación. La firma incluye los pedidos sin trabajos.

**Backfill de históricos (solo Dirección, bajo demanda, idempotente):** panel Dirección › Portal de Clientes › «Problemas de vinculación» muestra el reporte (se pueden vincular / ambiguos / sin coincidencia / trabajos divergentes) sin escribir nada. El botón «Vincular por ID los inequívocos» (acción `backfill_links`) escribe `portal_client_id` solo donde es NULO y el nombre apunta a un único cliente; ambiguos y sin coincidencia se reportan y NO se vinculan. Queda auditado (`VINCULO_ID_BACKFILL`).

**Pruebas:** `npm run test:e2e:portal-vinculo-db` (integración sin mocks) y `npm run test:e2e:portal-vinculo` (Chromium: panel de Dirección → formulario real de Producción → portal abierto → cambios de sector → outbox push simulada).
