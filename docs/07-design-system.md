# 07 — Design System

El ADN visual de Genus. **Todas las pantallas, actuales y futuras, deben reutilizar exactamente estos componentes y tokens.** Este documento es el contrato de diseño: la consistencia no la garantiza ninguna plataforma, la garantiza este manual aplicado con disciplina.

---

## 1. Principios

| # | Principio | Significado |
|---|---|---|
| 1 | **Claridad sobre densidad** | Mostrar lo necesario, no todo lo posible. |
| 2 | **Consistencia absoluta** | Un componente significa lo mismo en todas partes. |
| 3 | **Reconocer, no recordar** | Estado por color + ícono, nunca por código a memorizar. |
| 4 | **Una acción primaria por contexto** | Cada pantalla/card tiene una sola acción evidente. |
| 5 | **El estado guía** | El color comunica significado, jamás decora. |
| 6 | **A prueba de error** | Validación antes de guardar; confirmación en lo irreversible. |
| 7 | **Pensado para planta** | Alto contraste, objetos grandes, lenguaje simple. |

**Sensación objetivo:** profesional, calmo, claro, confiable. Estética "industrial limpia", apropiada para GMP. No llamativo; predecible.

---

## 2. Design Tokens

> **Regla de oro:** nunca usar un color distinto para el mismo concepto, ni dos conceptos con el mismo color.

### 2.1 Color — tokens semánticos (5 familias)

| Token | Hex | CSS Variable sugerida | Significado | Estados |
|---|---|---|---|---|
| 🟢 Verde | `#1E8E5A` | `--color-ok` | OK / aprobado | Liberado · Completo · En tolerancia · Resuelto |
| 🟠 Naranja | `#C8881A` | `--color-attention` | Atención / en proceso / espera | Cuarentena · En curso · Parcial · Por vencer · Desvío leve |
| 🔴 Rojo | `#C0392B` | `--color-problem` | Problema / detenido / urgente | Rechazado · Bloqueado · Crítico · Vencido · Fuera de tolerancia |
| 🔵 Azul | `#2D6CDF` | `--color-action` | Acción / marca | Botón primario · enlaces · identidad |
| ⚪ Gris | `#6B7280` | `--color-neutral` | Información / neutro / finalizado | Pendiente · Planificada · Cerrada · metadatos |

**Colores complementarios:**

| Token | Hex | Uso |
|---|---|---|
| Teal (acento) | `#1FA39A` | Acento de marca secundario |
| Fondo claro | `#F9FAFB` | Background de página |
| Superficie | `#FFFFFF` | Cards, paneles |
| Borde | `#E5E7EB` | Separadores sutiles |
| Texto primario | `#111827` | Títulos, cuerpo |
| Texto secundario | `#6B7280` | Metadatos, captions |

**Reglas de aplicación:**
- Verde se reserva a lo **aprobado por calidad** (no a "terminado" genérico).
- "Cerrada" (orden finalizada) es **Gris**, no verde ni azul.
- Azul es **solo** acción/marca; nunca un estado.
- Badges: fondo en **tinte claro** de la familia + texto en el **tono oscuro**. Nunca texto negro sobre color saturado.

**Ejemplo de tintes para badges:**

| Estado | Fondo badge | Texto badge |
|---|---|---|
| Liberado | `#E8F5EE` (verde 10%) | `#1E8E5A` |
| Cuarentena | `#FDF6E8` (naranja 10%) | `#C8881A` |
| Rechazado | `#FCEAEA` (rojo 10%) | `#C0392B` |
| Pendiente | `#F3F4F6` (gris 10%) | `#6B7280` |

### 2.2 Dark mode

Los mismos tokens semánticos se mapean a valores oscuros manteniendo el significado:

| Token | Light | Dark |
|---|---|---|
| Fondo | `#F9FAFB` | `#111827` |
| Superficie | `#FFFFFF` | `#1F2937` |
| Texto primario | `#111827` | `#F9FAFB` |
| Verde (OK) | `#1E8E5A` | `#34D399` |
| Naranja (Atención) | `#C8881A` | `#FBBF24` |
| Rojo (Problema) | `#C0392B` | `#F87171` |
| Azul (Acción) | `#2D6CDF` | `#60A5FA` |

El color **mantiene su significado** en ambos temas. Contraste accesible (WCAG AA mínimo).

### 2.3 Iconografía (un ícono por concepto)

Basado en Lucide Icons o equivalente:

| Concepto | Ícono | Uso |
|---|---|---|
| OK / Liberado / Completo | `check-circle` | Badge de estado positivo |
| Espera / Cuarentena | `clock` | Lote en cola de calidad |
| Atención / Por vencer / Desvío | `alert-triangle` | Alertas no críticas |
| Rechazado | `x-circle` | Decisión negativa |
| Bloqueado | `ban` | Lote bloqueado/recall |
| Crítico / Error | `alert-octagon` | Problemas graves |
| En curso | `play` | Orden activa |
| Pendiente / Info | `info-circle` | Estado inicial, información |
| Crear | `plus` | Acción de alta |
| Cerrar / Firmar | `lock` | Cierre o firma (irreversible) |
| Despachar | `truck` | Salida de mercadería |
| Escanear | `scan` / `barcode` | Lectura de código en planta |
| Trazabilidad | `route` | Cadena de origen |
| Producción | `factory` | Workspace Producción |
| Calidad | `shield-check` | Workspace Calidad |
| Pedido | `package` | Comercial |

### 2.4 Tipografía

Una sola familia sans-serif. Sugerida: **Inter**, **DM Sans**, o system-ui.

| Rol | Tamaño | Peso | Uso |
|---|---|---|---|
| Título de pantalla | 22px | Semibold (600) | Encabezado principal |
| Título de sección | 16px | Semibold (600) | Secciones de Workspace |
| Título de card | 15px | Medium (500) | Identidad en tarjeta de trabajo |
| Cuerpo | 14px | Regular (400) | Texto general |
| Metadato | 13px | Regular (400) | Datos secundarios en cards |
| Micro / caption | 12px | Regular (400) | Timestamps, hints |

Jerarquía por **tamaño y peso**, no por color (el color es semántico de estado).

### 2.5 Espaciado y forma

**Base: 8px.** Todos los espaciados son múltiplos de 8.

| Token | Valor | Uso |
|---|---|---|
| `space-1` | 4px | Micro-ajustes |
| `space-2` | 8px | Gap entre elementos inline |
| `space-3` | 12px | Padding interno de cards |
| `space-4` | 16px | Padding de cards, gap entre cards |
| `space-5` | 20px | — |
| `space-6` | 24px | Gap entre secciones |
| `space-8` | 32px | Separación mayor |

**Border radius:**

| Token | Valor | Uso |
|---|---|---|
| `radius-sm` | 4px | Chips, inputs |
| `radius-md` | 8px | Cards |
| `radius-lg` | 12px | Modales, paneles |
| `radius-full` | 9999px | Badges (pill) |

**Sombras:** suaves, solo para elevación de cards y modales.

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px rgba(0,0,0,0.07);
```

---

## 3. Componentes

### 3.1 Card (base)

**Propósito:** unidad de información. Una sola idea por card.

**Estructura:**
```
┌─────────────────────────────────────────┐
│ [ícono] Título                    [Badge]│
│ metadato 1 · metadato 2 · metadato 3    │
│ [urgencia]              [ACCIÓN PRIMARIA] │
└─────────────────────────────────────────┘
```

**Reglas:**
- Cabecera: identidad + estado.
- Cuerpo: 1–3 datos clave.
- Pie: una acción primaria.
- Padding: 12–16px.
- Border: 1px solid `--border` o sombra suave.

### 3.2 Tarjeta de trabajo (Task Card)

La unidad central del sistema. **Todas** las task cards comparten la misma gramática (ver §4).

**Reglas:**
- Tocarla **entra a un flujo**, no a una tabla.
- Una acción primaria visible.
- Badge de estado siempre presente.
- Metadatos en una sola línea, separados por `·`.

### 3.3 Badge (estado)

**Propósito:** comunicar estado de forma instantánea.

**Estructura:** píldora con fondo tinte + ícono + texto.

**Reglas:**
- Un badge por estado.
- Color del token semántico.
- Nunca usar badge para metadatos (eso es chip).

### 3.4 Chip

**Propósito:** etiqueta de metadato o filtro.

**Diferencia con badge:** más chico, normalmente neutro (gris). No comunica estado crítico.

### 3.5 Alerta (inline)

**Propósito:** mensaje contextual con severidad.

**Variantes:** info (azul) · atención (naranja) · problema (rojo) · ok (verde).

**Estructura:** ícono + mensaje + acción opcional.

**Regla:** aparece en contexto; popup solo si es bloqueante.

### 3.6 Botón

| Variante | Estilo | Uso |
|---|---|---|
| Primario | Fondo azul, texto blanco | Una por pantalla |
| Secundario | Contorno, fondo transparente | Acciones alternativas |
| Terciario | Solo texto | Acciones menores |
| Destructivo | Fondo rojo | Solo irreversible (rechazar, eliminar) |

**Reglas:**
- Grande en planta (min-height 44px para touch).
- Un primario por pantalla.
- Máximo 3 acciones visibles; resto en overflow/menú.

### 3.7 Formulario (guiado)

**Propósito:** captura paso a paso sin error.

**Características:**
- Una columna.
- Etiqueta arriba del campo.
- Revelado progresivo (solo campos del paso actual).
- Validación inline (al salir del campo).
- Paso de confirmación antes de guardar.
- Mensajes de error: "qué pasó + cómo resolver".

### 3.8 Tabla

**Propósito:** consulta, referencia, auditoría.

**Reglas:**
- Cabecera limpia.
- Columna de estado con badge.
- Números alineados a la derecha.
- **Nunca** superficie de trabajo de un operario.

### 3.9 Deck

**Propósito:** lista de cards. Formato por defecto del trabajo en Workspaces.

**Reglas:**
- Gap entre cards: 8–12px.
- Ordenado por urgencia.
- Empty state si vacío.

### 3.10 Dashboard

**Propósito:** panorama/overview para supervisión y dirección.

**Estructura:** fila de KPI tiles + secciones de decks.

**Regla:** secundario a la Bandeja Inteligente.

### 3.11 KPI Tile

**Propósito:** métrica clave con entrada a detalle.

**Estructura:**
```
┌──────────────┐
│ 42           │  ← número grande
│ OE en curso  │  ← etiqueta
│ 🟠           │  ← color semántico
└──────────────┘
```

**Regla:** tocar el tile navega a su worklist filtrada.

### 3.12 Empty State

**Propósito:** comunicar ausencia de trabajo.

**Estructura:** ícono + mensaje + acción opcional.

**Tono positivo:** *"No tenés tareas pendientes ✔"* (no "No hay datos").

### 3.13 Confirmación (modal)

**Propósito:** proteger acciones irreversibles.

**Estructura:**
- Título: qué va a pasar.
- Descripción: consecuencias.
- Botones: Confirmar (primario) / Cancelar (secundario).

**Cuándo:** cerrar OE/OA, firmar liberación, despachar, ajuste de inventario.

### 3.14 Mensaje de error

**Propósito:** guiar al usuario a resolver el problema.

**Formato:** "qué pasó + cómo resolverlo".

**Ejemplos:**
- ❌ *"Error de validación"* → ✅ *"Ese lote está en cuarentena: no se puede consumir. Elegí un lote liberado."*
- ❌ *"Campo inválido"* → ✅ *"La cantidad (150) supera el saldo del lote (120). Ajustá la cantidad."*

**Reglas:** claro, sin culpar, inline cerca del campo.

---

## 4. Gramática de card (estándar único)

Toda tarjeta de trabajo sigue esta estructura:

```
[ícono/identidad] · Título en lenguaje simple · [Badge de estado]
   metadato 1 · metadato 2 · metadato 3
   [señal de urgencia]                        [ACCIÓN PRIMARIA]
```

Aprender a leer **una** card sirve para leerlas **todas**.

---

## 5. Componentes específicos de producción (GMP)

| Card | Identidad/Título | Badge | Metadatos | Urgencia | Acción primaria |
|---|---|---|---|---|---|
| **OE** | OE-ID + producto granel | estado OE | lote granel · tamaño · responsable | avance % | Iniciar / Cargar MP / Cerrar |
| **OA** | OA-ID + SKU | estado OA | lote PT · unidades · responsable | avance % | Iniciar / Cargar ME / Cerrar |
| **Lote** | ítem + nro_lote | estado lote | tipo · saldo | vencimiento | Ver / Despachar |
| **Liberación** | lote + OA/OE | decisión | evidencia · días en cuarentena | antigüedad | Disponer (CA) / Firmar (DT) |
| **Pedido** | PED-ID + cliente | estado pedido | compromiso · avance despacho | compromiso por vencer | Seguir / Despachar |
| **Incidencia** | tipo + orden | severidad | reportó · fecha | severidad | Resolver |
| **Alerta** | tipo (stock/vto/desvío) | severidad | contexto | criticidad | Atender |

Cada card es **autosuficiente**: comunica qué es, su estado, su urgencia y qué hacer, sin abrir nada.

---

## 6. Estados (tabla maestra)

Mapa único estado → token → significado. Fuente de verdad para badges en todo el sistema:

| Estado | Token | Ícono | Aplica a |
|---|---|---|---|
| Liberado | 🟢 Verde | check-circle | Lote, Liberación |
| Completo | 🟢 Verde | check-circle | Renglón de pedido |
| En tolerancia | 🟢 Verde | check-circle | Consumo/control |
| Resuelto | 🟢 Verde | check-circle | Incidencia |
| Cuarentena | 🟠 Naranja | clock | Lote |
| En curso | 🟠 Naranja | play | OE/OA |
| Parcial | 🟠 Naranja | alert-triangle | Renglón de pedido |
| Por vencer | 🟠 Naranja | alert-triangle | Lote |
| Desvío leve | 🟠 Naranja | alert-triangle | Consumo/control |
| Borrador en revisión | 🟠 Naranja | clock | Liberación |
| Rechazado | 🔴 Rojo | x-circle | Lote, Liberación |
| Bloqueado | 🔴 Rojo | ban | Lote |
| Vencido | 🔴 Rojo | alert-octagon | Lote |
| Crítico | 🔴 Rojo | alert-octagon | Alerta |
| Sin lote | 🔴 Rojo | alert-octagon | Consumo |
| Fuera de tolerancia | 🔴 Rojo | alert-octagon | Consumo |
| Pendiente | ⚪ Gris | info-circle | Renglón, tarea |
| Planificada | ⚪ Gris | info-circle | OE/OA, Plan |
| Cerrada | ⚪ Gris | lock | OE/OA |

---

## 7. Lenguaje visual (cómo debe verse una pantalla)

- **Espacio en blanco generoso.** Agrupar con espacio, no con líneas.
- **Un foco por pantalla**, claramente el elemento más grande/contrastado.
- **Botones:** un primario por pantalla; idealmente ≤ 3 acciones visibles.
- **Cuándo usar cada formato:**
  - Card/Deck → trabajo con estado (default).
  - Tabla → consulta/auditoría.
  - Lista simple → enumeraciones/historial.
  - Dashboard → panorama.
  - Formulario guiado → captura paso a paso.
- **Cuándo usar color:** solo estado o acción. Nunca decorativo.
- **Densidad por contexto:**
  - Operario = baja densidad, objetos grandes.
  - Supervisor/dirección = densidad media aceptable.
- **Regla madre:** ninguna pantalla inventa estilo. Si algo no está en este manual, se agrega acá antes de usarlo.

---

## 8. Acciones (vocabulario visual)

| Acción | Estilo botón | Ícono | Cuándo |
|---|---|---|---|
| Iniciar | Primario | play | Empezar OE/OA |
| Cargar / Registrar | Primario | plus | Consumo, producción |
| Cerrar | Primario + confirmación | lock | Cerrar orden |
| Firmar | Primario + confirmación | lock | Liberar/rechazar |
| Despachar | Primario | truck | Salida de PT |
| Resolver | Primario | check-circle | Incidencia, problema |
| Cancelar | Secundario | x | Abortar flujo |
| Ver detalle | Terciario | eye | Consulta |

---

## 9. Relación con otros documentos

| Documento | Contenido |
|---|---|
| `08-workspaces.md` | Cómo se aplican estos componentes en Workspaces |
| `15-frontend.md` | Implementación técnica del Design System |
| `18-convenciones.md` | Lenguaje, mensajes, terminología |
