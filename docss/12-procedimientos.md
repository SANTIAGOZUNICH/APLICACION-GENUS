# 12 — Procedimientos (POEs y gestión documental)

> **ESTADO: MÓDULO FUTURO PROPUESTO.** No diseñado en detalle ni construido. Este documento propone la dirección. El alcance debe confirmarse con Dirección Técnica/Calidad antes de construir.

---

## 1. Objetivo

Gestionar la **documentación controlada** del laboratorio —Procedimientos Operativos Estandarizados (POEs), instructivos, especificaciones, formularios— con **versionado, aprobaciones y firmas**, acceso rápido desde el trabajo y búsqueda. Es un requisito GMP: la documentación debe estar vigente, controlada y trazable.

## 2. Componentes

- **POEs / Instructivos / Documentos:** el repositorio de documentación controlada.
- **Versionado:** cada documento tiene versiones; solo una **vigente**; las anteriores quedan como **obsoletas** consultables. Cambiar un documento crea versión, no sobrescribe.
- **Firmas / Aprobaciones:** flujo de revisión y aprobación (autor → revisor → aprobador), con registro de quién y cuándo. La aprobación de Dirección Técnica/Calidad habilita la vigencia.
- **Acceso rápido:** desde una tarea/objeto, link al POE pertinente (p. ej. desde una OE, el instructivo de elaboración).
- **Búsqueda:** por código, título, proceso, producto, palabra clave.

## 3. Modelo de datos propuesto (alto nivel)

- `DOCUMENTOS` (DOC_ID, código, título, tipo, proceso/área, estado [Borrador/En revisión/Vigente/Obsoleto], version_vigente).
- `DOCUMENTO_VERSIONES` (DOC_ID, version, archivo/contenido, fecha, autor, revisor, aprobador, fecha_aprobacion, motivo_cambio).
- `DOCUMENTO_FIRMAS` (registro append-only de aprobaciones/firmas).

## 4. Principios

- **Append-only en firmas y versiones** (igual filosofía que `MOVIMIENTOS`/`LIBERACIONES`).
- **Una sola versión vigente** por documento.
- **Trazabilidad** de cambios (qué cambió, quién aprobó, cuándo).
- **Control de acceso** por rol.

## 5. Relación con Creamy

El módulo Procedimientos es la **base de conocimiento (RAG)** de Creamy (`10`). Creamy responde **citando los POEs vigentes**; nunca documentos obsoletos o no controlados. Cuando un POE cambia de versión, Creamy debe pasar a responder según la nueva. Esta dependencia hace que Procedimientos sea **prerrequisito** de un Creamy confiable.

## 6. Relación con Capacitaciones

Un cambio de versión de un POE puede disparar una **necesidad de capacitación** (`13`): el personal afectado debe re-capacitarse y registrarse. Procedimientos y Capacitaciones se integran por esta vía.

## 7. Pendiente de definición

Esquema final, motor de versionado/firmas, almacenamiento de archivos, política de control de cambios, integración con Creamy y Capacitaciones. Ver `19-pendientes.md`.
