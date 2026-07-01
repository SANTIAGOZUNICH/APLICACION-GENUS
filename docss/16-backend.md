# 16 — Backend

> Principio rector de esta sección: **el backend existente NO debe cambiar.** Un front-end nuevo (`15`) es **otra interfaz** sobre el mismo backend, no un reemplazo de la lógica.

---

## 1. Qué es el backend de Genus hoy

El backend operativo de Genus es la combinación:

- **Google Sheets** — base de datos. Cada tabla del modelo (`03`) es una pestaña. Las **fórmulas** (signo de movimiento, saldos, cumplimiento de pedido) viven acá y son parte de la lógica.
- **AppSheet** — capa de aplicación: define vistas, formularios, **acciones**, **RBAC** (security filters / Editable_If / Only_If), y **automatizaciones (bots)**.
- **Apps Script** — automatización y lógica complementaria cuando hace falta.
- **Looker Studio** — reportería.
- **Slack** — canal de notificaciones.

Este conjunto **funciona y es la fuente de verdad**. F1–F4.1 y el RBAC F6.0 están implementados aquí.

## 2. Por qué no se cambia

- **Cumplimiento y estabilidad:** las reglas GMP (append-only, derivaciones, dos barreras, segregación) ya están codificadas y verificadas. Reescribirlas introduce riesgo regulatorio.
- **Costo/beneficio:** el valor que falta es de **experiencia** (front-end), no de lógica. Cambiar el backend no mejora la experiencia y sí pone en riesgo lo que funciona.
- **Separación de responsabilidades:** la lógica de negocio debe vivir en un solo lugar. Si el front-end reimplementara reglas, habría dos fuentes de verdad → inconsistencia.

## 3. Qué se reutiliza (y debe respetarse)

- **Modelo de datos** (`03`): tablas, claves, relaciones, y las **reglas de integridad** (append-only en `MOVIMIENTOS`/`LIBERACIONES`, derivado en `SALDOS` y cumplimientos, estados derivados, `bom_version` congelada).
- **RBAC** (`04`): la matriz `PERMISOS` es la autoridad de autorización. Cualquier interfaz debe consultarla y respetarla.
- **Flujos GMP** (`05`): la cadena de estados y las dos barreras de liberación.
- **Automatizaciones / bots:** la "posta" y las notificaciones se implementan como automatizaciones del backend.
- **Acciones:** las operaciones de negocio (consumir, producir, cerrar, firmar, despachar) con sus validaciones.

## 4. El backend como servicio del front-end

Cuando llegue el front-end propio (`15`), el backend debe exponerse a través de una **capa de servicios/API** (`17`) que:
- Lea y escriba respetando las **mismas reglas** (validaciones, append-only, RBAC del lado servidor).
- No permita al cliente saltearse una regla de negocio (toda validación crítica se revalida en backend).
- Mantenga Google Sheets/AppSheet como sistema de registro, o migre progresivamente el almacenamiento **sin cambiar la lógica ni los contratos** (decisión futura, ver `17` y `19`).

## 5. Regla para quien desarrolle

> Antes de "mejorar" algo en el backend, asumir que **ya está como está por una razón GMP**. Cambios al backend solo con justificación explícita y validación. La energía de desarrollo va al **front-end y a la capa de experiencia** (Bandeja, TAREAS, notificaciones), reutilizando el backend tal cual.
