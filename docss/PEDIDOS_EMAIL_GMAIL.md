# Pedidos desde email (piloto) — Gmail + IA

**Estado:** piloto manual. Producción presiona **ANALIZAR CORREOS** (≤ 10 correos recientes); la IA interpreta y quedan **borradores pendientes** en *Pedidos → Pedidos recibidos por email*. Nada se crea hasta **APROBAR Y CREAR PEDIDO**, que usa el servicio de pedidos existente. No se generan trabajos, OE/OA, movimientos de stock ni entregas. **No hay procesamiento automático.**

## Qué hace y qué NO hace
- Cuenta: `pedidos@laboratoriogenus.com.ar` (Google Workspace / Gmail) vía **API oficial de Gmail con OAuth 2.0**, permiso **`gmail.readonly`** únicamente. Nunca borra, mueve, marca ni responde correos. No usa contraseñas ni credenciales personales.
- El *refresh token* se guarda **cifrado (AES-256-GCM)** en `email_integrations`; la clave está solo en el servidor. El token no viaja al navegador ni a los logs. **Desconectar** lo revoca en Google y lo borra.
- Lee cuerpo, Excel (.xlsx/.xls), Word (.docx), PDF e imágenes (png/jpg/webp), CSV/TXT. Máx. 5 adjuntos por correo y 8 MB cada uno; otros tipos no se abren. Los enlaces del correo **se listan pero nunca se abren**.
- Todo el contenido es **dato no confiable**: va delimitado a la IA con la orden de ignorar instrucciones, la IA no tiene herramientas y su respuesta se valida estrictamente (tipos, fechas, cantidades, límites). Una respuesta inválida se descarta.
- La IA es Gemini (la misma clave `GEMINI_API_KEY` ya usada para remitos; se apaga con `INGRESO_REMITO_EXTRACTION=off`). El contenido del correo se envía a ese proveedor: confirmar que está autorizado para datos de clientes antes de usarlo con correos reales.
- Cliente/producto se comparan con el catálogo real (fórmulas de Drive + pedidos existentes). Solo un calce exacto normalizado se elige solo; lo parecido queda como **sugerencia**. Lo que no se lee con claridad queda vacío y marcado como dudoso.
- **Duplicados:** un registro por ID de mensaje de Gmail (`email_order_messages`, único) y un borrador por mensaje (`email_order_drafts`, único). Re-analizar no duplica; solo se reintentan los que fallaron. La aprobación es idempotente (cada renglón guarda el id del pedido creado) y segura ante clics dobles y cortes.
- **Modificaciones:** si responde un hilo que ya tiene borrador, o repite un N° de OC ya cargado, o la IA lo lee como cambio, queda como *POSIBLE MODIFICACIÓN*: no se toca ningún pedido; se puede **marcar como revisada** o **crear como pedido nuevo** a pedido explícito.
- Campo no soportado por Pedidos: la **fecha de entrega pedida** se muestra en el borrador pero Pedidos no tiene dónde guardarla (no se modificó el módulo).
- **Medición del piloto** (en el panel): borradores, aprobados sin correcciones (= interpretados bien), aprobados con correcciones, descartados y renglones cargados automáticamente.

## Qué tiene que configurar el administrador (una sola vez)
1. **Google Cloud Console** (con una cuenta admin de `laboratoriogenus.com.ar`): usar un proyecto de la organización (puede ser el que ya usa GENUS para Drive/Sheets).
2. *APIs y servicios → Biblioteca* → habilitar **Gmail API**.
3. *Pantalla de consentimiento de OAuth* → tipo de usuario **Interno** (solo usuarios del Workspace; no requiere verificación de Google). Agregar el permiso `https://www.googleapis.com/auth/gmail.readonly`.
4. *Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*. En **URI de redireccionamiento autorizados** agregar exactamente:
   - `https://appgenus.vercel.app/api/v1/email-orders/oauth/callback` (y el dominio propio, si se usa otro)
   - (solo para desarrollo local) `http://localhost:3000/api/v1/email-orders/oauth/callback`
   Copiar **ID de cliente** y **Secreto**.
5. *Consola de administración de Google Workspace → Seguridad → Controles de API → Control de acceso a apps*: si está restringido el acceso de apps de terceros, **permitir** (o marcar como de confianza) este ID de cliente.
6. **Vercel → Settings → Environment Variables** (Production; Preview si se quiere probar ahí):
   | Variable | Valor |
   |---|---|
   | `GMAIL_OAUTH_CLIENT_ID` | ID de cliente del paso 4 |
   | `GMAIL_OAUTH_CLIENT_SECRET` | Secreto del paso 4 (marcar *Sensitive*) |
   | `EMAIL_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` recomendado. También se aceptan 32 bytes en hex (64 caracteres) o cualquier secreto de ≥ 32 caracteres; comillas/espacios sobrantes se ignoran. Menos de 32 caracteres se rechaza y el panel lo indica. **Guardarla**: si se pierde o cambia hay que reconectar la casilla |
   | `GMAIL_OAUTH_REDIRECT_URI` | (opcional) la URI exacta del paso 4; si falta se usa el dominio desde el que se conecta |
   | `GMAIL_ORDERS_ACCOUNT` | (opcional) por defecto `pedidos@laboratoriogenus.com.ar` |
   | `GEMINI_API_KEY` | ya configurada (lectura de remitos) |
   Luego **redeploy**.

## Primera prueba real
1. Ingresar a GENUS OS como **Producción** → *Pedidos* → abrir **Pedidos recibidos por email (PILOTO)** → **Conectar casilla de pedidos**.
2. En Google, iniciar sesión **como `pedidos@laboratoriogenus.com.ar`** y aceptar *«Ver los mensajes y la configuración de Gmail»* (solo lectura). GENUS OS rechaza cualquier otra cuenta o permisos de más.
3. Enviar a esa casilla 4–5 correos de prueba: un pedido con Excel, uno con PDF, uno con foto, una consulta ("¿precio de…?") y una respuesta en el mismo hilo modificando una cantidad.
4. **Analizar correos** (3, 5 o 10) y revisar: cliente/productos detectados, dudas, origen (remitente, asunto, archivos). Corregir, **Aprobar y crear pedido** o **Descartar**.
> Hasta completar estos pasos la conexión real NO está probada: las pruebas automáticas usan un Gmail y una IA simulados.

## Arquitectura preparada para la revisión automática (NO activa)
`EmailOrdersService.analyze` ya es idempotente, reclama cada mensaje por su ID (con reclamo vencido a los 5 min por si la función muere) y registra errores reintentables, usuario y tiempos. Para automatizar: una ruta protegida con `CRON_SECRET` invocada por **Vercel Cron** (cada N minutos) que llame al mismo servicio con un actor de sistema, `max` ≤ 10 y solo correos nuevos (`after:` de `last_analyzed_at`), más una bandera de activación en `email_integrations`. Se puede pasar a notificaciones `users.watch` + Pub/Sub más adelante. Nada de esto se habilitó.

## Pruebas
- Unitarias: `src/lib/email-orders/email-orders.test.ts`, `src/features/os/operational/components/email-order-drafts-panel.test.tsx`.
- Postgres descartable (Gmail e IA simulados): `bash scripts/e2e/run-email-orders-db-local.sh`.

## Diagnóstico si el panel dice que falta configuración
El panel distingue **"no llegan al servidor"** (variable ausente en el entorno del deploy activo: revisar que esté en *Production* y redeployar después de crearla) de **"mal configuradas"** (presente pero vacía o demasiado corta). Nunca muestra valores. Desde la consola del navegador, ya logueado como Producción: `fetch('/api/v1/email-orders/status').then(r=>r.json()).then(j=>console.log(j.oauth))` devuelve `{ready, missing, invalid, keyFormat}`.
