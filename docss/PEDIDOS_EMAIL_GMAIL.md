# Pedidos desde email (piloto) — Gmail + IA

**Estado:** piloto manual. Producción presiona **ANALIZAR CORREOS** (≤ 10 correos recientes); la IA interpreta y quedan **borradores pendientes** en *Pedidos → Pedidos recibidos por email*. Nada se crea hasta **APROBAR Y CREAR PEDIDO**, que usa el servicio de pedidos existente. No se generan trabajos, OE/OA, movimientos de stock ni entregas. **No hay procesamiento automático.**

## Filtro obligatorio: solo lo que originalmente iba a `pedidos@laboratoriogenus.com.ar`
`agzunich@gmail.com` recibe también correos personales. Por eso, **antes de leer el cuerpo, descargar adjuntos o enviar algo a la IA**, cada correo se verifica del lado del servidor mirando **solo sus encabezados** (Gmail `format=metadata`: sin asunto ni cuerpo):
- **Fuerte:** `X-Original-To`, `X-Envelope-To`/`Envelope-To`, `Original-Recipient`, `X-Forwarded-For` o un `Delivered-To` anterior que sea `pedidos@laboratoriogenus.com.ar`.
- **Declarada:** la dirección figura **exacta** en `To`/`Cc`/`Resent-To`, o en la cláusula `for <…>` de un `Received`.
- Se compara la dirección exacta (sin nombres para mostrar, sin dominios o prefijos parecidos). El **asunto y el cuerpo nunca cuentan**: un correo personal que diga «pedido» o «pedidos@…» no pasa.
- Sin evidencia (p. ej. el reenvío borra el destinatario original) → **excluido como «no verificable»**: no se descargan adjuntos, no va a la IA y de él **solo se guarda el ID, la fecha y el motivo** (ni remitente ni asunto, por ser potencialmente personal). El panel muestra cuántos se excluyeron y los dominios de los remitentes.
- Se revisan hasta 60 correos recientes (solo encabezados) para encontrar hasta 10 dirigidos a pedidos@. Variable opcional `GMAIL_ORDERS_LABEL` para acotar a una etiqueta de Gmail (ver alternativas).
- **Los fixtures de las pruebas son representativos, NO capturas reales de Webnode.** Antes de confiar en el filtro, usá **«Verificar filtro (sin analizar)»**: muestra, para correos recientes, si se pudo verificar y **qué nombres de encabezado** dieron la evidencia (sin asuntos ni cuerpos, sin IA, sin escribir nada). Si aparecen como «no verificable» correos que sí iban a pedidos@, el reenvío no conserva el destinatario original: usar una alternativa.

### Alternativas si el reenvío no conserva el destinatario original
1. **Etiqueta de Gmail por filtro** (recomendada): en `agzunich@gmail.com` crear un filtro que, para mensajes con `deliveredto:`/`to:`/`cc:` `pedidos@laboratoriogenus.com.ar`, aplique la etiqueta `Pedidos`; configurar `GMAIL_ORDERS_LABEL=Pedidos`. La etiqueta **solo acota la búsqueda**: igual se exige la verificación por encabezados. Si el reenvío no deja ningún rastro del destinatario, la etiqueta tampoco podría distinguirlo; en ese caso:
2. **Reenviar desde Webnode a una dirección dedicada** (p. ej. un Gmail/Workspace solo para pedidos): todo lo que llega ahí es de pedidos, sin mezclar personales.
3. **IMAP directo a la casilla de Webnode** (lee pedidos@ sin pasar por Gmail): requiere guardar credenciales de IMAP (contraseña de aplicación), por eso no se implementó; solo si las anteriores no alcanzan.

## Qué hace y qué NO hace
- Cuenta conectada: **`agzunich@gmail.com`** (donde **Webnode reenvía** lo que llega a `pedidos@laboratoriogenus.com.ar`). Vía **API oficial de Gmail con OAuth 2.0**, permiso **`gmail.readonly`** únicamente. Nunca borra, mueve, marca ni responde correos. No usa contraseñas ni credenciales personales.
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
3. *Pantalla de consentimiento de OAuth* → como `agzunich@gmail.com` es una cuenta **personal de Gmail**, el tipo **Interno NO sirve** (solo admite usuarios de un Workspace propio). Usar **Externo** en estado **«Testing / En prueba»**, agregar `agzunich@gmail.com` como **Usuario de prueba** y el permiso `https://www.googleapis.com/auth/gmail.readonly`. **Limitación de Google:** en estado de prueba el token de renovación **vence a los 7 días** (hay que volver a tocar «Conectar casilla» cada semana). `gmail.readonly` es un permiso *restringido*: publicarlo para que no venza exige verificación de Google y una evaluación de seguridad; para uso permanente conviene la alternativa 2 (casilla dedicada en un Workspace propio, con app *Interna*).
4. *Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*. En **URI de redireccionamiento autorizados** agregar exactamente:
   - `https://appgenus.vercel.app/api/v1/email-orders/oauth/callback` (y el dominio propio, si se usa otro)
   - (solo para desarrollo local) `http://localhost:3000/api/v1/email-orders/oauth/callback`
   Copiar **ID de cliente** y **Secreto**.
5. (Solo si la cuenta fuera de un Workspace con restricciones de apps de terceros: permitir este ID de cliente. Con `agzunich@gmail.com` no aplica.)
6. **Vercel → Settings → Environment Variables** (Production; Preview si se quiere probar ahí):
   | Variable | Valor |
   |---|---|
   | `GMAIL_OAUTH_CLIENT_ID` | ID de cliente del paso 4 |
   | `GMAIL_OAUTH_CLIENT_SECRET` | Secreto del paso 4 (marcar *Sensitive*) |
   | `EMAIL_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` recomendado. También se aceptan 32 bytes en hex (64 caracteres) o cualquier secreto de ≥ 32 caracteres; comillas/espacios sobrantes se ignoran. Menos de 32 caracteres se rechaza y el panel lo indica. **Guardarla**: si se pierde o cambia hay que reconectar la casilla |
   | `GMAIL_OAUTH_REDIRECT_URI` | (opcional) la URI exacta del paso 4; si falta se usa el dominio desde el que se conecta |
   | `GMAIL_CONNECT_ACCOUNT` | (opcional) única cuenta que se puede conectar; por defecto `agzunich@gmail.com` |
   | `GMAIL_ORDERS_ADDRESS` | (opcional) destinatario ORIGINAL que se procesa; por defecto `pedidos@laboratoriogenus.com.ar` |
   | `GMAIL_ORDERS_LABEL` | (opcional) etiqueta de Gmail para acotar la búsqueda |
   | `GEMINI_API_KEY` | ya configurada (lectura de remitos) |
   Luego **redeploy**.

## Primera prueba real
1. Ingresar a GENUS OS como **Producción** → *Pedidos* → abrir **Pedidos recibidos por email (PILOTO)** → **Conectar casilla de pedidos**.
2. En la pantalla de Google **elegir la cuenta `agzunich@gmail.com`**; como la app está en prueba aparecerá el aviso *«Google no verificó esta aplicación»* → *Configuración avanzada → Ir a GENUS OS (no seguro)* → aceptar *«Ver los mensajes y la configuración de Gmail»* (solo lectura). GENUS OS rechaza cualquier otra cuenta o permisos de más.
3. Enviar a `pedidos@laboratoriogenus.com.ar` (para que pase por Webnode) 4–5 correos de prueba, y mezclar 1–2 correos personales a `agzunich@gmail.com` que digan «pedido»: un pedido con Excel, uno con PDF, uno con foto, una consulta ("¿precio de…?") y una respuesta en el mismo hilo modificando una cantidad.
4. Tocar **Verificar filtro (sin analizar)** y comprobar que los de pedidos@ figuran ✔ y los personales ✖. Recién entonces **Analizar correos** (3, 5 o 10) y revisar: cliente/productos detectados, dudas, origen (remitente, asunto, archivos). Corregir, **Aprobar y crear pedido** o **Descartar**.
> Hasta completar estos pasos la conexión real NO está probada: las pruebas automáticas usan un Gmail y una IA simulados.

## Arquitectura preparada para la revisión automática (NO activa)
`EmailOrdersService.analyze` ya es idempotente, reclama cada mensaje por su ID (con reclamo vencido a los 5 min por si la función muere) y registra errores reintentables, usuario y tiempos. Para automatizar: una ruta protegida con `CRON_SECRET` invocada por **Vercel Cron** (cada N minutos) que llame al mismo servicio con un actor de sistema, `max` ≤ 10 y solo correos nuevos (`after:` de `last_analyzed_at`), más una bandera de activación en `email_integrations`. Se puede pasar a notificaciones `users.watch` + Pub/Sub más adelante. Nada de esto se habilitó.

## Pruebas
- Unitarias: `src/lib/email-orders/email-orders.test.ts`, `src/features/os/operational/components/email-order-drafts-panel.test.tsx`.
- Postgres descartable (Gmail e IA simulados): `bash scripts/e2e/run-email-orders-db-local.sh`.

## Diagnóstico si el panel dice que falta configuración
El panel distingue **"no llegan al servidor"** (variable ausente en el entorno del deploy activo: revisar que esté en *Production* y redeployar después de crearla) de **"mal configuradas"** (presente pero vacía o demasiado corta). Nunca muestra valores. Desde la consola del navegador, ya logueado como Producción: `fetch('/api/v1/email-orders/status').then(r=>r.json()).then(j=>console.log(j.oauth))` devuelve `{ready, missing, invalid, keyFormat}`.
