# 26 — Genus Design System (Base visual oficial)

> **Estado:** F9.5 — tokens en `frontend/src/design-system/`  
> **Alcance:** reglas visuales y guía en `/design-system`. Sin cambios en app operativa, preview, backend ni motores.  
> **Objetivo:** identidad única, escalable, independiente del desarrollador.

---

## 1. Filosofía visual

Genus OS debe transmitir:

- claridad
- organización
- calma
- profesionalismo
- precisión
- laboratorio moderno

**Nunca:** caótico, recargado, lleno de colores o gráficos.

### Prioridad absoluta

> Entender qué tengo que hacer.

### Referencias (no copiar)

Apple · Linear · Notion · Arc Browser · Raycast · Vercel — con **identidad propia** de Laboratorio Genus.

---

## 2. Estructura de archivos

```text
frontend/src/design-system/
├── colors.ts
├── spacing.ts
├── typography.ts
├── radius.ts
├── shadows.ts
├── motion.ts
├── icons.ts
├── status.ts
├── cards.ts
├── panels.ts
├── forms.ts
├── layout.ts
├── creamy.ts
├── tokens.ts          ← objeto unificado + reglas inviolables
├── genus-tokens.css     ← CSS custom properties (--genus-*)
├── index.ts
└── guide/
    ├── nav.ts
    └── genus-design-system-guide.tsx
```

---

## 3. Colores oficiales

| Rol | Token | Hex |
|-----|-------|-----|
| Primario | `--genus-brand-primary` | `#1FA39A` Turquesa Genus |
| Secundario | `--genus-brand-secondary` | `#0F4C5C` Azul petróleo |
| Éxito | `--genus-success` | `#15803D` |
| Advertencia | `--genus-warning` | `#B45309` |
| Error | `--genus-error` | `#B91C1C` |
| Información | `--genus-info` | `#0369A1` |
| Neutros | `--genus-neutral-50` … `900` | Escala slate |

**Regla:** no colores saturados. Un acento por bloque.

---

## 4. Tipografía

| Rol | Tamaño | Uso |
|-----|--------|-----|
| Heading XL | 36px | Saludo sector |
| Heading L | 30px | Sección principal |
| Heading M | 20px | Subsección / línea |
| Body | 16px | Texto operativo |
| Caption | 12px | Metadatos, sync |
| Label | 11px uppercase | Etiquetas de resumen |

Jerarquía marcada, mucho espacio entre bloques.

---

## 5. Espaciado

Escala única (px): **4 · 8 · 12 · 16 · 24 · 32 · 48 · 64**

Tokens CSS: `--genus-space-1` (4px) … `--genus-space-16` (64px).

Nada arbitrario fuera de esta escala.

---

## 6. Cards oficiales

| Tipo | Uso |
|------|-----|
| **Work Card** | Unidad de trabajo — cliente, producto, cantidad, acciones |
| **Summary Card** | Contadores — Para hacer, En progreso, etc. |
| **Panel Card** | Lateral — entregas, problemas |
| **Warning Card** | Alertas operativas |
| **Empty Card** | Sin trabajo — borde punteado |
| **Creamy Card** | Copiloto contextual |

**Regla:** no crear cards fuera de `cards.ts`.

---

## 7. Estados operativos

| Estado | Color | Icono |
|--------|-------|-------|
| Pendiente | Warning | Clock |
| En proceso | Info | Loader |
| Bloqueado | Error | Octagon |
| Completado | Success | Check |
| Urgente | Error solid | Flame |

Definidos en `status.ts` — badge soft por defecto.

---

## 8. Componentes conceptuales

Documentados en `layout.ts` → `genusConceptualComponents`:

- Sidebar, Header, Timeline, WorkItem, Calendario
- Checklist, Tabla (evitar), Formulario, Modal, Drawer, Spotlight

**Solo reglas visuales** en F9.5 — implementación en F10+.

---

## 9. Motion

Presets en `motion.ts`:

| Preset | Duración | Uso |
|--------|----------|-----|
| hover | 120ms | Botones, links |
| expand | 200ms | Acordeones |
| drawer | 320ms | Paneles laterales |
| loading | 200ms | Opacity |
| skeleton | 1.4s | Placeholders |

Todo muy sutil. Nada exagerado.

---

## 10. Creamy — identidad visual

Sin personaje aún. Definido en `creamy.ts`:

- **Creamy Card** — gradiente turquesa suave, borde muted
- **Creamy Bubble** — mensajes sin cola de chat clásico
- **Creamy Suggestions** — pills/chips
- **Creamy Actions** — primary compacto + secundarios

Integrada al OS Shell — **nunca chatbot flotante externo**.

---

## 11. Responsive

| Breakpoint | Prioridad | Comportamiento |
|------------|-----------|----------------|
| Desktop ≥1024px | **Absoluta** | Sidebar + main + context panel |
| Tablet 768–1023px | Secundaria | Context bajo main |
| Mobile <768px | Consulta | Single column |

Operarios en estaciones de trabajo — desktop first.

---

## 12. Página de referencia

**URL:** `/design-system`

Muestra: colores, tipografía, espaciado, botones, badges, estados, cards, paneles, Creamy, motion, reglas inviolables.

Scope CSS: `.genus-ds-root` — no contamina `/design-preview` ni app operativa.

---

## 13. Reglas que nunca deben romperse

Ver `genusDesignRules` en `tokens.ts`:

1. Prioridad: qué tengo que hacer en 5 segundos
2. Un acento de color por bloque
3. No colores saturados
4. No tablas densas ERP — preferir cards
5. No KPIs en home operarios
6. Espaciado solo de escala oficial
7. Cards solo de tipos registrados
8. Estados solo de `status.ts`
9. Creamy integrada al shell
10. Desktop first
11. Motion sutil
12. Sombras mínimas

---

## 14. Relación con otros módulos

| Módulo | F9.5 |
|--------|------|
| `/design-preview` | **No modificado** — mantiene `--os-*` propios |
| Role Engine | **No modificado** |
| Workflow Engine | **No modificado** |
| App `/mi-trabajo` | **No existe aún** |
| `lib/tokens/` legacy | Conservado — migración gradual F10 |

---

## 15. Próximo paso (F10)

1. Migrar `/design-preview` a tokens `--genus-*`
2. Promover shell OS con `genus-tokens.css`
3. Componentes UI finales consumen `@/design-system`
4. Ninguna pantalla nueva sin pasar por esta guía

---

## 16. Visión

Dentro de un año, cualquier pantalla nueva mantendrá la misma identidad visual y calidad, independientemente del desarrollador.

El Design System es la **constitución visual** de Genus OS.
