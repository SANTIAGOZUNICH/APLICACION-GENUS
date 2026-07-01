# 17 — API (arquitectura futura)

> **ESTADO: PROPUESTA DE ARQUITECTURA FUTURA.** No existe aún. Define cómo conectar el front-end propio (`15`) con el backend que no cambia (`16`).

---

## 1. Arquitectura en capas

```
Frontend (web/móvil propio)
        ↓  HTTPS / JSON
Capa de API (servicio Genus)         ← autenticación, autorización (RBAC), validación de negocio
        ↓
Backend de datos (Google Sheets / AppSheet API)   ← sistema de registro actual
        ↓
Automatizaciones (bots / Apps Script)   ← la "posta", notificaciones, mantenimiento de TAREAS
        ↓
IA (servicio Creamy)                 ← RAG sobre Procedimientos, guardrails de derivación
```

La **capa de API** es el corazón: traduce las intenciones del front-end en operaciones válidas sobre el backend, **revalidando toda regla de negocio del lado servidor**. El front nunca habla directo con la planilla.

## 2. Principios

- **Backend autoritativo:** toda validación crítica (estado, append-only, RBAC, cantidades, vencimientos) se aplica en la API, no solo en el cliente.
- **Contratos estables:** endpoints versionados (`/v1/...`); cambios sin romper consumidores.
- **Idempotencia** en operaciones de escritura sensibles (evitar dobles movimientos).
- **Trazabilidad:** toda escritura registra usuario, timestamp y referencia (coherente con el espíritu append-only).

## 3. Endpoints sugeridos (ilustrativos)

Lectura/escritura siempre **RBAC-aware** (la API filtra según el rol del usuario):

**Trabajo / Bandeja**
- `GET /v1/tasks?assignee=me&status=...` — la cola de "Mi Trabajo" (de `TAREAS`).
- `POST /v1/tasks/{id}/complete` — completar una tarea (dispara la posta).

**Producción**
- `GET /v1/oe` · `GET /v1/oe/{id}` · `POST /v1/oe` · `POST /v1/oe/{id}/close`
- `POST /v1/oe/{id}/consumption` — registrar consumo de MP (valida lote/estado/saldo/vencimiento).
- Análogos para `/v1/oa` y `/v1/oa/{id}/materials`.

**Inventario**
- `GET /v1/lots/{id}` · `GET /v1/balances?item=...` (solo lectura; `SALDOS` derivado).
- `POST /v1/movements` — alta de movimiento (la API calcula el signo; append-only).

**Calidad / Liberación**
- `POST /v1/lots/{id}/analysis` — cargar análisis.
- `POST /v1/lots/{id}/release` — registrar disposición/firma (solo `ROL-DT`; append-only).

**Comercial / Despacho**
- `GET /v1/orders` · `POST /v1/orders` · `GET /v1/orders/{id}` (con cumplimiento derivado).
- `POST /v1/dispatch` — despacho contra `PEDIDO_DET_ID` (valida liberado/saldo/producto/vencimiento).

**RBAC / Maestros**
- `GET /v1/me` — usuario, rol y permisos efectivos.
- `GET /v1/permissions` — matriz (para que el front muestre/oculte; la autoridad sigue en backend).

**Creamy**
- `POST /v1/assistant/query` — consulta al asistente (devuelve respuesta + fuentes + derivación).

## 4. Seguridad

- **HTTPS** obligatorio; nada de datos sensibles en query strings.
- **Autorización del lado servidor** con la matriz `PERMISOS` (`04`): la API rechaza toda operación no permitida para el rol, aunque el cliente la intente.
- **Least privilege:** tokens con el alcance mínimo; `ROL-SV` (Creamy) solo lectura acotada.
- **Validación de entrada** estricta; sanitización; límites de tamaño.
- **Auditoría:** log de accesos y escrituras.

## 5. Autenticación

- **Identidad corporativa** (Google Workspace `@laboratoriogenus.com.ar`) vía OAuth/SSO; coherente con que `USUARIOS.email` es la clave.
- **Tokens** de sesión de corta duración + refresh; revocables.
- El usuario autenticado resuelve su `ROL_ID` (`USUARIOS`), y de ahí sus permisos.

## 6. Buenas prácticas

- Versionado, paginación, filtros y `ETag`/caché en lecturas.
- Respuestas con forma consistente (datos + metadatos + errores legibles).
- Errores de negocio con mensaje accionable (coherente con `07`: "qué pasó + cómo resolver").
- Tests de contrato; entorno de staging que no toque datos de producción.

## 7. Migración progresiva (opcional, futuro)

Si en algún momento se reemplaza Google Sheets como almacenamiento, hacerlo **detrás de la API** sin cambiar los contratos ni la lógica: el front no se entera. Decisión futura; ver `19`.
