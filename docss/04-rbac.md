# 04 — RBAC (control de acceso por rol)

Sistema de gobierno de Genus, construido y verificado en la fase F6.0. Define quién puede hacer qué, con filosofía GMP de segregación de funciones.

---

## 1. Filosofía GMP

En un laboratorio regulado, el control de acceso no es una comodidad: es un requisito de cumplimiento. Tres principios:

1. **Default-deny.** Nada está permitido salvo que se otorgue explícitamente. La matriz `PERMISOS` solo contiene lo habilitado; la ausencia es denegación.
2. **Segregación de funciones.** Quien ejecuta o cierra una orden **no puede** ser quien firma su liberación. La persona que produce no se autoaprueba. Esto se refleja en que `ROL-DT` (firma) está separado de `ROL-SU`/`ROL-OP` (ejecución), y en la regla operativa de que el firmante de una liberación debe ser distinto de quien cerró la orden.
3. **Guiado por datos, no hardcodeado.** Los permisos viven en una tabla (`PERMISOS`), no en código ni en condiciones dispersas. Cambiar un permiso = cambiar una fila, auditable.

## 2. Vocabulario de acciones

Ocho acciones canónicas (códigos usados en la matriz):

| Código | Acción | Significado |
|---|---|---|
| C | Crear | Alta de un registro |
| L | Leer | Ver / consultar |
| E | Editar | Modificar un registro existente |
| K | Confirmar | Confirmar un plan / paso |
| X | Cerrar | Cerrar una orden (inmutable) |
| D | Despachar | Registrar salida contra pedido |
| A | Ajuste | Ajuste de inventario |
| F | Firmar | Firmar una liberación (acto legal de DT) |

## 3. Roles

| ID | Rol | Descripción | Estado |
|---|---|---|---|
| `ROL-OP` | Operario | Ejecuta tareas físicas. Diferenciado por `USUARIOS.area` (Elaboración / Acondicionamiento / Depósito). | Activo |
| `ROL-SU` | Supervisor | Planifica, confirma, crea/edita/cierra OE y OA, hace ajustes. | Activo |
| `ROL-CA` | Calidad | Carga análisis y evidencia; prepara disposición. No firma. | Activo |
| `ROL-DT` | Dirección Técnica | Firma la liberación. Responsable legal ANMAT. | Activo |
| `ROL-AD` | Administración | Mantiene maestros (MP/ME) y gestiona pedidos. | Activo |
| `ROL-DI` | Dirección | Lectura integral, tableros. | Activo |
| `ROL-SV` | Servicio (Creamy) | Rol de servicio futuro. Sin permisos. | Inactivo |

## 4. Módulos protegibles (13)

`MOD-MP` Materias primas · `MOD-ME` Materiales de empaque · `MOD-LOT` Lotes · `MOD-MOV` Movimientos · `MOD-SAL` Saldos · `MOD-PED` Pedidos · `MOD-PLA` Planificación · `MOD-OE` Órdenes de elaboración · `MOD-OEC` Consumos de OE · `MOD-OA` Órdenes de acondicionamiento · `MOD-OAM` Materiales de OA · `MOD-ANA` Análisis de calidad · `MOD-LIB` Liberaciones.

## 5. Matriz de permisos (F6.0)

107 filas en `PERMISOS`, default-deny. Resumen por módulo (códigos de §2; "—" = sin acceso, "L" = solo lectura):

| Módulo | OP | SU | CA | DT | AD | DI |
|---|---|---|---|---|---|---|
| **MP / ME** | L | L | L | L | C L E | L |
| **LOT** (Lotes) | C L | C L | L | L | L | L |
| **MOV** (Movimientos) | C L D | C L D A | L | L | L A | L |
| **SAL** (Saldos) | L | L | L | L | L | L |
| **PED** (Pedidos) | L | L | L | L | C L E | L |
| **PLA** (Planificación) | L | C L E K | L | L | L | L |
| **OE** | L | C L E X | L | L | L | L |
| **OEC** (Consumo OE) | C L | C L E | L | L | L | L |
| **OA** | L | C L E X | L | L | L | L |
| **OAM** (Materiales OA) | C L | C L E | L | L | L | L |
| **ANA** (Análisis) | — | L | C L E | L | — | L |
| **LIB** (Liberaciones) | — | L | C L | L F | — | L |

Lectura clave:
- **El operario** crea lotes, registra consumos (OEC/OAM) y movimientos incluido despacho, pero **no** toca análisis ni liberaciones.
- **El supervisor** es el dueño del ciclo productivo: planifica, crea/edita/cierra OE y OA, ajusta inventario.
- **Calidad** es el único que crea análisis y prepara liberaciones, pero **no firma**.
- **Dirección Técnica** es el único con **Firmar (F)** en liberaciones; sobre el resto, lectura.
- **Administración** gobierna maestros y pedidos; puede hacer ajustes de inventario.
- **Dirección** lee todo, no ejecuta.

## 6. Qué puede / no puede hacer cada rol (resumen narrativo)

- **Operario:** *Puede* recibir, registrar consumos guiados, registrar producción y despachar. *No puede* aprobar calidad, firmar, cerrar órdenes, editar maestros.
- **Supervisor:** *Puede* planificar, crear/cerrar OE/OA, ajustar stock, resolver desvíos. *No puede* firmar liberaciones ni editar maestros comerciales.
- **Calidad:** *Puede* cargar análisis y preparar disposiciones. *No puede* firmar la liberación ni operar producción/inventario.
- **Dirección Técnica:** *Puede* firmar liberaciones (liberar/rechazar). *No debería* firmar un lote cuya orden cerró él mismo (segregación). El resto, lectura.
- **Administración:** *Puede* mantener MP/ME y pedidos, ajustes. *No puede* firmar ni cerrar producción.
- **Dirección:** *Puede* ver todo. *No ejecuta.*

## 7. Cómo se resuelve el permiso (mecánica)

En la implementación actual (AppSheet), la resolución es por expresión, guiada por la tabla `PERMISOS`:

- **Rol actual del usuario:** `ROL_ACTUAL = LOOKUP(USEREMAIL(), "USUARIOS", "email", "ROL_ID")`.
- **Helper de permiso:** `PUEDE(modulo, accion) = ISNOTBLANK(FILTER("PERMISOS", AND([ROL_ID]=ROL_ACTUAL, [MODULO_ID]=modulo, [accion]=accion, [permitido]=TRUE)))`.

Tres puntos de control:
1. **Visibilidad de fila** — *Security Filter* por tabla/slice.
2. **Editabilidad de campo** — *Editable_If* usando `PUEDE(...)`.
3. **Disponibilidad de acción** — *Only_If* en cada acción usando `PUEDE(...)`.

Además: **borrado deshabilitado globalmente** (deletes OFF). La UI **oculta** lo no permitido, pero la seguridad real la imponen los `Only_If`/Security Filters, no la ocultación.

> En un front-end propio (futuro), esta misma matriz `PERMISOS` debe consumirse desde la API y aplicarse en backend (autorización del lado servidor), nunca solo en el cliente. Ver `17-api.md`.

## 8. Diferenciación de operarios por área

`ROL-OP` es un solo rol, pero el `area` del usuario (Elaboración / Acondicionamiento / Depósito) determina **qué tareas** ve: un operario de elaboración ve OE/consumos de MP; uno de acondicionamiento ve OA/consumos de ME; depósito ve recepción/despacho. La seguridad es la misma; la experiencia se filtra por área.
