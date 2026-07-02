# 13 — Capacitaciones

> **ESTADO: MÓDULO FUTURO PROPUESTO.** No diseñado en detalle ni construido. Propuesta de dirección; alcance a confirmar.

---

## 1. Objetivo

Gestionar la **formación del personal** exigida por GMP: que cada persona esté capacitada y **al día** en los procedimientos que su función requiere, con registro auditable. En un laboratorio regulado, la capacitación no es opcional: debe demostrarse.

## 2. Componentes

- **Cronograma:** plan de capacitaciones (qué, a quién, cuándo).
- **Cursos:** unidades de formación (sobre un POE, una técnica, una norma).
- **Learning Journey:** la ruta de formación por puesto/rol (qué debe saber un operario de elaboración, uno de acondicionamiento, calidad, etc.).
- **Seguimiento:** estado de cada persona en cada curso (pendiente/en curso/completado).
- **Vencimientos:** capacitaciones que **caducan** y requieren renovación; alertas antes del vencimiento.
- **Evaluaciones:** verificación de la eficacia de la capacitación (cuestionario/práctica), con resultado.
- **Historial:** registro append-only de capacitaciones realizadas (quién, qué, cuándo, resultado) — evidencia de auditoría.

## 3. Modelo de datos propuesto (alto nivel)

- `CURSOS` (CURSO_ID, título, documento/POE asociado, vigencia/periodicidad).
- `PLAN_CAPACITACION` (rol/puesto → cursos requeridos = el Learning Journey).
- `CAPACITACIONES` (append-only: persona, curso, fecha, evaluador, resultado, fecha_vencimiento).
- `ASIGNACIONES` (persona, curso, estado, fecha_objetivo).

## 4. Principios

- **Append-only** en el historial de capacitaciones (evidencia).
- **Vinculado al rol/puesto** (Learning Journey por función).
- **Alertas de vencimiento** integradas a la Bandeja/Comunicación.
- **Trazabilidad** completa para inspección.

## 5. Integración con Procedimientos

Acoplado a `12`: cada curso suele estar asociado a un **POE**. Cuando un POE cambia de versión, las personas afectadas pasan a "requiere re-capacitación", y el sistema lo refleja en su estado y dispara la asignación. Así se cierra el círculo documento ↔ formación.

## 6. Integración con la experiencia

- Las capacitaciones pendientes/vencidas pueden aparecer como **tareas** en la Bandeja Inteligente del responsable de RRHH/Calidad y de la propia persona.
- Creamy (`10`) puede **sugerir** la capacitación pertinente ante una consulta, sin reemplazar el plan formal.

## 7. Pendiente de definición

Esquema final, motor de vencimientos/alertas, formato de evaluaciones, integración con Procedimientos y con la Bandeja. Ver `19-pendientes.md`.
