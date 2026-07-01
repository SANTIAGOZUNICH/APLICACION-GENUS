# 08 — Workspaces

A partir de F7, Genus se organiza por **trabajo**, no por **dato**. Se abandona el concepto de "módulos como punto de entrada" y se adopta el de **Workspaces**. Cada persona entra a un espacio y ve únicamente lo que tiene que hacer.

> **Decisión de arquitectura de experiencia:** Workspaces **por misión** (Producción, Calidad, Comercial, Inventario/Depósito, Dirección, Dirección Técnica), con el **rol como lente** (qué se ve y qué acciones se pueden ejecutar dentro de cada misión, vía RBAC). Para un laboratorio GMP esto mantiene el contexto de cada dominio junto (mejor para trazabilidad y auditoría) y reduce la cantidad de espacios, sin que el operario pierda el foco de "una tarea a la vez".

---

## 1. Anatomía de un Workspace

Todos comparten la misma estructura; cambia el contenido por misión/rol:

1. **Encabezado de misión** — la frase-misión ("Lo que requiere decisión"), no "Inicio".
2. **Foco principal** — la sección que importa ahora, abierta y arriba (~80% de la atención).
3. **Secciones secundarias** — el resto, colapsables.
4. **Tarjetas de trabajo** — cada ítem, con la gramática de card del Design System (`07`): título simple, badge, metadatos, urgencia, una acción primaria. Tocarla entra a un flujo.

Un Workspace **no** es un dashboard para leer ni un menú de módulos: es una **cola de trabajo organizada por significado**.

---

## 2. Vocabulario canónico de secciones

Seis secciones estándar; cada misión/rol usa un subconjunto y define cuál es el foco. Esta gramática común hace que aprender un Workspace sirva para entenderlos todos.

| Sección | Significado | Alimentada por | Acción típica |
|---|---|---|---|
| **Ahora** (Trabajo de hoy) | Lo que tengo que hacer ya | Asignado + en curso / vence hoy | la acción contextual |
| **En cola** (Por hacer) | Asignado, no empezado | Planificado / pendiente, mío | Iniciar |
| **Esperando aprobación / decisión** | Requiere **mi** decisión | Listo para cerrar/firmar/confirmar | Aprobar / Cerrar / Firmar |
| **Esperando a otros** | Hice mi parte, depende de otro | En manos de otro (posta entregada) | — (informativo) |
| **Problemas / Atención** | Excepciones | Desvío, faltante, incidencia, vencimiento, rechazo | Resolver |
| **Finalizados** (Hecho) | Completado reciente | Cerrado/liberado/despachado hoy | — (colapsado) |

"Problemas" y "Esperando a otros" están en casi todas las misiones: son el sistema mostrando el estado sin que se lo busque.

---

## 3. Priorización

Dentro de cada sección, el orden es por **urgencia**, no por fecha de carga:
1. Bloqueante / problema. 2. Compromiso/vencimiento próximo. 3. Antigüedad. 4. Orden del plan.
El usuario no prioriza: recibe lo más urgente arriba.

---

## 4. Los Workspaces

### Workspace Producción
- **Misión:** fabricar lo planificado, sin error.
- **Lente Operario** (foco): **Ahora** = su tarea actual (una sola); En cola; Problemas (lo que reportó/lo bloquea); Esperando a otros; Finalizados.
- **Lente Supervisor** (foco): **Esperando tu decisión** (OE/OA para cerrar, planes para confirmar); Problemas (desvíos, faltantes); En curso (panorama); Esperando a otros; Finalizados.
- **Acciones:** Operario → iniciar, cargar consumo, cargar control, marcar listo. Supervisor → confirmar plan, cerrar OE/OA, resolver/derivar.

### Workspace Calidad
- **Misión:** controlar y disponer.
- **Foco:** **Para analizar / disponer** (lotes en cuarentena, por antigüedad); Problemas (rechazos, desvíos); Esperando firma (lo pasado a DT); Finalizados.
- **Acciones:** cargar análisis, preparar disposición. (No firma.)

### Workspace Dirección Técnica
- **Misión:** garantizar el cumplimiento; firmar.
- **Foco:** **Esperando tu firma** (disposiciones en borrador, con evidencia al lado); Problemas (rechazos a decidir); Finalizados (firmado hoy).
- **Acciones:** **Firmar liberación** (liberar/rechazar). Segregación: no se le ofrece firmar un lote cuya orden cerró él mismo.
- *(Si en la práctica lo ejerce la misma persona que Dirección, "Esperando tu firma" puede integrarse como sección dentro de Dirección.)*

### Workspace Inventario / Depósito
- **Misión:** mover lo que hay que mover.
- **Foco:** **Para mover** (despachos listos: pedidos con PT liberado; recepciones pendientes); Problemas (stock crítico, vencimientos); Esperando a otros (lotes recién recibidos en cuarentena); Finalizados.
- **Acciones:** recepcionar, despachar (guiado, con escaneo).

### Workspace Comercial
- **Misión:** que los pedidos se cumplan a tiempo.
- **Foco:** **Necesita seguimiento** (compromiso por vencer, estancados); En producción (panorama de avance); Listos para despachar; Problemas (retrasos); Cerrados.
- **Acciones:** seguir/apurar, confirmar entregas, crear pedidos.

### Workspace Dirección
- **Misión:** atender lo que se sale de lo normal.
- **Foco:** **Excepciones** (KPIs fuera de rango, rechazos, retrasos, quiebres); Panorama (resumen ejecutivo, secundario).
- **Acciones:** mayormente lectura; profundizar en una excepción; escalar. Es un **buzón de excepciones**; vacío = todo en orden.

---

## 5. Cómo se construyen (reuso del Design System)

- Un Workspace = un **Dashboard** compuesto por **secciones**.
- Cada sección = un **Deck** de **tarjetas de trabajo** (gramática de card de `07`).
- Estado por **tokens de color/ícono** (`07`), iguales en todos los workspaces.
- Una **acción primaria** por card, derivada del estado.
- **Empty State** positivo cuando una sección está vacía.

No hay dos diseños: el Design System es el vocabulario; los Workspaces son las frases.
