# Portal de Clientes — GENUS | Portal de Clientes

URL objetivo: `https://laboratoriogenus.com.ar/entregas` (hoy `www.`; el dominio sin `www` redirige).
El portal vive **dentro de GENUS OS** (`frontend/src/app/entregas`, API en `/entregas/api/*`) y la web institucional lo publica con un *rewrite*
(repo `pagina-web-genus`, `vercel.json`). No hay proyecto Vercel nuevo, ni cambios de DNS/Cloudflare.

## Cómo entra un cliente
Código de cliente (`GEN-XXXXXX`, generado en GENUS OS) + correo autorizado + código temporal (6 dígitos, 10 min, 5 intentos, un solo uso)
o enlace seguro de un solo uso. El código solo no da acceso. Sesión de 12 h (cookie `genus_portal_session`, HttpOnly, SameSite=Lax,
`Path=/entregas`, solo hash en base), revalidada en cada request (suspender o dar de baja un correo la corta al instante).
Límites por IP/correo/código en base, pausa de 30 s entre códigos, respuestas idénticas exista o no el cliente, auditoría completa.

## De dónde salen los datos
Solo lectura de `work_items`, `production_pedidos`, entregas reales (`work_item_deliveries` / `_lines`) y eventos. Un cliente del portal se
vincula con **nombres de cliente de GENUS OS** (alias; un nombre pertenece a un solo cliente). Nada de fórmulas, MP, costos, observaciones,
usuarios internos ni ids internos: ids opacos por cliente, lista blanca de campos.
- Elaboración (10 días hábiles) → Envasado (5 días hábiles; Codificado se muestra como «finalización», nunca como entregado) → Listo para entregar → Entregado.
- «Entregado» solo con una entrega física final registrada. Los traspasos entre sectores no cuentan.
- Cuenta regresiva en días hábiles de Argentina (feriados nacionales calculados; excepciones por decreto en el panel), desde el ingreso real
  verificable a la etapa; sin fecha verificable no se inventa. Nunca negativa.
- «Listo para entregar» **nunca se infiere**: depende de la confirmación explícita («Marcar listo para entregar») de un usuario autorizado del último sector. Ver la sección siguiente.

## Listo para entregar (disponibilidad explícita)
- **Quién marca:** el sector que tiene el trabajo HOY y es el último del recorrido: Envasado Masivo o Envasado Premium (si no pasa a Codificado) y Codificado (cuando el trabajo ya está en Codificado; al enviarlo a Codificado, Envasado deja de poder marcarlo). Elaboración nunca. Producción y Dirección no marcan, pero sí pueden rectificar (junto con el sector que confirmó). Se valida en el servidor (`POST /api/v1/disponibilidad`).
- **Dónde:** panel «Disponibilidad para el cliente» → botón «Marcar listo para entregar», dentro del detalle del trabajo de Envasado (Mi trabajo → Registrar avance) y de Codificado.
- **Cantidades:** se puede marcar hasta lo realmente terminado y no cubierto: trabajo terminado → cantidad entregable (misma regla que la entrega); trabajo en curso → lo informado en «Guardar avance». Sin cantidad verificable no se puede marcar. Disponible = marcado − entregado desde la confirmación; las entregas anteriores a la primera confirmación (trabajos históricos) no restan disponibilidad. Clave de idempotencia y bloqueo de la fila del trabajo: doble clic o dos usuarios a la vez no duplican.
- **Portal:** estado «Listo para entregar» solo cuando TODO lo pendiente está confirmado; con una parte confirmada se ve «solicitado / disponible / entregado / pendiente» y «Disponible desde …». Un trabajo terminado sin confirmar queda «en proceso de finalización».
- **Aviso por correo:** una vez por confirmación, con la cantidad confirmada. Nada por el simple cierre de Envasado o Codificado.
- **Rectificar:** «Retirar disponibilidad» (motivo obligatorio), solo si esas unidades no fueron entregadas; no borra nada (marca retirada + auditoría con valores anteriores y nuevos). Si el cliente ya había sido avisado, ve una corrección en su portal y queda una incidencia auditada (sin correo nuevo).
- **Trabajos históricos:** no se convierten solos en «listo» ni generan avisos. Para regularizarlos, el sector responsable usa el mismo botón sobre cada trabajo (procedimiento controlado y auditado).
- No registra la entrega física: eso sigue en el circuito de Entregas de GENUS OS. No toca stock, movimientos, consumos de MP ni lotes.

## Confirmar recepción
Solo con entrega final registrada. Guarda fecha/hora, correo autenticado, entrega y cantidad; audita; avisa a Producción (aviso interno `PORTAL_RECEPCION`).
No modifica stock, movimientos, consumos de MP, lotes, entregas ni estados.

## Panel «Portal de Clientes» (Producción y Dirección)
Crear clientes y códigos, nombres vinculados, correos autorizados, invitar, suspender/reactivar, «ver como cliente» (solo lectura, auditado),
actividad (avisos, correos, recepciones, auditoría), problemas de vinculación y feriados por decreto.

## Correo
`PORTAL_EMAIL_MODE=off` por defecto: no se envía nada; cada correo queda registrado como «sin proveedor» y se reintenta (≤ 48 h) al activarlo.
Para activarlo: cuenta Resend con el dominio verificado (SPF/DKIM), `RESEND_API_KEY`, `PORTAL_EMAIL_FROM`, `PORTAL_EMAIL_MODE=live`.
Aviso «Tu producto está listo | Laboratorio Genus» sin duplicados (clave por trabajo+cantidad+destinatario); lo ya listo hace > 48 h se registra sin enviar.
Cron `/api/cron/portal-sync` cada 15 min (requiere `CRON_SECRET`).

## Variables de entorno
`PORTAL_AUTH_SECRET` (obligatoria en producción: firma de hashes), `PORTAL_PUBLIC_BASE_URL` (default `https://www.laboratoriogenus.com.ar/entregas`),
`PORTAL_EMAIL_MODE`, `RESEND_API_KEY`, `PORTAL_EMAIL_FROM`, `PORTAL_CONTACT_EMAIL`, `PORTAL_CONTACT_WHATSAPP(_LABEL)`.

## Crear el primer cliente y probar
1. GENUS OS → Producción → «Portal de Clientes» → Nuevo cliente (nombre, nombre exacto en GENUS OS, correo). Se muestra el código `GEN-…`.
2. Con el correo desactivado no llega el código: probar internamente con `PORTAL_EMAIL_MODE=live` y un correo propio, o en local con `capture`.
3. «Ver como cliente» muestra exactamente lo que verá. Revisar «Problemas de vinculación».
4. No habilitar clientes externos hasta confirmar la regla de «Listo» y activar el correo.

## Pruebas
`npm run test:e2e:portal-db` (integración en Postgres descartable, 16 casos) y `npm run test:e2e:portal` (Chromium real, escritorio y móvil, build de producción).

## Códigos de cliente automáticos (GEN-XXXXXX)

**Qué hace.** GENUS OS no tiene tabla de clientes: el cliente es el texto que figura en trabajos, pedidos y entregas. La identidad del portal (`portal_clients` + alias) es lo que le da un código estable. Desde la migración 0055 esa identidad se crea **sola** al aparecer un cliente nuevo; Producción no tiene que entrar al panel.

**Dónde se dispara** (todos llaman al mismo servicio central, `src/lib/portal/client-identity.ts`):
- alta y asignación de trabajos (Planificación / `assignWorkItemDurable`),
- alta y edición de pedidos, edición por celda e importación de pedidos,
- alta de entregas programadas,
- red de seguridad: el cron `/api/cron/portal-sync` (cada 15 min) toma cualquier cliente nuevo que haya entrado por otro camino (sincronizaciones, procesos futuros).

**Garantías.**
- Un nombre = un cliente = un código. La clave es el nombre normalizado (mayúsculas, acentos y espacios no cuentan). Si ya existe, se reutiliza su código.
- Atómico y sin duplicados con operaciones simultáneas: transacción + `pg_advisory_xact_lock` por nombre + índices únicos de respaldo.
- El alta del cliente nunca rompe el flujo operativo (los ganchos son «best effort» después de confirmar el pedido/trabajo; si fallan, la conciliación lo recupera).
- Cambiar el nombre comercial (acción «Renombrar») solo cambia `display_name`; el código y el vínculo con los pedidos no cambian.
- Un pedido, producto u orden **nunca** genera un código propio.
- Los nombres vacíos o marcadores (`s/d`, `n/a`, números sueltos) se ignoran.

**Seguridad.** Un código generado automáticamente nace con `access_enabled = false`: **no** activa el acceso, **no** envía correos ni invitaciones. Para que el cliente ingrese hay que (1) cargar un correo autorizado y (2) pulsar «Habilitar acceso». El código solo nunca autentica (siempre hace falta correo autorizado + código temporal). «Deshabilitar acceso» cierra sus sesiones. Los clientes dados de alta a mano desde el panel siguen quedando habilitados (acción explícita de Producción).

**Fecha de corte.** La conciliación solo considera clientes que aparecieron **desde el primer uso** (`portal_auto_code_settings.auto_since`, una hora antes). Los clientes históricos no reciben código por sorpresa.

**Generación masiva de históricos (manual).** Panel «Portal de Clientes» → «Clientes históricos sin código»:
1. «Ver vista previa»: lista (solo lectura) de clientes sin código, con cantidad de trabajos/pedidos/entregas y avisos de nombres parecidos (`ACME` vs `ACME S.A.` son clientes distintos).
2. Tildar/destildar los que no corresponden.
3. «Generar códigos»: pide confirmación; el servidor exige el token de la vista previa vigente y la cantidad exacta (si los datos cambiaron, hay que revisarla de nuevo). Máximo 2000 por vez, idempotente. Quedan con acceso deshabilitado y origen «generación histórica».

**Panel.** Cada cliente muestra el código con botón «Copiar», «Acceso habilitado / NO habilitado», «Correo autorizado (n) / Sin correo autorizado» y el origen (manual / automático + flujo / histórico).

**Pruebas.** `src/integration/portal-codigos.db.integration.test.ts` (Postgres descartable: `npm run test:e2e:portal-db`), `client-identity-rules.test.ts`, `migration-reconcile.test.ts` y el E2E de navegador `scripts/e2e/portal-validate.mjs`.
