# 18 — Convenciones

El lenguaje del sistema. **Toda construcción debe respetar estas convenciones** para que Genus sea consistente.

---

## 1. Nombres (IDs)

IDs con **prefijo + número**, legibles y estables:

| Entidad | Prefijo | Ejemplo |
|---|---|---|
| Materia prima | `MP-` | `MP-0007` |
| Material de empaque | `ME-` | `ME-0012` |
| Lote | `L-` | `L-0005` |
| Producto terminado / SKU | `PT-` | `PT-0001` |
| Orden de elaboración | `OE-` | `OE-0042` |
| Orden de acondicionamiento | `OA-` | `OA-0031` |
| Pedido | `PED-` | `PED-2026-0007` |
| Renglón de pedido | `PD-` | `PD-0007-01` |
| Análisis de calidad | `ANA-` | `ANA-00015` |
| Liberación | `LIB-` | `LIB-00008` |
| Rol | `ROL-` | `ROL-CA` |
| Módulo | `MOD-` | `MOD-LIB` |
| Permiso | `PRM-` | `PRM-0042` |

- **Nombres de tabla:** MAYÚSCULAS con guión bajo (`PEDIDOS_DET`, `OE_CONSUMO`).
- **Nombres de campo:** minúscula_con_guión_bajo (`fecha_vencimiento`, `cantidad_signo`); los IDs/FK pueden ir en mayúscula (`LOTE_ID`).
- **Lotes (`nro_lote`):** texto **sin espacios**.

## 2. Fechas y horas

- Fecha: `AAAA-MM-DD`. · Marca de tiempo: `AAAA-MM-DD HH:MM:SS`. (Zona horaria de Argentina.)

## 3. Estados (canónicos)

| Entidad | Estados |
|---|---|
| Lote | Cuarentena · Liberado · Rechazado · Condicional · Bloqueado · En reproceso · (Por vencer/Vencido derivados de fecha) |
| OE / OA | Planificada · En curso · Cerrada |
| Renglón de pedido | Pendiente · Parcial · Completo |
| Liberación (decisión) | Liberado · Rechazado · Condicional · Bloqueado |
| Documento (futuro) | Borrador · En revisión · Vigente · Obsoleto |

Los estados **se derivan** (ver `02`/`03`); no se tipean libremente. Sus valores viven en `PARAMETROS`.

## 4. Colores (tokens — ver `07`)

| Token | Hex | Significado |
|---|---|---|
| 🟢 Verde | `#1E8E5A` | OK / aprobado |
| 🟠 Naranja | `#C8881A` | Atención / en proceso / espera |
| 🔴 Rojo | `#C0392B` | Problema / detenido |
| 🔵 Azul | `#2D6CDF` | Acción / marca |
| ⚪ Gris | `#6B7280` | Información / neutro / finalizado |

Regla: un significado = un color. Verde solo para aprobado-calidad; "Cerrada" es gris; azul solo acción.

## 5. Íconos (un ícono por concepto — ver `07`)

OK→check-circle · Espera/Cuarentena→clock · Atención/Por vencer→alert-triangle · Rechazado→x-circle · Bloqueado→ban · Crítico→alert-octagon · En curso→play · Pendiente/Info→info-circle · Crear→plus · Cerrar/Firmar→lock · Despachar→truck · Escanear→scan · Trazabilidad→route.

## 6. Mensajes

- **Lenguaje natural y simple**, en español, orientado a la acción ("Cargá el lote que usaste", no "Registrar movimiento de consumo").
- **Errores:** "qué pasó + cómo resolver", sin culpar, inline. Ej.: *"Ese lote está en cuarentena: no se puede consumir. Elegí un lote liberado."*
- **Confirmaciones:** describen el efecto irreversible. Ej.: *"Vas a cerrar la OE-0042. No podrás modificarla. ¿Confirmás?"*
- **Empty states:** positivos. Ej.: *"No tenés tareas pendientes ✔"*.

## 7. Botones / acciones

- **Un primario por pantalla** (azul). Secundarios en contorno; destructivos en rojo y solo para lo irreversible.
- Verbos de acción del sistema (vocabulario RBAC, `04`): **Crear · Leer · Editar · Confirmar · Cerrar · Despachar · Ajustar · Firmar**. Más, a nivel UX: **Iniciar · Cargar · Marcar listo · Resolver · Atender · Disponer**.
- La acción visible es **siempre** la válida para el estado y el permiso actuales.

## 8. Terminología (glosario operativo)

- **OE / OA / Granel / PT / MP / ME / Lote / BOM / Liberación / DT / RBAC / GMP** — ver glosario del `README.md`.
- **Posta:** el pase automático de trabajo de un rol al siguiente.
- **Bandeja Inteligente:** la superficie de "lo próximo que tenés que hacer".
- **Workspace:** espacio de trabajo por misión.
- **Foco:** la tarea principal que ocupa la pantalla.
- **Liberar:** disponer un lote como apto (firma DT). **No** mueve stock.
- **Cerrar:** finalizar una orden (inmutable). **No** es "aprobado de calidad".

## 9. Reglas de lenguaje transversales

- El sistema habla de **trabajo**, no de tablas ("Tenés 3 lotes para analizar", no "3 registros en ANALISIS_CALIDAD").
- Nunca exponer jerga técnica de la implementación al usuario final.
- Consistencia: el mismo concepto se nombra **siempre igual** en toda la app.
