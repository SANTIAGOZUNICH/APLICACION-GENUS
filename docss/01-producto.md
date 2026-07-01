# 01 — Producto

Define el producto desde la perspectiva de negocio y de usuario.

---

## 1. Objetivos del producto

1. **Trazabilidad total por lote**, de materia prima a producto despachado, exigible en una inspección ANMAT.
2. **Cero error operativo evitable** mediante flujos guiados y validaciones (error-proofing).
3. **Segregación de funciones GMP** garantizada por el sistema, no por la disciplina de las personas.
4. **Eliminar planillas paralelas**: una sola fuente de verdad.
5. **Reducir la carga cognitiva**: que el sistema diga qué hacer (ERP guiado por tareas).
6. **Visibilidad operativa y de gestión** en tiempo cuasi-real para supervisión y dirección.

## 2. Usuarios

El laboratorio tiene ~40 personas. Los usuarios del sistema, por área:

- **Elaboración** (operarios de planta): producen el granel. Ej.: Cristian, Nicolás, Santino.
- **Acondicionamiento** (operarios): envasan y etiquetan el PT.
- **Depósito**: recepción, stock y despacho. Ej.: Belén.
- **Calidad**: ensayos y evidencia de liberación. Ej.: Santiago.
- **Dirección Técnica**: responsable legal ANMAT; firma las liberaciones. Ej.: Farm. Caio David Zunich.
- **Administración / Comercial**: pedidos, clientes, maestros.
- **Dirección**: gestión y excepciones.

Clientes (marcas para las que se fabrica): ~22, entre ellas Jactans, TMCO (The Minimal Co), TYL.

## 3. Roles (RBAC)

Seis roles activos + un rol de servicio futuro. Detalle completo en `04-rbac.md`.

| ID | Rol | Resumen |
|---|---|---|
| `ROL-OP` | Operario | Ejecuta tareas físicas (recepción, consumo, despacho). Diferenciado por área. |
| `ROL-SU` | Supervisor | Planifica, confirma, crea y cierra OE/OA, ajustes. |
| `ROL-CA` | Calidad | Carga análisis y evidencia; prepara disposición. |
| `ROL-DT` | Dirección Técnica | Firma la liberación de lote (acto legal). |
| `ROL-AD` | Administración | Mantiene maestros y gestiona pedidos. |
| `ROL-DI` | Dirección | Lectura integral y tableros. |
| `ROL-SV` | Servicio (Creamy) | Rol de servicio futuro; inactivo, sin permisos. |

## 4. Casos de uso principales

1. **Ingresar y planificar un pedido** (Comercial → Supervisor).
2. **Elaborar un granel** contra una OE, consumiendo MP por lote (Operario elaboración).
3. **Liberar el granel** (Calidad analiza, Dirección Técnica firma).
4. **Acondicionar un PT** contra una OA, consumiendo ME por lote a partir del granel (Operario acondicionamiento).
5. **Liberar el PT** (Calidad + Dirección Técnica).
6. **Despachar PT liberado** contra el pedido (Depósito).
7. **Reportar un problema** en planta (Operario → Supervisor) *(módulo INCIDENCIAS, pendiente)*.
8. **Recepcionar MP/ME** y dejarlas en cuarentena (Depósito → Calidad).
9. **Monitorear y decidir** sobre desvíos, faltantes y excepciones (Supervisor, Dirección).

## 5. Problemas actuales (estado previo / motivación)

- Información en planillas dispersas; sin trazabilidad de punta a punta automática.
- Hueco crítico histórico: **el lote del material de empaque no se registraba** en el acondicionamiento (resuelto por diseño en el modelo de OA, ver `03` y `05`).
- Posibilidad de error en consumos (lote equivocado, en cuarentena, cantidad mayor al saldo).
- Sin segregación de funciones forzada por sistema.
- El estado de una orden/lote no era evidente; había que interpretarlo.

## 6. Beneficios

- **Cumplimiento y auditoría:** trazabilidad y registros ALCOA listos para inspección.
- **Calidad operativa:** menos errores, menos retrabajo, menos mermas.
- **Velocidad:** menos tiempo decidiendo qué hacer y dónde registrar.
- **Gobernanza:** acceso y acciones controladas por rol.
- **Escalabilidad:** sumar módulos (Compras, MRP, Comunicación) sin reescribir.

## 7. KPIs esperados

Algunos requieren datos adicionales (ver dependencias en `14-roadmap.md` y `19-pendientes.md`).

| KPI | Qué mide | Dependencia |
|---|---|---|
| OE/OA en curso | Carga de trabajo productiva | Disponible (conteo) |
| Lotes en cuarentena | Cola de calidad | Disponible (conteo) |
| Lotes esperando firma | Cola de Dirección Técnica | Disponible (conteo) |
| % de avance por orden | Real vs. plan | Requiere VCR (cálculo) |
| Días en cuarentena | Antigüedad de lotes | Requiere VCR |
| % aprobado / rechazado | Desempeño de calidad | Requiere VCR |
| Cumplimiento de pedidos (pendiente/parcial/completo) | Nivel de servicio básico | Derivable de movimientos |
| Nivel de servicio (a tiempo) | Cumplimiento de compromiso | Requiere fecha de compromiso + entrega (tabla/campo nuevo) |
| Lead time por etapa | Tiempos de proceso | Requiere timestamps por estado (tabla nueva) |
| Valor de inventario | Stock valorizado | Requiere maestro de precios/costos (tabla nueva) |
| Stock crítico / por vencer | Prevención de quiebres/vencimientos | Requiere umbral por ítem |
