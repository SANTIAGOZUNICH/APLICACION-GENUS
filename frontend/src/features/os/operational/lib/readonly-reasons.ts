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
  mp_stock: {
    CÓDIGO: "Código del material: se corrige en el ingreso.",
    PRODUCTO: "Se arma con los ingresos confirmados del mismo código.",
    "STOCK CÓDIGO (LIBRO MAYOR)": "Saldo del libro mayor (ingresos − consumos de OE ± ajustes): no se edita.",
    "ESTADO STOCK": "Se calcula a partir de los kg del lote.",
    "DÍAS AL VENCE": "Se calcula a partir del vencimiento.",
    "ESTADO VENCIMIENTO": "Se calcula a partir del vencimiento.",
    ORIGEN: "Origen del lote (ingreso / manual): no se edita.",
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
