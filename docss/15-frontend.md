# 15 — Frontend (visión del front-end propio)

> Este documento describe **el front-end ideal de Genus**, como si se construyera desde cero con tecnología moderna. **No habla de la plataforma actual.** Es la visión objetivo: la interfaz con la que Genus alcanza el 100% de la experiencia diseñada. El backend no cambia (ver `16`) y se consume vía API (ver `17`).

**Inspiración:** SAP Fiori (worklist + object page), Monday (tableros por estado, color), Linear (velocidad, "mi trabajo", chrome mínimo), Odoo (status bar + flujo por etapas), Notion (limpieza, densidad cómoda, contenido como ciudadano de primera).

**Stack sugerido (no prescriptivo):** React + Next.js, TypeScript, un sistema de componentes accesible (p. ej. Radix/shadcn) + Tailwind con los **design tokens de `07`** como fuente de verdad, estado de servidor con React Query, gráficos con una librería ligera. Lo esencial no es el stack sino respetar el Design System y la visión de experiencia.

---

## 1. Principios de la interfaz

La interfaz materializa la filosofía de `00`: **el usuario empieza en su trabajo, no en un menú.** Liderar con la **Bandeja Inteligente** (`09`); el resto es secundario. Calmo, claro, rápido, profesional. Cada decisión visual usa los **tokens de `07`** (color semántico, tipografía, espaciado, iconografía) — sin excepción.

## 2. Layout general

- **Estructura de tres zonas:** Sidebar (navegación) · Área de trabajo (el contenido, ~80%) · Panel contextual opcional (detalle/acciones/chat).
- **Densidad cómoda** (Notion-like): mucho aire, jerarquía por tamaño/peso, separadores sutiles.
- **Ancho de contenido controlado:** evitar líneas larguísimas; foco claro.

## 3. Sidebar

- **Navegación por Workspaces de misión** (`08`): Producción, Calidad, Comercial, Inventario/Depósito, Dirección, Dirección Técnica — filtrados por rol.
- Ítems con ícono + etiqueta; sección activa resaltada.
- Acceso secundario: **Buscar/Consultar** (lookup global) y **Configuración**.
- Colapsable (solo iconos) para pantallas chicas.
- **Lo que NO va en el sidebar:** tablas técnicas como destino. El usuario no navega tablas (`00`).

## 4. La Bandeja Inteligente (pantalla central)

La materialización de `09`:
- **El Foco** arriba: una tarjeta grande con *lo próximo*, su contexto y su acción primaria.
- **Secciones** (Ahora · En cola · Esperando aprobación · Esperando a otros · Problemas · Finalizados) como grupos colapsables.
- **Pulso del día:** barra/indicador sutil de progreso (hecho vs. pendiente).
- **Orden por urgencia**; "Problemas" siempre visible.
- **Empty state positivo** cuando se vacía.

## 5. Cards

- Implementan la **gramática de card de `07`**: identidad · título · badge · metadatos · urgencia · acción.
- Cards específicas de producción (OE, OA, Lote, Liberación, Pedido, Incidencia, Alerta) con su estructura estándar.
- Estado siempre como **badge con color de token + ícono**.
- Click → object page / panel de detalle (no a una tabla).

## 6. Dashboards / KPIs

- Para Supervisor y Dirección: fila de **KPI tiles** (estilo Fiori) que además son **entradas** (tocás el KPI y vas a su worklist).
- Gráficos solo cuando aportan (tendencias, distribución); evitar decoración.
- Color de los KPIs según semántica (verde/naranja/rojo).
- Es **panorama**, secundario a la Bandeja.

## 7. Object Page (detalle de una entidad)

Inspirada en Fiori/Odoo:
- **Status bar** arriba: las etapas del flujo con la actual resaltada (p. ej. Planificada → En curso → Cerrada → Liberada).
- **Cabecera** con identidad, badge de estado y acción primaria.
- **Secciones** de contenido (datos, consumos, controles, trazabilidad, historial/chatter).
- **Chatter/actividad** (estilo Odoo): comentarios y log del objeto, anclado al contexto (`11`).

## 8. Workspaces

Cada Workspace (misión) es una vista compuesta de secciones (decks de cards), filtrada por el rol como lente (`08`). El mismo vocabulario de secciones en todos.

## 9. Formularios

- **Guiados** (`07`): un paso a la vez, revelado progresivo, validación inline, confirmación en lo irreversible.
- **Escaneo** integrado (cámara/lector) para lotes en planta.
- Mensajes de error que dicen **qué pasó y cómo resolver**.

## 10. Acciones

- **Una acción primaria** evidente por pantalla/card (botón azul).
- Acciones contextuales según estado y permiso (RBAC del lado servidor, `17`).
- Acciones rápidas estilo Linear (accesibles, idealmente con atajos de teclado en desktop).

## 11. Chatbot (Creamy)

- Panel/lanzador persistente (`10`): el usuario consulta a Creamy desde cualquier Workspace.
- Respuestas con **cita de fuente** (POE/especificación) y **recomendación de derivación** cuando corresponde.
- Respeta el RBAC del usuario.

## 12. Responsive

- **Móvil primero para planta** (operario, depósito): objetos grandes, escaneo, una tarea a la vez, sidebar colapsado.
- **Desktop para supervisión/dirección:** densidad media, dashboards, multi-panel.
- Layout fluido entre breakpoints; nada se rompe en una tablet de planta.

## 13. Dark mode

- Soportado vía tokens (dos temas que mapean los mismos roles semánticos). El color **mantiene su significado** en ambos temas (verde sigue siendo OK, etc.). Contraste accesible en los dos.

## 14. Animaciones

- **Sobrias y con propósito:** transiciones de estado (una tarea que se completa y sale), aparición de la siguiente tarea, feedback de guardado. Nunca decorativas ni lentas. Refuerzan la sensación de "vivo" y de progreso, sin distraer.

## 15. UX — reglas transversales

- El usuario **nunca** se pregunta "¿a qué módulo entro?": siempre ve *lo próximo*.
- **Cero tablas para trabajar**; tablas solo para consultar/auditar.
- Consistencia total con el Design System (`07`).
- Accesibilidad: contraste, foco visible, navegación por teclado, *tap targets* grandes.
- Rendimiento percibido: estados de carga claros, datos progresivos, optimismo en acciones rápidas.

## 16. Relación con el backend

El front-end es **otra interfaz** sobre el mismo backend (`16`). Toda la lógica de negocio, RBAC, append-only y flujos GMP vive en el backend/servicios; el front consume la API (`17`). El front no reimplementa reglas de negocio críticas: las **respeta** y las refleja.
