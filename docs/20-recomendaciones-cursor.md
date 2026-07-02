# 20 — Recomendaciones para Cursor AI

> Este documento está escrito **exclusivamente para Cursor AI** (o cualquier asistente de código), como si el Tech Lead del proyecto te explicara todo en tu primer día. **Leelo antes de escribir una sola línea.** Si algo en otro documento contradice a este, preguntá antes de actuar.

---

## 1. Cómo entender el proyecto (en 60 segundos)

Genus Operaciones es el sistema de un **laboratorio cosmético GMP** (ANMAT, ISO 9001) que cubre:

```
pedido → planificación → elaboración (OE/granel) → acondicionamiento (OA/PT)
       → calidad → liberación → despacho
```

Con trazabilidad por lote y control de acceso por rol.

**Dos capas:**
1. **Backend que ya funciona** (Google Sheets + AppSheet, F1–F4.1 y RBAC F6.0).
2. **Capa de experiencia** (F7) **diseñada pero no construida**.

**Tu trabajo, en general:** construir la experiencia reutilizando el backend tal cual. **No rehacer el backend.**

---

## 2. Orden de lectura obligatorio

```
1.  00-vision-general.md      ← filosofía (POR QUÉ)
2.  02-arquitectura.md        ← cómo encaja todo
3.  03-modelo-de-datos.md     ← contrato de datos
4.  04-rbac.md                ← quién puede qué
5.  05-flujos-operativos.md    ← recorrido del laboratorio
6.  07-design-system.md       ← cómo se ve
7.  08-workspaces.md           ← cómo se organiza el trabajo
8.  09-bandeja-inteligente.md  ← la pantalla central
9.  14-roadmap.md              ← qué está hecho y qué falta
10. 16-backend.md              ← qué NO tocar
11. 17-api.md                  ← cómo conectar front-end
12. 20-recomendaciones-cursor.md ← este documento
```

**Para construir front-end:** sumar `15-frontend.md`.

**Para planificar:** sumar `19-pendientes.md`.

---

## 3. Principios que NUNCA debés romper

Estos son **inviolables**. Romper uno es un bug de cumplimiento GMP, no de UI.

### 3.1 MOVIMIENTOS es append-only

```
❌ UPDATE MOVIMIENTOS SET cantidad = 100 WHERE MOV_ID = '...'
❌ DELETE FROM MOVIMIENTOS WHERE ...
✅ INSERT INTO MOVIMIENTOS (tipo='Ajuste +', cantidad=20, motivo='Corrección')
```

Toda corrección es un movimiento nuevo. El signo lo calcula `cantidad_signo` (fórmula). **Nunca** escribas cantidades negativas a mano.

### 3.2 SALDOS es derivado

```
❌ UPDATE SALDOS SET cantidad_actual = 500
✅ Leer SALDOS (es fórmula) o calcular SUM(cantidad_signo) de MOVIMIENTOS
```

Si el saldo no coincide con la realidad, registrar un ajuste en MOVIMIENTOS.

### 3.3 LIBERACIONES es append-only y única vía de cambio de estado de lote

```
❌ UPDATE LOTES SET estado = 'Liberado'
✅ INSERT INTO LIBERACIONES (decision='Liberado', libero_direccion_tecnica='caio@...')
```

El estado del lote refleja la **última** liberación.

### 3.4 Los estados se derivan, no se tipean

| Entidad | Derivación |
|---|---|
| Lote | Última LIBERACIONES |
| Renglón pedido | Suma despachos vs. pedido |
| OE/OA | Transición de flujo |

No agregues campos manuales que dupliquen un estado derivable.

### 3.5 La fórmula vive en BOM y se congela

```
OE.bom_version = BOM.version al momento de crear la OE
```

Cambiar un BOM no altera órdenes históricas.

### 3.6 Dos barreras de liberación

- Granel debe estar **Liberado** para acondicionarse.
- PT debe estar **Liberado** para despacharse.

No habilites saltar estas barreras.

### 3.7 Segregación de funciones

Quien ejecuta/cierra una orden **no firma** su liberación. Respetá la matriz PERMISOS y la regla firmante ≠ cerrador.

### 3.8 RBAC default-deny, del lado servidor

```typescript
// ❌ Solo en el cliente
if (user.rol === 'ROL-DT') showFirmarButton();

// ✅ En API
if (!PUEDE(user.rol, 'MOD-LIB', 'Firmar')) throw Forbidden();
```

La UI oculta, pero la seguridad real está en backend.

### 3.9 Todo cambio al modelo es aditivo

Agregá columnas/tablas **al final**. No rompas fórmulas ni columnas existentes (especialmente MOVIMIENTOS columnas A–M y SALDOS).

### 3.10 El usuario no navega tablas para trabajar

```
❌ Mostrar grilla de OE_CONSUMO al operario para que registre consumos
✅ Card "Cargá el lote de Agua que usaste" → formulario guiado → confirmar
```

---

## 4. Qué arquitectura respetar

### Backend no cambia (`16-backend.md`)

- Google Sheets = base de datos.
- AppSheet = capa de aplicación.
- Bots/Apps Script = automatizaciones.
- **Reutilizá todo esto.** No reescribas la lógica.

### Modelo de datos es el contrato (`03-modelo-de-datos.md`)

| Marca | Tratamiento |
|---|---|
| [VERIFICADA] | Inmutable. No cambies estructura. |
| [DISEÑADA] | Contrato de implementación. Construí como está especificado. |
| [PROPUESTA] | Dirección a confirmar. No inventes; preguntá. |

### RBAC es la autoridad (`04-rbac.md`)

Consumí la matriz PERMISOS. No hardcodees permisos en código.

```typescript
// ✅ Correcto
const canClose = await api.permissions.check(rolId, 'MOD-OE', 'Cerrar');

// ❌ Incorrecto
const canClose = rolId === 'ROL-SU';
```

---

## 5. Qué estilo mantener

### Design System (`07-design-system.md`)

- **Tokens de color semánticos:** un significado = un color.
- **Gramática de card única:** identidad · título · badge · metadatos · urgencia · acción.
- **Iconografía:** un ícono por concepto.
- **Espaciado base 8.**

Usá los tokens como variables CSS/JS. No inventes colores por pantalla.

### Lenguaje (`18-convenciones.md`)

- Español, natural, orientado a la acción.
- Errores: "qué pasó + cómo resolver".
- Empty states positivos.
- Un botón primario por pantalla.

### Workspaces (`08-workspaces.md`)

- Por misión (Producción, Calidad, Comercial, etc.).
- Rol como lente.
- Secciones canónicas: Ahora / En cola / Esperando aprobación / Esperando a otros / Problemas / Finalizados.

---

## 6. Qué decisiones YA están tomadas (no las reabras)

| Decisión | Implicancia |
|---|---|
| Inventario = libro mayor append-only + saldos derivados | No hay otro modelo de stock |
| Estados derivados | No campos manuales de estado |
| Despacho directo contra renglón de pedido | No existe entidad "Orden de Despacho" |
| ME se consume por lote en OA | Resuelve hueco GMP histórico |
| Un rol por usuario; operarios por área | No multi-rol |
| RBAC guiado por datos, default-deny, deletes off | No permisos en código |
| Workspaces por misión; Bandeja como norte | No navegación por módulos/tabla |
| TAREAS como pieza unificadora | Pendiente pero decidido |
| Design System con tokens de `07` | "Cerrada"=gris, azul=acción, verde=aprobado |
| Backend no se reemplaza | Front-end es otra interfaz |

---

## 7. Qué NO debés modificar

- Fórmulas de `MOVIMIENTOS.cantidad_signo`, `SALDOS.cantidad_actual`, cumplimientos de `PEDIDOS_DET`.
- Estructura [VERIFICADA] de `LOTES`, `MOVIMIENTOS`, `SALDOS`, `USUARIOS`, `ROLES`, `MODULOS`, `PERMISOS`.
- Reglas de integridad (append-only, derivado, barreras, segregación).
- Semántica de color/estado del Design System.

---

## 8. Qué SÍ podés mejorar

| Área | Ejemplos |
|---|---|
| Experiencia | Workspaces, Bandeja, formularios guiados, escaneo, empty states |
| KPIs | Cálculos derivados (avance %, días en cuarentena) sin duplicar estados |
| Automatizaciones | Posta entre roles, notificaciones (respetando RBAC) |
| Capas aditivas | TAREAS, INCIDENCIAS sobre el modelo existente |
| Front-end propio | `15-frontend.md` + `17-api.md` cuando se decida |
| Microcopy | Mensajes de error, confirmaciones, empty states |

---

## 9. Cómo debés pensar cuando programes

### Checklist antes de cada cambio

```
□ ¿Viola algún principio de §3?
□ ¿Es aditivo o rompe algo existente?
□ ¿Duplica un estado que se puede derivar?
□ ¿La validación crítica está en servidor?
□ ¿Usa componentes/tokens del Design System?
□ ¿El operario sabe qué hacer sin pensar?
□ ¿Tiene trazabilidad (usuario, timestamp, referencia)?
```

### Patrones de código

**Lectura de saldo:**
```typescript
// ✅ Leer de API que consulta SALDOS (derivado)
const saldo = await api.balances.get(loteId);

// ❌ Calcular en cliente sin pasar por backend
const saldo = movimientos.filter(...).reduce(...);
```

**Registro de consumo:**
```typescript
// ✅ API valida y registra
await api.oe.consumption(oeId, { loteId, cantidad });
// API internamente: valida lote, estado, saldo → crea OE_CONSUMO → crea MOVIMIENTOS

// ❌ Escribir directo a Sheets desde cliente
sheets.append('OE_CONSUMO', [...]);
```

**Autorización:**
```typescript
// ✅ Siempre en API
app.post('/v1/oe/:id/close', requirePermission('MOD-OE', 'Cerrar'), handler);

// ❌ Solo en UI
{canClose && <Button>Cerrar</Button>}
```

### Ante la duda

- Áreas marcadas `[PROPUESTA]` o "MÓDULO FUTURO" (Creamy, Comunicación, Procedimientos, Capacitaciones): **no están diseñadas en detalle**. Confirmá alcance antes de construir. No inventes decisiones regulatorias.

---

## 10. Tu primer entregable recomendado

Seguí el **roadmap de `14-roadmap.md`**:

### Paso 0: Prerrequisito (P0)

Verificar/incorporar tablas de gobierno (`ROLES`, `MODULOS`, `PERMISOS`, `ROL_ID` en `USUARIOS`) al Sheet de producción. Sin esto, RBAC no opera. Ver `19-pendientes.md` §1.

### Paso 1: Fase 1 — La cara nueva (bucket A, P0)

- Aplicar Design System (badges, color semántico, format rules).
- Colapsar navegación a lenguaje ERP.
- Ocultar tablas técnicas por rol.
- Mostrar solo la acción válida por estado.

**Impacto:** máximo. **Riesgo:** cero (no toca modelo ni seguridad).

### Paso 2: Fase 2 — Operario guiado (bucket A/B, P1)

- Centro de Operaciones por rol (secciones por estado).
- Formularios guiados con validación.
- Escaneo de lote.
- KPIs de conteo.

### Paso 3: Después

- KPIs computados, notificaciones simples, INCIDENCIAS.
- TAREAS + automatizaciones de la posta.
- Front-end propio (proyecto aparte).

---

## 11. Estructura de archivos sugerida para desarrollo

```
/workspace
├── docs/                    ← esta documentación (fuente de verdad)
├── frontend/                ← (futuro) app React/Next.js
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── types/
│   └── package.json
├── api/                     ← (futuro) servicio API
│   ├── src/
│   └── package.json
└── README.md
```

---

## 12. Comandos y herramientas

### Para AppSheet (experiencia actual)

- Los cambios de UX se hacen en el editor de AppSheet.
- Security Filters, Editable_If, Only_If usan la función `PUEDE()`.
- Bots para automatizaciones de la posta.

### Para front-end propio (futuro)

```bash
# Setup
cd frontend && npm install

# Desarrollo
npm run dev

# Tests
npm run test
npm run test:e2e
```

### Para API (futuro)

```bash
cd api && npm install
npm run dev
```

---

## 13. Preguntas frecuentes de implementación

**¿Puedo agregar un campo `estado_manual` a LOTES?**
No. El estado se deriva de LIBERACIONES.

**¿Puedo editar un movimiento para corregir un error?**
No. Creá un movimiento de ajuste (Ajuste + o Ajuste −).

**¿Puedo mostrar una tabla de MOVIMIENTOS al operario?**
No para trabajar. Solo para consulta/auditoría (supervisor, dirección).

**¿Puedo hardcodear que DT puede firmar?**
No. Usá la matriz PERMISOS.

**¿Puedo crear la tabla TAREAS?**
Sí, es aditiva. Pero primero completá Fase 1 y 2 del roadmap.

**¿Puedo empezar por Creamy?**
No recomendado. Requiere Procedimientos (RAG) y es módulo futuro. Priorizá experiencia visible.

---

## 14. Contactos y dominio

- **Laboratorio:** Laboratorio Genus, Avellaneda, Buenos Aires, Argentina.
- **Dominio email:** `@laboratoriogenus.com.ar`
- **Dirección Técnica:** Farm. Caio David Zunich (`caio@laboratoriogenus.com.ar`)
- **Regulador:** ANMAT (Argentina)

---

## 15. Resumen de una frase

> Construí la **experiencia** que describen `07`–`09` y `15`, **reutilizando** el backend de `16` a través de los contratos de `03`/`04`/`17`, **sin romper jamás** los diez principios de §3.

---

## 16. Relación con otros documentos

| Documento | Cuándo consultarlo |
|---|---|
| `03-modelo-de-datos.md` | Antes de tocar cualquier tabla |
| `04-rbac.md` | Antes de implementar permisos |
| `07-design-system.md` | Antes de crear cualquier UI |
| `14-roadmap.md` | Para planificar qué construir |
| `19-pendientes.md` | Para saber qué falta |
| `16-backend.md` | Cuando tengas la tentación de "mejorar" el backend |
