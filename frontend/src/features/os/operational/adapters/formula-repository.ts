/**
 * @mock-temp Fórmulas (BOM) por producto — demo, sin conexión a BOM real todavía.
 * docss/03-modelo-de-datos.md define BOM como tabla [DISEÑADA]; hasta que exista,
 * esta capa aislada resuelve materias primas requeridas por producto para Control de MP.
 */

export interface FormulaLine {
  codigo: string;
  nombre: string;
  cantidadRequerida: number;
  unidad: string;
}

export interface ProductFormula {
  product: string;
  lines: FormulaLine[];
  /** true si la fórmula fue estimada automáticamente (producto sin BOM cargado). */
  estimated: boolean;
}

const KNOWN_FORMULAS: Record<string, FormulaLine[]> = {
  "Serum Niacinamida": [
    { codigo: "MP-010", nombre: "Agua desmineralizada", cantidadRequerida: 60, unidad: "kg" },
    { codigo: "MP-035", nombre: "Glicerina", cantidadRequerida: 8, unidad: "kg" },
    { codigo: "MP-118", nombre: "Ácido cítrico", cantidadRequerida: 1.5, unidad: "kg" },
  ],
  "Crema Vitamina C": [
    { codigo: "MP-010", nombre: "Agua desmineralizada", cantidadRequerida: 40, unidad: "kg" },
    { codigo: "MP-035", nombre: "Glicerina", cantidadRequerida: 10, unidad: "kg" },
  ],
  "Shampoo Reparador": [
    { codigo: "MP-010", nombre: "Agua desmineralizada", cantidadRequerida: 120, unidad: "kg" },
    { codigo: "MP-204", nombre: "Fragancia Vitamin Shock", cantidadRequerida: 3, unidad: "kg" },
  ],
};

const FALLBACK_POOL: FormulaLine[] = [
  { codigo: "MP-010", nombre: "Agua desmineralizada", cantidadRequerida: 50, unidad: "kg" },
  { codigo: "MP-035", nombre: "Glicerina", cantidadRequerida: 6, unidad: "kg" },
  { codigo: "MP-118", nombre: "Ácido cítrico", cantidadRequerida: 1, unidad: "kg" },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 1000;
  }
  return hash;
}

export function getFormulaForProduct(product: string | null | undefined): ProductFormula | null {
  if (!product) return null;
  const known = KNOWN_FORMULAS[product];
  if (known) {
    return { product, lines: known, estimated: false };
  }

  // Sin BOM cargado: fórmula estimada determinística (demo) — nunca inventa cantidades random.
  const seed = hashString(product);
  const count = 2 + (seed % 2);
  const lines = FALLBACK_POOL.slice(0, count).map((line) => ({
    ...line,
    cantidadRequerida: line.cantidadRequerida * (1 + (seed % 5) / 10),
  }));
  return { product, lines, estimated: true };
}
