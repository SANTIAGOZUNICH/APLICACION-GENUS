# 07 — Design System

El ADN visual de Genus. **Todas las pantallas, actuales y futuras, deben reutilizar exactamente estos componentes y tokens.** Este documento es el contrato de diseño: la consistencia no la garantiza ninguna plataforma, la garantiza este manual aplicado con disciplina.

---

## 1. Principios

1. **Claridad sobre densidad** — mostrar lo necesario, no todo lo posible.
2. **Consistencia absoluta** — un componente significa lo mismo en todas partes.
3. **Reconocer, no recordar** — estado por color + ícono, nunca por código a memorizar.
4. **Una acción primaria por contexto.**
5. **El estado guía** — el color comunica significado, jamás decora.
6. **A prueba de error** — validación antes de guardar; confirmación en lo irreversible.
7. **Pensado para planta** — alto contraste, objetos grandes, lenguaje simple.

La sensación objetivo: **profesional, calmo, claro, confiable.** Estética "industrial limpia", apropiada para GMP. No llamativo; predecible.

---

## 2. Design Tokens — semántica única

> Regla de oro: **nunca usar un color distinto para el mismo concepto, ni dos conceptos con el mismo color.**

### 2.1 Color (5 tokens semánticos)

| Token | Hex | Significado | Estados que representa |
|---|---|---|---|
| 🟢 Verde | `#1E8E5A` | **OK** / aprobado | Liberado · Completo · En tolerancia · Resuelto |
| 🟠 Naranja | `#C8881A` | **Atención** / en proceso / espera | Cuarentena · En curso · Parcial · Por vencer · Desvío leve · Borrador en revisión |
| 🔴 Rojo | `#C0392B` | **Problema** / detenido / urgente | Rechazado · Bloqueado · Crítico · Vencido · Sin lote · Fuera de tolerancia |
| 🔵 Azul | `#2D6CDF` | **Acción** / marca | Botón primario · enlaces · identidad |
| ⚪ Gris | `#6B7280` | **Información** / neutro / finalizado | Pendiente · Planificada · **Cerrada** · metadatos |

Color de marca secundario (acento): teal `#1FA39A`. Neutros de UI: fondo claro, superficies, bordes y texto en escala de gris.

**Reglas de aplicación:**
- Verde se reserva a lo **aprobado por calidad** (no a "terminado" genérico).
- "Cerrada" (orden finalizada) es **Gris**, no verde ni azul.
- Azul es **solo** acción/marca; nunca un estado.
- Badges: fondo en **tinte claro** de la familia + texto en el **tono oscuro**. Nunca texto negro sobre color saturado.

### 2.2 Iconografía (un ícono por concepto)

| Concepto | Ícono |
|---|---|
| OK / Liberado / Completo | check-circle |
| Espera / Cuarentena | clock |
| Atención / Por vencer / Desvío | alert-triangle |
| Rechazado | x-circle |
| Bloqueado | ban |
| Crítico / Error | alert-octagon |
| En curso | play |
| Pendiente / Info | info-circle |
| Crear | plus |
| Cerrar / Firmar | lock |
| Despachar | truck |
| Escanear | scan / barcode |
| Trazabilidad | route |

### 2.3 Tipografía

Una sola familia sans. Escala por rol (tamaños aproximados, ajustables al medio):

| Rol | Tamaño | Peso |
|---|---|---|
| Título de pantalla | ~22 | Semibold |
| Título de sección | ~16 | Semibold |
| Título de card | ~15 | Medium |
| Cuerpo | ~14 | Regular |
| Metadato | ~13 | Regular |
| Micro / caption | ~12 | Regular |

Jerarquía por tamaño y peso, no por color (el color es semántico).

### 2.4 Espaciado y forma

- **Base 8.** Padding de card 12–16 · gap entre cards 8–12 · gap entre secciones 16–24.
- **Radio:** medio en cards (8), pill en badges.
- **Sombras y bordes:** suaves; agrupar con espacio, no con líneas duras.

---

## 3. Componentes

Cada uno: **propósito · estructura · reglas.**

- **Card (base):** unidad de información. Cabecera (identidad + estado) · cuerpo (1–3 datos) · pie (acción). Una sola idea por card.
- **Tarjeta de trabajo (task card):** la unidad central. Gramática fija (ver §4). Tocarla **entra a un flujo**, no a una tabla. Todas las task cards comparten la misma gramática.
- **Badge (estado):** píldora color + ícono + texto. Uno por estado. Color del token.
- **Chip:** etiqueta de metadato o filtro, más chica, normalmente neutra. No usar chip para estado (eso es badge).
- **Alerta (inline):** ícono de severidad + mensaje + acción opcional. Variantes info/atención/problema/ok. Aparece en contexto; popup solo si es bloqueante.
- **Botón:** primario (azul, uno por pantalla), secundario (contorno), terciario/texto, destructivo (rojo, solo irreversible). Grande en planta.
- **Formulario (guiado):** una columna, etiqueta arriba, revelado progresivo, validación inline, paso de confirmación. Pide solo lo del paso actual.
- **Tabla:** datos de referencia/consulta/auditoría. Cabecera limpia, columna de estado con badge, números a la derecha. **Nunca** superficie de trabajo de un operario.
- **Deck:** lista de cards. Formato por defecto del trabajo (Workspaces).
- **Dashboard:** fila de KPIs + secciones. Para panorama/overview (Supervisor, Dirección).
- **Empty State:** ícono + mensaje + acción opcional. Tono **positivo** cuando no hay trabajo ("No tenés tareas pendientes ✔").
- **Confirmación:** antes de lo irreversible (cerrar, firmar, despachar). Qué va a pasar + confirmar/cancelar.
- **Mensaje de error:** **qué pasó + cómo resolverlo**, claro, sin culpar, inline cerca del campo. Surge de la validación.

---

## 4. Gramática de card (estándar único)

Toda tarjeta de trabajo, sea de la entidad que sea, sigue esta estructura:

```
[ícono/identidad] · Título en lenguaje simple · [Badge de estado]
   metadato 1 · metadato 2 · metadato 3
   [señal de urgencia]                        [ACCIÓN PRIMARIA]
```

Esto hace que aprender a leer **una** card sirva para leerlas **todas**.

---

## 5. Componentes específicos de producción (GMP)

Todos siguen la gramática de §4. Cambia el contenido:

| Card | Identidad/Título | Badge | Metadatos | Urgencia | Acción primaria |
|---|---|---|---|---|---|
| **OE** | OE-ID + producto granel | estado | lote granel · tamaño · responsable | avance % (color) | acción contextual |
| **OA** | OA-ID + SKU | estado | lote PT · unidades · responsable | avance % | acción contextual |
| **Lote** | ítem + nro_lote | estado | tipo_item · saldo | vencimiento (badge si próximo) | Ver / Despachar |
| **Liberación** | lote + OA/OE | decisión / "análisis OK" | evidencia · días en cuarentena | antigüedad | Disponer (CA) / **Firmar** (DT) |
| **Pedido** | PED-ID + cliente | estado | compromiso · avance despacho | compromiso por vencer | Seguir / Despachar |
| **Incidencia** | tipo + orden asociada | severidad | reportó · fecha | severidad | Resolver |
| **Alerta** | tipo (stock/vto/desvío) | severidad | contexto | criticidad | Atender |

Cada card es **autosuficiente**: comunica qué es, su estado, su urgencia y qué hacer, sin abrir nada.

---

## 6. Lenguaje visual (cómo debe verse una pantalla)

- **Espacio en blanco generoso.** Agrupar con espacio, no con líneas.
- **Un foco por pantalla**, claramente el elemento más grande/contrastado.
- **Botones:** un primario por pantalla; idealmente ≤ 3 acciones visibles; el resto en overflow.
- **Cuándo usar cada formato:** Card/Deck → trabajo con estado (default); Tabla → consulta/auditoría; Lista simple → enumeraciones/historial; Dashboard → panorama; Formulario guiado → captura paso a paso.
- **Cuándo usar color:** solo estado o acción. Nunca decorativo.
- **Densidad por contexto:** operario = baja densidad, objetos grandes; supervisor/dirección = densidad media aceptable.
- **Regla madre:** ninguna pantalla inventa estilo. Si algo no está en este manual, se agrega acá antes de usarlo.

---

## 7. Estados (tabla maestra)

Mapa único estado → token → significado (fuente de verdad para badges en todo el sistema):

| Estado | Token | Aplica a |
|---|---|---|
| Liberado | 🟢 Verde | Lote, Liberación |
| Completo | 🟢 Verde | Renglón de pedido |
| En tolerancia | 🟢 Verde | Consumo/control |
| Cuarentena | 🟠 Naranja | Lote |
| En curso | 🟠 Naranja | OE/OA |
| Parcial | 🟠 Naranja | Renglón de pedido |
| Por vencer | 🟠 Naranja | Lote |
| Rechazado | 🔴 Rojo | Lote, Liberación |
| Bloqueado | 🔴 Rojo | Lote |
| Vencido | 🔴 Rojo | Lote |
| Sin lote / Fuera de tolerancia | 🔴 Rojo | Consumo |
| Pendiente | ⚪ Gris | Renglón de pedido, tarea |
| Planificada | ⚪ Gris | OE/OA, Plan |
| Cerrada | ⚪ Gris | OE/OA |
