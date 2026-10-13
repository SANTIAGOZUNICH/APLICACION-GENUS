# 54 — Usabilidad para Elaboración y Materias Primas (arranque 13/10/2026)

Rama `claude/usabilidad-elaboracion-mp`, que parte de `main` en 9d2375c (incluye #116, #117 y #118).

- **Sin migraciones y sin cambios de datos.**
- No cambia reglas de stock, del libro mayor ni de aprobación de Calidad.
- No cambia permisos.

## 1. Auditoría (pantallas reales, build de producción, usuarios de Elaboración y Materias Primas)

| # | Prioridad | Dónde | Problema encontrado |
|---|---|---|---|
| 1 | **P1** | Control semanal | **No se podía crear un control**. El formulario solo aparecía con un control en borrador seleccionado. Sin controles, la pantalla decía «Seleccioná o creá un control» pero no había forma de hacerlo. |
| 2 | **P1** | OE (Elaboración) | Al escribir un **ajuste antes que su motivo**, el autoguardado fallaba a los 0,9 s con **«Error al guardar»**. Fallaba en cada cambio hasta completar el motivo. |
| 3 | **P1** | OE: Entregar | <ul><li>Con datos faltantes, el **botón destacado era «Entregar con campos pendientes»**: un clic de más entregaba una orden incompleta.</li><li>El botón no se bloqueaba mientras enviaba (doble envío).</li><li>Se entregaba la última versión **guardada** aunque el último guardado hubiera fallado.</li></ul> |
| 4 | **P1** | Varias | Mensajes técnicos para el operario: <ul><li>«Configurá GENUS_DATA_MODE=real y Drive» (Mi trabajo vacío);</li><li>«HTTP 409», «Error 500 al guardar», «Failed to fetch»;</li><li>errores de JavaScript del servidor («Cannot read properties of undefined…»);</li><li>estados y sectores en código («COMPLETA_CON_PENDIENTES», «sector ELABORACION»).</li></ul> |
| 5 | P2 | OE | Los datos obligatorios para entregar (Cantidad obtenida, Fecha de finalización, Procedimiento) estaban en **secciones cerradas**. El diálogo los listaba, pero no llevaba hasta ellos. |
| 6 | P2 | OE | Los números con **coma decimal** («1,5») se descartaban sin aviso (`type=number`). |
| 7 | P2 | Planillas | **Todas las columnas medían 150 px**: se cortaban Producto (Ingresos MP), «Afecta a» (Compras MP), descripciones, etc. |
| 8 | P2 | Planillas MP | La búsqueda decía solo «Buscar…», no buscaba por producto propio del lote ni por remito, y no tenía cómo quitarla con un clic. |
| 9 | P3 | OE | Barra con dos botones azules (Entregar y Descargar PDF). Campos de la tabla de materiales chicos (12 px). |
| 10 | P3 | Planillas | Texto de 13 px y fila actual difícil de seguir. |

Ya funcionaban (revisado y probado en #116, #117 y #118): doble clic / Enter / Tab / Shift+Tab / Escape / flechas, pegado de rangos desde Excel, selección de varias celdas, encabezados fijos, estados Guardando… / ✓ Guardado / 🔴 Error con «Reintentar», y el valor escrito que queda en la barra roja ante un error.

## 2. Corrección

1. **Control semanal**: el formulario de alta aparece siempre para Materias Primas. La cantidad solo recalcula el control activo si es un borrador. Acepta coma decimal.
2. **Ajuste sin motivo**: no se intenta guardar. El estado dice «Falta el motivo del ajuste de «X»: escribilo para guardar» y se guarda apenas se completa. El servidor sigue exigiendo el motivo.
3. **Entrega segura**:
   - guarda lo que está en pantalla antes de entregar, y si no se pudo guardar, no entrega;
   - no entrega con un ajuste sin motivo;
   - botón bloqueado mientras envía («Entregando…»).

   Con datos faltantes:
   - la acción principal es **«Volver a completar»**: abre las secciones con los datos que faltan y lleva la vista a ellas;
   - «Entregar igual, con pendientes» queda como acción secundaria y **exige marcar «Entiendo que la orden queda entregada con estos datos sin completar»**.

   El estado «Completa con pendientes» y el flujo de Calidad no cambian.
4. **Mensajes simples** (`lib/ui/friendly-error.ts`), con qué pasó y qué hacer:
   - sin conexión;
   - sesión vencida;
   - sin permiso;
   - registro inexistente;
   - edición simultánea (otra persona lo modificó: recargá y volvé a aplicar);
   - dato inválido;
   - problema del servidor.

   Lo que el servidor ya explica en castellano se muestra tal cual. Además, el servidor de órdenes ya no devuelve errores de programación. Los estados y sectores se muestran con nombre («Completa con pendientes», «Elaboración»), y Mi trabajo vacío dice «No hay trabajos para este día…».
5. **OE**: coma decimal (`DecimalInput`), campos de materiales más grandes (14 px). «Descargar PDF» pasa a secundario: Entregar es la única acción destacada.
6. **Planillas**:
   - ancho de columna según el contenido (como «autoajustar»), entre 96 y 340 px;
   - texto de 14 px;
   - fila resaltada al pasar el mouse.

   En la búsqueda de MP:
   - texto de ayuda según la pestaña;
   - busca también por producto del lote, códigos anteriores, remito y código recibido;
   - botón «×» y Esc para quitarla.

## 3. Quedan fuera del despliegue de mañana (documentado)

- **Primera columna fija** al desplazar a la derecha: la grilla (react-datasheet-grid) solo fija una columna a la derecha. Fijarla a la izquierda requiere cambiar el componente de grilla de todas las planillas: es un riesgo para mañana.
- **«Finalizar» del tablero de Mi trabajo vs. «Entregar» de la OE**: son dos acciones distintas, una sobre el trabajo planificado y otra sobre la orden. Unificarlas cambia el flujo de producción. Hoy el operario entrega la OE desde «Órdenes de Elaboración». Recomendación: definirlo con Producción antes de cambiarlo.
- **Fechas en formato dd/mm/aaaa** en las planillas: hoy se muestran aaaa-mm-dd y se aceptan las dos al escribir. Cambiar el formato de todas las planillas toca la edición y el pegado: queda para después.

## 4. Validación

Todas las pruebas usaron una base Postgres **descartable**: no se modificaron datos de Production.

| Prueba | Resultado |
|---|---|
| E2E nuevo `GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:usabilidad` (permisos reales de Elaboración, Materias Primas y Calidad; OE armada por Producción como en Production) | **26/26** |
| Regresión Stock MP (edición completa) | 47/47 |
| Regresión 7 planillas (edición en celda) | 87/87 |
| Regresión Materias Primas / Depósito / Asignación de lotes | 24/24 · 25/25 · 30/30 |
| Regresión Producción (edición) / Semanas y Mi trabajo | 27/27 · 50/50 |
| Integración Postgres | 53/53 |
| Vitest completo | 2167 OK |

Qué verifica el E2E nuevo:

- **Mi trabajo**: sin textos técnicos.
- **Listado y OE**: estados y sectores legibles.
- **Ajuste con coma y sin motivo**: no hay error; el estado avisa que falta el motivo y se guarda al completarlo (1,5 → 1.5).
- **Entrega con faltantes**: «Volver a completar» es la acción principal y abre «Control de proceso». «Entregar igual» queda deshabilitado hasta confirmar.
- **Cantidad obtenida** con coma se guarda.
- **Entrega completa**: un clic, con **un solo envío** aunque se haga doble clic. La OE queda COMPLETA y Calidad la ve para revisar (flujo sin cambios).
- **Control semanal**: se puede crear un control.
- **Compras**: «Afecta a» se lee completo.
- **Búsqueda** por lote; «×» la quita.
- **Sin conexión**: mensaje simple, lo escrito queda, y «Reintentar» lo guarda al volver la conexión.
- **Edición simultánea**: mensaje claro, sin «409».
- **Permisos**:
  - Elaboración no edita Stock MP (403);
  - Materias Primas no entrega OE (403).

El E2E encontró un defecto real que se corrigió: un doble clic rápido en «Entregar» enviaba dos veces.

Capturas antes y después en `docss/img/usabilidad-elaboracion-mp/`. Las de «antes» son de `main` con los mismos datos.
