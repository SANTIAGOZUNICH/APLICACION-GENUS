/**
 * Por qué una columna NO se edita en la planilla (se muestra en la celda con candado y al intentar editarla).
 * Clave: encabezado de la columna (label) tal como lo arma cada vista.
 */
const TOTAL = "TOTAL = bultos × cantidad: se calcula solo.";

const REASONS: Record<string, Record<string, string>> = {
  me_ingresos: { TOTAL },
  me_salidas: { TOTAL },
  me_inventario: {
    CÓDIGO: "Código del material: identifica el inventario (se corrige en el ingreso).",
    BULTOS: "Stock calculado (ingresos − salidas ± ajustes): se corrige con «Ajustar stock» (motivo, auditado).",
    "CANTIDAD TOTAL": "Stock calculado (ingresos − salidas ± ajustes): se corrige con «Ajustar stock» (motivo, auditado).",
  },
  mp_ingresos: {
    "INGRESO Nº": "Número asignado por el sistema (único): no se edita.",
    TOTAL,
  },
  mp_control: {
    codigo: "Viene de la fórmula (snapshot del control): no se edita.",
    materiaPrima: "Viene de la fórmula (snapshot del control): no se edita.",
    formulaPct: "Viene de la fórmula (snapshot del control): no se edita.",
    stockActual: "Stock real del libro mayor: no se edita.",
    stockProyectado: "Se calcula: stock − kg necesarios.",
    diferencia: "Se calcula: stock − kg necesarios.",
    estado: "Se calcula a partir de la diferencia.",
  },
};

export function readOnlyReason(table: keyof typeof REASONS | string, label: string): string | undefined {
  return REASONS[table]?.[label];
}
