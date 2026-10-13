# 56 — Diagnóstico: fórmulas de Google Drive que no aparecen en GENUS OS

Rama `claude/drive-diagnostico-formulas`, que parte de `main` en 2422928 (incluye #120). **Diagnóstico de solo lectura**:
- no se cambió el índice de Drive ni la carpeta configurada;
- no se tocó ningún archivo de Drive ni el banco de fórmulas;
- no hay migraciones.

## 1. Configuración real: qué se pudo ver desde acá y qué no

La configuración vive en las **variables de entorno de Vercel** (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_DRIVE_FORMULAS_FOLDER_ID`). El entorno donde se hizo este trabajo **no tiene esas variables ni acceso a Vercel**, así que **no se puede afirmar** desde acá:
- el email de la cuenta de servicio;
- el ID y el nombre de la carpeta;
- la unidad;
- los clientes;
- la cantidad de fórmulas;
- la última actualización del índice.

Tampoco sirve el conector de Drive de esta sesión, que está vinculado a otra cuenta (no la del laboratorio) y no ve la carpeta.

Por eso el diagnóstico quedó **dentro de GENUS OS**: el panel «Conexión con Google Drive» (punto 4) muestra esos datos reales al abrirlo en Production o en la vista previa de Vercel del PR.

Lo que sí sale del código:
- **Carpeta**: `GOOGLE_DRIVE_FORMULAS_FOLDER_ID`. Si falta, usa `GOOGLE_DRIVE_PRODUCTOS_FOLDER_ID` como reserva. `GOOGLE_DRIVE_ELABORACION_FOLDER_ID` se ignora a propósito.
- **Permisos**: scope `drive.readonly`. Se usan `supportsAllDrives` y `includeItemsFromAllDrives`, así que **las unidades compartidas funcionan si la cuenta tiene acceso**.
- **Índice**: vive **en la memoria del servidor**, con un TTL de 10 minutos.
  - No se guarda en la base: no existe una «última sincronización» persistente.
  - En Vercel, cada instancia del servidor arma el suyo, y una instancia nueva lo rehace al primer uso.

## 2. Causas encontradas en el código (comprobadas)

El índice (`lib/formulas/drive-formulas-index.ts` + `lib/adapters/drive/google-drive-gateway.ts`) solo lee una estructura muy concreta. Todo lo que se aparta de ella **no aparece**, sin aviso:

| # | Causa | Qué pasa hoy |
|---|---|---|
| 1 | **Subcarpetas anidadas** | Lee la raíz → carpetas de primer nivel (= clientes) → **solo las hojas que están directamente** en la carpeta del cliente. `CLIENTE/2024/fórmula.xlsx` o `CLIENTE/Productos/…` **no se leen**. |
| 2 | **Hojas sueltas en la raíz** | Si la raíz tiene subcarpetas, las planillas sueltas en la raíz **se ignoran**. Solo se leen si la raíz no tiene ninguna subcarpeta. |
| 3 | **Formatos no reconocidos** | Solo Google Sheets, `.xlsx` y `.xls`. **`.xlsm` (con macros), `.xlsb`, `.ods` y `.csv` no aparecen**. La librería del lector (SheetJS) puede abrir `.xlsm`, pero no está probado con fórmulas reales. |
| 4 | **Accesos directos** | Un acceso directo a una carpeta de cliente o a una planilla **no se sigue**. |
| 5 | **Mismo producto repetido** | Si un cliente tiene dos archivos con el mismo producto (por el nombre del archivo), **solo se usa el modificado más recientemente**. |
| 6 | **Nombres** | El cliente es el **nombre de la carpeta** y el producto sale del **nombre del archivo**. Para la OE automática tienen que coincidir **exacto** (sin tildes, mayúsculas ni signos) con el cliente y el producto del trabajo. «ACME» y «ACME S.A.», o «Crema» y «Crema 500 ml», son distintos. |
| 7 | **Fuera de la carpeta / otras unidades** | Solo se recorre la carpeta configurada. Una fórmula en otra carpeta u otra unidad compartida **no aparece**, aunque la cuenta pueda verla. |
| 8 | **Permisos** | Lo no compartido con la cuenta de servicio no se ve. Drive responde «no encontrado» tanto si el ID es incorrecto como si la carpeta no está compartida: **no se pueden distinguir esos dos casos**. |
| 9 | **Un error corta todo** | Si falla el listado de **una** carpeta de cliente, falla el índice entero y Drive queda «no disponible» para todas las OE. |
| 10 | **Caché** | Un archivo nuevo puede tardar hasta 10 minutos en aparecer, por instancia del servidor. Ahora se puede forzar con «Actualizar índice». |
| 11 | **Errores de lectura** | El archivo se abre recién al usarlo en una OE. Si no se puede interpretar como fórmula, o el parser lo marca «requiere revisión», la OE queda pendiente. |
| 12 | **Conflictos de versiones** | Están en el **banco** (Neon): si un producto tiene versiones en conflicto, la OE no elige ninguna. |

**Lo que no se puede determinar desde acá** (requiere el panel en Production):
- cuáles de estas causas afectan a los archivos reales;
- cuántos archivos hay en cada caso;
- qué fórmulas faltan en el banco.

## 3. Comparación Drive ↔ banco de fórmulas

El panel compara cada archivo que lee el índice con el banco, usando la misma búsqueda exacta (o por alias) que la OE:

| Situación | Significado |
|---|---|
| En el banco y en Drive | Disponible. |
| Solo en Drive | No está en el banco; la OE la lee de Drive si el nombre coincide exacto. |
| Solo en el banco | No aparece en la carpeta de Drive; la OE la toma igual del banco. |
| Conflicto en el banco | Versiones en conflicto: la OE no elige ninguna. |
| Ambigua en el banco | Más de una fórmula coincide. |
| En revisión en el banco | No se usa en OE hasta revisarla. |

## 4. Panel «Conexión con Google Drive»

Está en el **módulo de fórmulas** («Administración de fórmulas»: Stock de Materias Primas, Calidad y el panel de Producción). Lo ven **solo Calidad, Producción, Materia Prima y Dirección**: los mismos sectores que ya administran el banco. Elaboración y el resto reciben 403.

Muestra:
- **Cuenta conectada**: solo el email, nunca la clave.
- **Carpeta raíz**: nombre, enlace «Abrir en Drive», variable e ID.
- **Unidad**: unidad compartida (con su nombre) o «Mi unidad» de quien la compartió.
- **Estado**:
  - Conectado;
  - Sin credenciales;
  - Sin carpeta configurada;
  - Sin permiso;
  - Carpeta no encontrada (dice que puede ser un ID incorrecto **o** falta de permiso, porque Drive no los distingue);
  - Error de conexión.
- **Fórmulas encontradas**: archivos y clientes que tiene el índice. **Última actualización del índice**, con la aclaración de que vive en la memoria del servidor.
- **«Verificar conexión»**: recorre la carpeta y arma el diagnóstico. **«Actualizar índice»**: además rehace el índice en memoria. Ninguno escribe nada.
- **Diagnóstico**:
  - clientes visibles y archivos leídos por cada uno;
  - archivos que **no aparecen**, con el motivo exacto de la tabla del punto 2 y un enlace para abrirlos;
  - archivos que no son planillas (solo cantidad);
  - unidades compartidas visibles;
  - planillas que la cuenta ve **fuera** de la carpeta configurada;
  - comparación con el banco;
  - los límites de lo que se puede ver.

## 5. OE sin fórmula: causa precisa

Cuando la OE automática no encuentra la fórmula, ahora guarda y muestra **la causa comprobada**:

| Causa | Cuándo |
|---|---|
| Conflicto de versiones en el banco | El banco tiene versiones en conflicto. |
| Más de una fórmula coincide en el banco | Ambigua en el banco. |
| Fórmula incompleta en el banco / en Drive | Falta algún % o el total no da 100 % ± 2. |
| No está en el banco y Google Drive no está configurado | Faltan credenciales o carpeta. |
| No está en el banco y no se pudo acceder a Google Drive | La cuenta no puede abrir la carpeta: **no se sabe** si la fórmula está en Drive. |
| No está en el banco y falló la lectura de Google Drive | Error de conexión: **no se sabe** si está en Drive. |
| No está en el banco ni hay carpeta del cliente en Drive | Drive se leyó bien y no hay carpeta con ese nombre de cliente. |
| No está en el banco ni en la carpeta del cliente en Drive | Hay carpeta del cliente, pero ningún archivo con ese producto exacto. |
| Más de un archivo coincide en Drive | Ambigua en Drive. |
| El archivo de Drive no se pudo leer como fórmula | El archivo existe pero no se pudo interpretar. |

Si Drive no se pudo consultar, **no se dice que la fórmula no existe**: se dice que no se pudo consultar.

## 6. Propuestas (NO implementadas; necesitan tu autorización)

1. Buscar fórmulas también en **subcarpetas** de cada cliente (por ejemplo hasta 3 niveles).
2. Aceptar **`.xlsm`**: la librería del lector lo puede abrir; habría que probarlo con fórmulas reales.
3. **Seguir accesos directos** a carpetas de cliente y a planillas.
4. Que un error en **una** carpeta no tire abajo el índice entero: se omite esa carpeta y se avisa en el panel.
5. Guardar la fecha y el resultado de la última sincronización en la base, para que «última actualización» sea la misma en todas las instancias.
6. Si se confirma con el panel que hay fórmulas en otra carpeta o unidad: **mover o compartir** esos archivos (lo hacen ustedes en Drive), o autorizar otra carpeta raíz. No se cambia la carpeta sin tu autorización.

## 7. Validación

Postgres **descartable**; **nunca se usó Google Drive real**.

| Prueba | Resultado |
|---|---|
| Unitarias nuevas: reglas del diagnóstico (`drive-scan-rules.test.ts`) y causas de la OE (`resolve-for-work.test.ts`) | 5 + 8 |
| Ruta con un Drive simulado en memoria (`drive-connection/route.test.ts`): permisos, sin clave privada, omitidos, fuera de la carpeta, banco, 403/404, solo lecturas | 5/5 |
| E2E `GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:drive-conexion` (Chromium, build de producción) | 13/13 |
| Vitest completo | 2211 OK |

Qué verifica el E2E:
- **El entorno de prueba no tiene credenciales de Google**: el panel lo dice tal cual.
- **Se ve el panel con una carpeta armada**: la respuesta de la API se reemplaza por **datos simulados**, marcados «(ejemplo)».
- **Permisos**: Elaboración recibe 403.
- **OE sin fórmula**: muestra la causa real del entorno («no está en el banco y Google Drive no está configurado»).
- **El banco no se modificó.**

Capturas en `docss/img/drive-conexion/`. La 02 es con **datos simulados**.
