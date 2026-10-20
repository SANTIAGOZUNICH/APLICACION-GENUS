/**
 * Por qué una columna NO se edita en la planilla (se muestra en la celda con candado y al intentar editarla).
 * Clave: encabezado de la columna (label) tal como lo arma cada vista.
 */

const REASONS: Record<string, Record<string, string>> = {
  me_ingresos: {},
  me_salidas: {},
  me_inventario: {},
  mp_ingresos: {},
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
