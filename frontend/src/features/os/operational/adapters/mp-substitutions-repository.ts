/**
 * @mock-temp Sustituciones de Materias Primas aprobadas — demo localStorage entity.
 * Solo lectura para Creamy; nunca inventa sustituciones.
 */

export type SubstitutionStatus = "vigente" | "vencida" | "suspendida";

export interface ApprovedSubstitution {
  id: string;
  /** Código MP original */
  originalCodigo: string;
  /** Nombre MP original */
  originalNombre: string;
  /** Código MP sustituta */
  substituteCodigo: string;
  /** Nombre MP sustituta */
  substituteNombre: string;
  /** Producto(s) al que aplica; vacío = todos */
  products: string[];
  /** Motivo/justificación */
  motivo: string;
  /** Sector que aprobó */
  approvedBy: string;
  /** Fecha aprobación ISO */
  approvedAt: string;
  /** Fecha expiración ISO o null si indefinida */
  expiresAt: string | null;
  status: SubstitutionStatus;
  notes: string | null;
}

const DEMO_SUBSTITUTIONS: ApprovedSubstitution[] = [
  {
    id: "sub-001",
    originalCodigo: "MP-035",
    originalNombre: "Glicerina",
    substituteCodigo: "MP-036",
    substituteNombre: "Glicerina vegetal USP",
    products: ["Serum Niacinamida", "Crema Vitamina C"],
    motivo: "Stock insuficiente de MP-035. Aprobada por Calidad por equivalencia funcional.",
    approvedBy: "CALIDAD",
    approvedAt: "2026-06-01",
    expiresAt: "2026-12-31",
    status: "vigente",
    notes: "Misma proporción de uso. Verificar proveedor en OE.",
  },
  {
    id: "sub-002",
    originalCodigo: "MP-118",
    originalNombre: "Ácido cítrico",
    substituteCodigo: "MP-119",
    substituteNombre: "Ácido cítrico anhidro alimentario",
    products: [],
    motivo: "Quiebre de stock proveedor habitual. Aprobada por DT para todos los productos.",
    approvedBy: "PRODUCCION",
    approvedAt: "2026-07-01",
    expiresAt: null,
    status: "vigente",
    notes: null,
  },
];

const STORAGE_KEY = "genus_os_approved_substitutions";

function loadSubstitutions(): ApprovedSubstitution[] {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return DEMO_SUBSTITUTIONS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEMO_SUBSTITUTIONS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEMO_SUBSTITUTIONS;
    return parsed as ApprovedSubstitution[];
  } catch {
    return DEMO_SUBSTITUTIONS;
  }
}

export function listActiveSubstitutions(): ApprovedSubstitution[] {
  return loadSubstitutions().filter((s) => s.status === "vigente");
}

export interface SubstitutionSearchInput {
  product?: string;
  originalCodigo?: string;
  query?: string;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function includesQuery(fields: unknown[], query: string): boolean {
  if (!query) return true;
  return fields.some((field) => normalize(field).includes(query));
}

export function searchSubstitutions(input: SubstitutionSearchInput): ApprovedSubstitution[] {
  const active = listActiveSubstitutions();
  const q = normalize(input.query);
  const product = normalize(input.product);
  const codigo = normalize(input.originalCodigo);

  return active.filter((s) => {
    if (product && s.products.length > 0 && !s.products.some((p) => normalize(p).includes(product))) {
      return false;
    }
    if (codigo && !normalize(s.originalCodigo).includes(codigo)) {
      return false;
    }
    if (
      q &&
      !includesQuery(
        [
          s.id,
          s.originalCodigo,
          s.originalNombre,
          s.substituteCodigo,
          s.substituteNombre,
          s.motivo,
          s.notes,
          ...s.products,
        ],
        q
      )
    ) {
      return false;
    }
    return true;
  });
}

export function getSubstitutionById(id: string): ApprovedSubstitution | null {
  return loadSubstitutions().find((s) => s.id === id) ?? null;
}
