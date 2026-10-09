# 49 — Etapa 2: Depósito ME como planillas editables (Ingresos, Salidas, Inventario)

Estado al 2026-10-09. Rama `claude/deposito-planilla-etapa2`, que parte de `main` y incluye los PR #112 y #114 (merge de `main`). **Sin migraciones**: usa las tablas existentes `inv_me_*`, `inv_ajustes` e `inv_audit`.

## 1. Salidas manuales y descuento de stock

| Cómo estaba | Qué cambia |
|---|---|
| Al entregar una OA, `me-oa-bridge` crea salidas con origen **OA** por cada material «usado». Solo esas descuentan stock. | Sin cambios. |
| Las salidas **manuales** nunca descontaban, aunque el formulario decía «obligatorio para descontar». | Las salidas manuales nuevas descuentan **solo** si su motivo lo indica: devolución, descarte o rotura, traslado, muestra u otra salida. |
| Muchas salidas manuales registran la entrega física de material para una OA. Si se descontaran, ese consumo se restaría dos veces. | El motivo «Entrega para una OA» y «Solo registro» no descuentan. |
| — | Si se intenta marcar como «descuenta stock» una salida que menciona una OA, se **rechaza** con una explicación. La regla vive en `manualSalidaStockError`. |
| — | Las salidas manuales históricas siguen sin descontar. Ningún stock cambia de golpe. |

**Regla única de stock**, en `lib/inventory/me-stock-calc.ts`. Por código:

> ingresos no anulados − salidas OA no revertidas − salidas manuales que descuentan + ajustes de cualquier material con ese código

Antes, el ajuste de un material duplicado con el mismo código se perdía; ahora se cuenta.

## 2. Qué se edita y cómo se guarda

| Planilla | Columnas editables | No editables |
|---|---|---|
| **Ingresos ME** (Depósito) | Fecha, Nº, proveedor, cliente, remito, código, descripción, bultos, cantidad, ubicación | TOTAL (= bultos × cantidad); ingresos anulados |
| **Salidas ME** (Depósito) | Fecha, Nº, cliente, remito, descripción, código, bultos, cantidad, unidad, control, entregado, comentarios, **motivo**, **descuenta stock** | TOTAL; salidas automáticas de OA (se corrigen desde la OA) |
| **Inventario ME** (Depósito / Producción) | Cliente, insumo, ubicación, unidad, cantidad por bulto, **stock mínimo**, **punto de reposición** | Código; **CANTIDAD TOTAL** (calculada) |

**Escritura**: `PATCH /api/v1/inventory/cells`, implementada en `lib/inventory/me-planilla-db.ts`, todo en una transacción de Postgres.
- `SELECT … FOR UPDATE` de las filas, más verificación de la versión que vio el usuario. Si cambió, devuelve **409** y no pisa nada.
- Candado transaccional **por código** (`pg_advisory_xact_lock`): una edición de cantidades y un ajuste del mismo código nunca se cruzan.
- Todo o nada: si una celda es inválida, no se guarda ninguna.
- Auditoría en `inv_audit` (antes, después, usuario, sector, motivo) dentro de la misma transacción.
- Cambiar el código de un ingreso o una salida mueve su stock al código nuevo y crea el material si no existía.
- Duplicados: el mismo remito, código, cantidad y fecha que un ingreso vigente se rechaza, al pegar o al editar, para no sumar stock dos veces. Un mismo Nº de ingreso con varias líneas sigue permitido, porque es un remito con varios códigos.
- La numeración ME-I / ME-E usa el máximo existente + 1, no `length + 1`, que repetía números.
- El saldo derivado ya no cambia la versión del material: no hay falsos conflictos al editar umbrales.

## 3. Ajustes de inventario y stock negativo

- **«Stock» / «Corregir»** abre el **libro de movimientos** de cada código (ingresos, consumos OA, salidas manuales que descuentan, ajustes) con saldo acumulado.
- **Ajuste** (`POST /api/v1/inventory/me-ajustes`):
  - pide el stock real, el tipo (conteo físico, corrección de error de registro, rotura, otro) y un **motivo** obligatorio;
  - se envía el stock que el usuario vio: si cambió mientras tanto, **409**;
  - el ajuste queda como movimiento (diferencia) y en la auditoría;
  - el stock **sigue siendo calculado**: nunca se escribe el saldo a mano.
- **Stock negativo**:
  - se muestra tal cual: valor negativo, fila con borde rojo y botón «Corregir»;
  - nunca se oculta ni se lleva a 0 automáticamente;
  - el diálogo explica las dos correcciones: corregir el movimiento de origen (el saldo se recalcula solo) o registrar un ajuste con el conteo real.
- **Historial** por ingreso, salida y material: `GET /api/v1/inventory/me-historial`.

## 4. Permisos (sin cambios)

| Sector | Puede |
|---|---|
| Depósito | Editar ingresos y salidas; editar inventario y ajustar |
| Producción | Editar inventario (datos y umbrales) y ajustar. No edita ingresos ni salidas (403) |
| Dirección | Igual que antes |
| Envasado y otros | Lectura según la regla existente; no ajustan (403) |

Los trabajos operativos no se modificaron.

## 5. Pruebas

| Prueba | Resultado |
|---|---|
| Unitarias (`me-planilla.test.ts`) | 7 OK: regla de stock, anti doble descuento, duplicados, protección y tipos |
| Postgres descartable (`npm run test:e2e:produccion-edicion-db`) | **25/25**, de las cuales 9 son nuevas de Depósito |
| Navegador (`npm run test:e2e:deposito-me`) | **25/25** |
| Regresión | Producción 27/27, Mi trabajo 50/50, sectores y TV 37/37, vitest 2114, build OK |

**Postgres (9 casos nuevos de Depósito):**
- persistencia tras recargar;
- recálculo de stock y de TOTAL;
- salida manual que descuenta frente a una que menciona una OA;
- dos ediciones simultáneas;
- duplicados;
- negativo visible y corregido desde el movimiento de origen;
- ajuste con stock esperado y dos ajustes simultáneos;
- permisos;
- cambio de código.

**Navegador:**
- editar cantidad, recargar y leer el valor exacto;
- TOTAL calculado;
- historial;
- pegado duplicado rechazado;
- OA protegida;
- motivo que descuenta;
- rechazo del doble descuento;
- inventario recalculado y umbral editado;
- negativo → «Corregir» → ajuste;
- 409 por stock viejo y por edición simultánea;
- permisos de Producción y Envasado;
- auditoría en la base.

Capturas: `docss/img/deposito-me-planillas/`.

## 6. Limitaciones

- Las altas siguen pasando por el formulario o por «Pegar desde Excel», con el servicio existente más la protección de duplicados. Lo transaccional aplica a la edición de filas existentes, los ajustes y el historial.
- Las salidas manuales históricas que en realidad fueron devoluciones o descartes no descuentan hasta que alguien les ponga el motivo. Es intencional: no se cambia stock sin decisión humana.
