# 04 — RBAC (control de acceso por rol)

Sistema de gobierno de Genus, construido y verificado en la fase F6.0. Define quién puede hacer qué, con filosofía GMP de segregación de funciones.

---

## 1. Filosofía GMP del control de acceso

En un laboratorio regulado, el control de acceso no es una comodidad: es un **requisito de cumplimiento**. Tres principios fundamentales:

### 1.1 Default-deny

Nada está permitido salvo que se otorgue explícitamente. La matriz `PERMISOS` solo contiene lo habilitado (`permitido = TRUE`); la ausencia de una fila es denegación. No existe "acceso por defecto" que luego se restringe.

### 1.2 Segregación de funciones

Quien ejecuta o cierra una orden **no puede** ser quien firma su liberación. La persona que produce no se autoaprueba. Esto se refleja en:

- `ROL-DT` (firma) separado de `ROL-SU`/`ROL-OP` (ejecución).
- Regla operativa: el firmante de una liberación debe ser distinto de quien cerró la orden.
- Calidad prepara la disposición pero **no firma**; solo DT firma.

### 1.3 Guiado por datos, no hardcodeado

Los permisos viven en una tabla (`PERMISOS`), no en código ni en condiciones dispersas en múltiples vistas. Cambiar un permiso = cambiar una fila, auditable. Esto permite:

- Ajustar permisos sin tocar código.
- Auditar quién cambió qué permiso y cuándo.
- Replicar la misma lógica en AppSheet y en la API futura.

---

## 2. Vocabulario de acciones

Ocho acciones canónicas usadas en la matriz `PERMISOS`:

| Código | Acción | Significado | Ejemplo de uso |
|---|---|---|---|
| C | Crear | Alta de un registro nuevo | Crear OE, crear lote, crear pedido |
| L | Leer | Ver / consultar | Ver saldos, ver historial de movimientos |
| E | Editar | Modificar un registro existente | Editar OE en curso, editar pedido |
| K | Confirmar | Confirmar un plan o paso intermedio | Confirmar planificación |
| X | Cerrar | Cerrar una orden (inmutable después) | Cerrar OE, cerrar OA |
| D | Despachar | Registrar salida contra pedido | Despachar PT liberado |
| A | Ajuste | Ajuste de inventario | Ajuste positivo/negativo de stock |
| F | Firmar | Firmar una liberación (acto legal de DT) | Liberar/rechazar lote |

---

## 3. Roles

| ID | Rol | Descripción | Estado |
|---|---|---|---|
| `ROL-OP` | Operario | Ejecuta tareas físicas. Diferenciado por `USUARIOS.area` (Elaboración / Acondicionamiento / Depósito). | Activo |
| `ROL-SU` | Supervisor | Planifica, confirma, crea/edita/cierra OE y OA, hace ajustes de inventario. | Activo |
| `ROL-CA` | Calidad | Carga análisis y evidencia; prepara disposición de liberación. **No firma.** | Activo |
| `ROL-DT` | Dirección Técnica | Firma la liberación de lote. Responsable legal ANMAT. | Activo |
| `ROL-AD` | Administración | Mantiene maestros (MP/ME) y gestiona pedidos. | Activo |
| `ROL-DI` | Dirección | Lectura integral, tableros ejecutivos. No ejecuta operaciones. | Activo |
| `ROL-SV` | Servicio (Creamy) | Rol de servicio futuro para el asistente conversacional. Sin permisos actualmente. | Inactivo |

---

## 4. Módulos protegibles (13)

Cada módulo corresponde a una tabla o grupo funcional del sistema:

| ID | Módulo | Tabla/Área |
|---|---|---|
| `MOD-MP` | Materias primas | `MATERIAS_PRIMAS` |
| `MOD-ME` | Materiales de empaque | `MATERIALES_EMPAQUE` |
| `MOD-LOT` | Lotes | `LOTES` |
| `MOD-MOV` | Movimientos | `MOVIMIENTOS` |
| `MOD-SAL` | Saldos | `SALDOS` |
| `MOD-PED` | Pedidos | `PEDIDOS`, `PEDIDOS_DET` |
| `MOD-PLA` | Planificación | `PLANIFICACION` |
| `MOD-OE` | Órdenes de elaboración | `OE` |
| `MOD-OEC` | Consumos de OE | `OE_CONSUMO` |
| `MOD-OA` | Órdenes de acondicionamiento | `OA` |
| `MOD-OAM` | Materiales de OA | `OA_MATERIALES` |
| `MOD-ANA` | Análisis de calidad | `ANALISIS_CALIDAD` |
| `MOD-LIB` | Liberaciones | `LIBERACIONES` |

---

## 5. Matriz de permisos completa (F6.0)

107 filas en `PERMISOS`, default-deny. Resumen por módulo (códigos de §2; "—" = sin acceso):

| Módulo | OP | SU | CA | DT | AD | DI |
|---|---|---|---|---|---|---|
| **MP** (Materias primas) | L | L | L | L | C L E | L |
| **ME** (Materiales empaque) | L | L | L | L | C L E | L |
| **LOT** (Lotes) | C L | C L | L | L | L | L |
| **MOV** (Movimientos) | C L D | C L D A | L | L | L A | L |
| **SAL** (Saldos) | L | L | L | L | L | L |
| **PED** (Pedidos) | L | L | L | L | C L E | L |
| **PLA** (Planificación) | L | C L E K | L | L | L | L |
| **OE** (Elaboración) | L | C L E X | L | L | L | L |
| **OEC** (Consumo OE) | C L | C L E | L | L | L | L |
| **OA** (Acondicionamiento) | L | C L E X | L | L | L | L |
| **OAM** (Materiales OA) | C L | C L E | L | L | L | L |
| **ANA** (Análisis) | — | L | C L E | L | — | L |
| **LIB** (Liberaciones) | — | L | C L | L F | — | L |

### Lectura clave de la matriz

- **Operario (`ROL-OP`):** crea lotes, registra consumos (OEC/OAM) y movimientos incluido despacho. **No** toca análisis ni liberaciones. **No** cierra órdenes.
- **Supervisor (`ROL-SU`):** dueño del ciclo productivo. Planifica, crea/edita/cierra OE y OA, ajusta inventario. **No** firma liberaciones ni edita maestros comerciales.
- **Calidad (`ROL-CA`):** único que crea análisis y prepara liberaciones. **No firma.** No opera producción ni inventario.
- **Dirección Técnica (`ROL-DT`):** único con **Firmar (F)** en liberaciones. Sobre el resto, solo lectura.
- **Administración (`ROL-AD`):** gobierna maestros (MP/ME) y pedidos. Puede hacer ajustes de inventario. **No** firma ni cierra producción.
- **Dirección (`ROL-DI`):** lee todo. **No ejecuta** ninguna operación.

---

## 6. Qué puede / no puede hacer cada rol (detalle narrativo)

### Operario (`ROL-OP`)

**Puede:**
- Recibir insumos (crear lotes de MP/ME).
- Registrar consumos guiados en OE (MP) y OA (ME).
- Registrar producción de granel y PT.
- Despachar PT liberado contra pedido.
- Consultar saldos y lotes.

**No puede:**
- Aprobar calidad ni firmar liberaciones.
- Cerrar órdenes (OE/OA).
- Editar maestros (MP, ME, productos, clientes).
- Hacer ajustes de inventario.
- Crear o editar pedidos.
- Planificar producción.

**Diferenciación por área:**
- `area = Elaboración`: ve OE y consumos de MP.
- `area = Acondicionamiento`: ve OA y consumos de ME.
- `area = Depósito`: ve recepción y despacho.

### Supervisor (`ROL-SU`)

**Puede:**
- Planificar producción (crear/editar/confirmar planes).
- Crear, editar y cerrar OE y OA.
- Ajustar stock (movimientos de ajuste).
- Consultar todo el inventario y producción.
- Resolver desvíos operativos.

**No puede:**
- Firmar liberaciones (eso es DT).
- Editar maestros comerciales (clientes, productos).
- Crear análisis de calidad.

### Calidad (`ROL-CA`)

**Puede:**
- Cargar análisis de calidad (`ANALISIS_CALIDAD`).
- Preparar disposiciones de liberación (sin firmar).
- Consultar lotes, órdenes, movimientos.

**No puede:**
- Firmar la liberación (eso es DT).
- Operar producción (consumos, cierre de órdenes).
- Hacer ajustes de inventario.
- Crear o editar pedidos.

### Dirección Técnica (`ROL-DT`)

**Puede:**
- Firmar liberaciones (liberar/rechazar/condicional/bloquear).
- Consultar todo (análisis, evidencia, historial).

**No puede / no debe:**
- Firmar un lote cuya orden cerró él mismo (segregación).
- Operar producción ni cargar análisis.
- Hacer ajustes de inventario.

### Administración (`ROL-AD`)

**Puede:**
- Mantener maestros de MP y ME (crear/editar).
- Gestionar pedidos (crear/editar).
- Hacer ajustes de inventario.
- Consultar saldos.

**No puede:**
- Firmar liberaciones.
- Cerrar órdenes de producción.
- Crear análisis de calidad.

### Dirección (`ROL-DI`)

**Puede:**
- Ver todo el sistema (lectura integral).
- Acceder a tableros y KPIs.

**No puede:**
- Ejecutar ninguna operación (crear, editar, cerrar, firmar, despachar).

---

## 7. Qué vistas ve cada rol

| Rol | Workspaces visibles | Foco principal |
|---|---|---|
| Operario Elaboración | Producción | Su OE actual, consumos de MP |
| Operario Acondicionamiento | Producción | Su OA actual, consumos de ME |
| Operario Depósito | Inventario/Depósito | Recepciones y despachos pendientes |
| Supervisor | Producción | OE/OA para cerrar, problemas, en curso |
| Calidad | Calidad | Lotes en cuarentena, preparar disposición |
| Dirección Técnica | Dirección Técnica | Cola de firmas con evidencia |
| Administración | Comercial | Pedidos, maestros |
| Dirección | Dirección | Excepciones, panorama ejecutivo |

---

## 8. Cómo se resuelve el permiso (mecánica de implementación)

### En AppSheet (implementación actual)

**Rol actual del usuario:**
```
ROL_ACTUAL = LOOKUP(USEREMAIL(), "USUARIOS", "email", "ROL_ID")
```

**Helper de permiso:**
```
PUEDE(modulo, accion) = ISNOTBLANK(
  FILTER("PERMISOS",
    AND([ROL_ID] = ROL_ACTUAL,
        [MODULO_ID] = modulo,
        [accion] = accion,
        [permitido] = TRUE)
  )
)
```

### Tres puntos de control

1. **Visibilidad de fila** — *Security Filter* por tabla/slice. El usuario solo ve las filas que le corresponden.
2. **Editabilidad de campo** — *Editable_If* usando `PUEDE(...)`. Los campos no permitidos son de solo lectura.
3. **Disponibilidad de acción** — *Only_If* en cada acción usando `PUEDE(...)`. Las acciones no permitidas no aparecen.

### Reglas adicionales

- **Borrado deshabilitado globalmente** (deletes OFF en todas las tablas).
- La UI **oculta** lo no permitido, pero la seguridad real la imponen los `Only_If`/Security Filters, no la ocultación.
- Nunca confiar solo en ocultar botones en el cliente.

### En front-end propio (futuro)

La misma matriz `PERMISOS` debe consumirse desde la API y aplicarse en **backend** (autorización del lado servidor). Ver `17-api.md`.

```
GET /v1/me → { usuario, rol, permisos[] }
POST /v1/oe/{id}/close → API valida PUEDE("MOD-OE", "Cerrar") antes de ejecutar
```

---

## 9. Diferenciación de operarios por área

`ROL-OP` es un solo rol con tres áreas operativas:

| Área | Qué ve | Qué hace |
|---|---|---|
| Elaboración | OE, consumos de MP | Elaborar granel |
| Acondicionamiento | OA, consumos de ME | Envasar PT |
| Depósito | Recepción, despacho | Mover stock |

La seguridad (permisos en `PERMISOS`) es la misma para los tres. La experiencia se filtra por `USUARIOS.area` mediante slices y security filters en AppSheet, o filtros en la API.

---

## 10. Segregación en la práctica: ejemplos

### Ejemplo 1: Liberación de granel

1. Operario elabora y marca OE lista → **no puede cerrar** (solo Supervisor).
2. Supervisor cierra OE → granel en cuarentena.
3. Calidad carga análisis y prepara disposición → **no puede firmar**.
4. DT firma liberación → granel Liberado.
5. DT **no debería** haber cerrado esa OE (si lo hizo, el sistema debe advertir o bloquear la firma).

### Ejemplo 2: Despacho

1. PT liberado por DT.
2. Operario de Depósito despacha → tiene permiso `D` en `MOD-MOV`.
3. Operario de Elaboración **no puede** despachar aunque vea el PT.

---

## 11. Relación con otros documentos

| Documento | Contenido |
|---|---|
| `03-modelo-de-datos.md` | Tablas USUARIOS, ROLES, MODULOS, PERMISOS |
| `08-workspaces.md` | Cómo el rol actúa como lente en cada Workspace |
| `16-backend.md` | RBAC como parte del backend que no cambia |
| `17-api.md` | Autorización del lado servidor |
| `19-pendientes.md` | Incorporación de tablas de gobierno a producción |
