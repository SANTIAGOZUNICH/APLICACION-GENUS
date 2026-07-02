# Genus OS — Playbook y Conocimiento Fundacional

# Desarrollo

Antes de contribuir al proyecto o implementar cualquier funcionalidad, es obligatorio leer la carpeta `/playbook`.

El orden de lectura es:

1. playbook/README.md
2. 01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md
3. 02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md
4. 03_GENUS_OS_CURSOR_PLAYBOOK.md
5. 04_GENUS_OS_EXECUTION_MANUAL.md

Estos documentos definen la filosofía, arquitectura, metodología y forma oficial de desarrollar Genus OS.

Esta carpeta contiene la referencia oficial de producto y arquitectura de **Genus OS**, el sistema digital de operaciones de Laboratorio Genus. Es la capa de conocimiento **sobre** `docss/` (que sigue siendo la fuente de verdad técnica detallada) y **sobre** el código real del repositorio: sintetiza, audita y transmite el criterio con el que hay que pensar, diseñar y desarrollar el producto.

No reemplaza `docss/`. No la contradice. La consolida, la audita contra la realidad del código y de la operación del laboratorio, y la convierte en criterio accionable para cualquier desarrollador o IA (Cursor incluido) que trabaje en el proyecto de acá en adelante.

---

## Por dónde empezar

Si vas a trabajar en una tarea concreta ahora mismo, andá directo a **[`CURSOR_START_HERE.md`](./CURSOR_START_HERE.md)**.

Si querés incorporar el conocimiento completo del proyecto antes de empezar a trabajar, leé los cuatro documentos en este orden:

## Índice de documentos

| # | Documento | Qué responde |
|---|---|---|
| 1 | [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md) | Qué es Genus OS, por qué existe, la filosofía Trabajo→Estado→Acción→Datos, cómo entender Laboratorio Genus, los principios no negociables. **El conocimiento fundacional.** |
| 2 | [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md) | Cómo debe sentirse el producto, cómo pensar una pantalla o funcionalidad nueva, el framework de toma de decisiones, los antipatrones, el ADN del producto. **El criterio de producto.** |
| 3 | [`03_GENUS_OS_CURSOR_PLAYBOOK.md`](./03_GENUS_OS_CURSOR_PLAYBOOK.md) | Qué de `docss/` y del código ya es real y qué sigue siendo blueprint (auditoría de fidelidad), gaps identificados, checklist rápido antes de tocar código. **El estado real del proyecto, hoy.** |
| 4 | [`04_GENUS_OS_EXECUTION_MANUAL.md`](./04_GENUS_OS_EXECUTION_MANUAL.md) | Cómo comenzar cualquier tarea, cómo analizar una solicitud, el proceso Comprender→Analizar→Diseñar→Validar→Programar, el formato de entrega, qué nunca hacer, cómo trabajar con Agustina. **El procedimiento operativo de ejecución.** |
| — | [`CURSOR_START_HERE.md`](./CURSOR_START_HERE.md) | Punto de entrada rápido: lo mínimo indispensable antes de escribir una línea de código. |

## El ciclo completo

```
Visión          →  01_FOUNDATIONAL_KNOWLEDGE_PART_I.md
Filosofía/Criterio →  02_FOUNDATIONAL_KNOWLEDGE_PART_II.md
Estado real     →  03_CURSOR_PLAYBOOK.md
Ejecución       →  04_EXECUTION_MANUAL.md
```

## Relación con `docss/`

`docss/` (22 documentos, `docss/00` a `docss/20`) sigue siendo la **fuente de verdad técnica**: modelo de datos completo, RBAC detallado, flujos operativos, design system, convenciones. Estos cuatro documentos de `/playbook` no repiten ese contenido — lo sintetizan, lo auditan contra la realidad del código y de la operación real del laboratorio, y enseñan el criterio con el que se usa. Ante cualquier duda de detalle técnico exacto (un campo, una tabla, una regla puntual), `docss/` es la referencia; ante cualquier duda de criterio, filosofía o procedimiento de trabajo, esta carpeta lo es.

## Origen de estos documentos

Este conjunto de documentos fue producido a partir de un análisis exhaustivo del repositorio `APLICACION-GENUS-main`: los 22 documentos de `docss/`, el código completo del frontend (`frontend/src/`), y los documentos operativos reales del laboratorio (planillas de asignación de lotes, pedidos, semanas de producción, y una orden de acondicionamiento real). Fue validado por Agustina Zunich, quien define la visión de producto de Genus OS.
