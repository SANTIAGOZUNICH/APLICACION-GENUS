# 20 — Recomendaciones para Cursor AI

> Este documento está escrito **para vos, asistente de código** (Cursor AI), como si yo fuera el **Tech Lead** del proyecto explicándote todo en tu primer día. Leelo **antes** de escribir una sola línea. Si algo en otro documento contradice a este, preguntá antes de actuar.

---

## 1. Cómo entender el proyecto (en 60 segundos)

Genus Operaciones es el sistema de un **laboratorio cosmético GMP** que cubre el flujo **pedido → planificación → elaboración (OE/granel) → acondicionamiento (OA/PT) → calidad → liberación → despacho**, con trazabilidad por lote y control de acceso por rol. Tiene dos capas: un **backend que ya funciona** (Google Sheets + AppSheet, F1–F4.1 y RBAC F6.0) y una **capa de experiencia** (F7) que está **diseñada pero no construida**. Tu trabajo, en general, es **construir la experiencia reutilizando el backend tal cual**, no rehacer el backend.

**Leé en este orden:** `00-vision-general` → `02-arquitectura` → `03-modelo-de-datos` → `04-rbac` → `05-flujos-operativos` → `07-design-system` → `08-workspaces` → `09-bandeja-inteligente` → `14-roadmap` → `16-backend` → `17-api` → este documento. Para construir el front-end propio, sumá `15-frontend`.

## 2. Principios que NUNCA debés romper

Estos son inviolables. Romper uno es un bug de cumplimiento, no de UI.

1. **`MOVIMIENTOS` es append-only.** Nunca un `UPDATE` ni `DELETE`. Toda corrección es un movimiento nuevo (ajuste). El signo lo calcula la columna `cantidad_signo`; **nunca** escribas cantidades negativas a mano.
2. **`SALDOS` es derivado.** Nunca lo escribas. Es la suma de `MOVIMIENTOS` por lote. Si necesitás el stock, lo **leés** o lo **recalculás**, no lo seteás.
3. **`LIBERACIONES` es append-only** y es la **única** vía por la que cambia `LOTES.estado`. Nunca edites el estado de un lote directamente.
4. **Los estados se derivan, no se tipean.** Estado de orden = por transición de flujo. Estado de lote = última liberación. Cumplimiento de pedido = suma de despachos del renglón. No agregues campos manuales que dupliquen un estado derivable.
5. **La fórmula vive en `BOM` y se congela en la OE/OA** (`bom_version`). Cambiar un BOM no debe alterar órdenes históricas.
6. **Dos barreras de liberación humanas:** granel y PT deben estar **Liberado** para avanzar. No habilites acondicionar un granel no liberado ni despachar un PT no liberado.
7. **Segregación de funciones:** quien ejecuta/cierra una orden no firma su liberación. Respetá la matriz `PERMISOS` y la regla de firmante ≠ cerrador.
8. **RBAC default-deny, del lado servidor.** La autorización real se valida en backend/API contra `PERMISOS` (`04`). La UI **oculta**, pero no es la seguridad. **Nunca** confíes solo en el cliente para autorizar.
9. **Todo cambio al modelo es aditivo.** Agregá columnas/tablas **al final**, sin romper fórmulas ni columnas existentes (especialmente en `MOVIMIENTOS`/`SALDOS`).
10. **El usuario no navega tablas para trabajar.** Si tu solución obliga al operario a leer una grilla, está mal. El trabajo es **tarea + flujo guiado**.

## 3. Qué arquitectura respetar

- **El backend no cambia** (`16`). Reutilizá Google Sheets/AppSheet, su RBAC, sus automatizaciones, sus flujos. Si construís un front-end propio, va **sobre una API** (`17`) que revalida las reglas del lado servidor; no reimplementes la lógica de negocio en el cliente.
- **El modelo de datos de `03` es el contrato.** Respetá claves, relaciones y reglas de integridad. Lo marcado `[VERIFICADA]` es inmutable; lo `[DISEÑADA]` es contrato de implementación; lo `[PROPUESTA]` es dirección a confirmar.
- **El RBAC de `04` es la autoridad de permisos.** Consumí la matriz `PERMISOS`; no hardcodees permisos en código.

## 4. Qué estilo mantener

- **Seguí el Design System (`07`) al pie de la letra.** Tokens de color semánticos (un significado = un color), iconografía (un ícono por concepto), tipografía y espaciado. Usá los tokens como variables; no inventes colores ni estilos por pantalla.
- **Gramática de card única** (`07`): identidad · título · badge · metadatos · urgencia · una acción primaria. Toda tarjeta de trabajo igual.
- **Lenguaje del sistema (`18`):** español, natural, orientado a la acción; errores que dicen "qué pasó + cómo resolver"; empty states positivos; un botón primario por pantalla.
- **Workspaces por misión con el rol como lente** (`08`); secciones canónicas (Ahora / En cola / Esperando aprobación / Esperando a otros / Problemas / Finalizados).

## 5. Qué decisiones YA están tomadas (no las reabras)

- Inventario = libro mayor append-only + saldos derivados.
- Estados derivados; nada de estados manuales.
- Despacho **directo contra el renglón de pedido** (sin entidad "Orden de Despacho"); cumplimiento derivado.
- Material de empaque **se consume por lote** en la OA (resuelve el hueco GMP histórico).
- Un rol por usuario; operarios diferenciados por `area`.
- RBAC guiado por datos (tabla `PERMISOS`), default-deny, deletes off.
- Workspaces por misión; Bandeja Inteligente como norte; `TAREAS` como pieza que la unifica (pendiente).
- Design System y tokens de `07` (incluida la reconciliación: "Cerrada"=gris, azul=acción, verde=aprobado-calidad).
- Backend no se reemplaza; front-end es otra interfaz.

## 6. Qué NO debés modificar

- Las **fórmulas** de `MOVIMIENTOS.cantidad_signo`, `SALDOS.cantidad_actual`, y los cumplimientos derivados de `PEDIDOS_DET`.
- La estructura **[VERIFICADA]** de `LOTES`, `MOVIMIENTOS`, `SALDOS`, `USUARIOS`, y las tablas de gobierno `ROLES`/`MODULOS`/`PERMISOS`.
- Las **reglas de integridad** (append-only, derivado, barreras, segregación).
- La **semántica de color/estado** del Design System.

## 7. Qué SÍ podés mejorar

- La **experiencia**: Workspaces, Bandeja, formularios guiados, escaneo, empty states, microcopy.
- Los **KPIs computados** (vía cálculos derivados, sin duplicar estados).
- Las **automatizaciones de la posta** y las notificaciones (respetando RBAC).
- La construcción de `TAREAS` e `INCIDENCIAS` **como capas aditivas** sobre el modelo.
- El **front-end propio** y la **API** cuando se decida avanzar (`15`/`17`), siempre con el backend como autoridad.

## 8. Cómo debés pensar cuando programes

1. **Primero la regla GMP, después la feature.** Antes de escribir, preguntate: ¿esto viola algún principio de §2? Si sí, parás.
2. **Aditivo por defecto.** Asumí que lo que existe está como está por una razón. No "limpies" ni refactorices el backend sin justificación explícita.
3. **Derivá, no dupliques.** Si un dato se puede calcular del estado/movimientos, calculalo; no crees un campo manual paralelo (fuente única de verdad).
4. **Validá en el servidor.** Toda regla crítica se revalida en backend/API; la UI es ayuda, no seguridad.
5. **Reutilizá el Design System.** Antes de crear un componente nuevo, buscá si ya existe en `07`. Si falta, agregalo al sistema **antes** de usarlo, no inventes uno suelto.
6. **Pensá en el operario.** La vara es: ¿esta persona, en planta, con guantes, sabe qué hacer sin pensar? Si tu pantalla la obliga a decidir o a leer una tabla, rehacela.
7. **Trazabilidad siempre.** Toda escritura lleva usuario, timestamp y referencia. Nada anónimo, nada sin rastro.
8. **Ante la duda, preguntá.** Las áreas marcadas `[PROPUESTA]` o "MÓDULO FUTURO" (Creamy, Comunicación, Procedimientos, Capacitaciones) **no están diseñadas en detalle**: confirmá alcance con Dirección Técnica/Calidad antes de construir; no inventes decisiones regulatorias.

## 9. Tu primer entregable recomendado

Si tenés que empezar a producir valor rápido y seguro, seguí el **roadmap de `14`**: arrancá por la **Fase 1 (la cara nueva, bucket A)** — aplicar el Design System, colapsar la navegación a lenguaje ERP, ocultar tablas técnicas y mostrar solo la acción válida por estado. Es **aditivo, sin tocar el modelo ni la seguridad**, y es lo que más cambia la percepción por el menor esfuerzo. Antes de tocar `TAREAS` o automatizaciones, asegurate de que el **prerrequisito de `19`** (tablas de gobierno en producción) esté resuelto.

---

**Resumen de una frase:** construí la **experiencia** que describen `07`–`09` y `15`, **reutilizando** el backend de `16` a través de los contratos de `03`/`04`/`17`, **sin romper jamás** los diez principios de §2.
