/**
 * OE automática desde el trabajo asignado — reglas PURAS (sin base de datos, testeables).
 *
 * Qué arma:
 *  - Encabezado desde el trabajo: producto, cliente, cantidad (kg) y LOTE DE FABRICACIÓN copiado exacto.
 *  - Materias primas y % desde la fórmula (banco Neon o Drive, ver lib/formulas/resolve-for-work.ts);
 *    los kg a pesar los calcula recomputeOeDerived (cantidad × % / 100, 4 decimales).
 *  - Lotes de MP: NO se asignan. Quedan vacíos para que Elaboración los complete en la tabla de la OE al elaborar.
 *  - `autoPrep`: de dónde salió cada dato y qué quedó pendiente.
 *
 * Qué NO hace nunca:
 *  - inventar materias primas ni porcentajes (fórmula ausente/ambigua/incompleta → queda pendiente);
 *  - reemplazar materias primas cargadas a mano sin una confirmación explícita (`replaceManual`);
 *  - pisar ni borrar un lote de MP (o un ajuste) registrado por el elaborador: si la MP sigue en la fórmula
 *    (mismo código) se conserva; si la fórmula nueva ya no la tiene, se informa en `lostRecords` y el servidor
 *    no aplica sin una confirmación explícita;
 *  - tocar una OE cuya elaboración ya empezó (ver oeProcesoIniciado: eso decide el servidor).
 */
import { emptyOeMaterial, recomputeOeDerived } from "@/lib/orders/content";
import type {
  OeAutoPrep,
  OeContent,
  OeMaterialRow,
  OrderStatus,
} from "@/lib/orders/types";
import { normalizeSearchKey } from "@/lib/formulas/types";
import type { WorkFormulaResolution } from "@/lib/formulas/work-formula-rules";
import { parseArDecimal } from "@/lib/utils/ar-number-parsing";

export type AutoPrepWork = {
  id: string;
  version: number | null;
  product: string;
  client: string;
  plannedQuantity: string;
  unit: string | null;
  packagingLote: string | null;
};

export type BuildAutoPrepInput = {
  content: OeContent;
  work: AutoPrepWork;
  formula: WorkFormulaResolution;
  actorEmail: string;
  reason: string;
  now: string;
  /** Confirmación explícita: reemplazar materias primas cargadas a mano por las de la fórmula. */
  replaceManual?: boolean;
};

/** Qué hacer con las columnas formula_* de la OE: set = guardar esta referencia; clear = vaciar; keep = no tocar. */
export type FormulaColumnsChange =
  | { kind: "set"; formulaProductId: string; formulaVersionId: string; versionHash: string }
  | { kind: "clear" }
  | { kind: "keep" };

export type BuildAutoPrepResult = {
  content: OeContent;
  formulaColumns: FormulaColumnsChange;
  /** false = el resultado es igual a lo que ya tiene la OE (no hace falta guardar ni auditar). */
  changed: boolean;
  /**
   * MP con datos del elaborador (lote o ajuste) que el resultado ya no incluye (la fórmula nueva no tiene esa MP).
   * El servidor no aplica automáticamente y la acción explícita exige confirmar la pérdida.
   */
  lostRecords: Array<{ materiaPrima: string; codigo: string; lote: string; ajuste: number | null }>;
};

const KG_UNITS = new Set(["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos"]);

export function workIdentity(client: string, product: string): string {
  return `${normalizeSearchKey(client)}||${normalizeSearchKey(product)}`;
}

/** Huella de lo que carga la fórmula (MP, código, %, procedimiento). No incluye kg ni lotes: esos cambian solos. */
export function formulaContentFingerprint(content: OeContent): string {
  return JSON.stringify({
    m: content.materials.map((m) => [m.materiaPrima.trim(), m.codigo.trim(), m.formulaPct]),
    p: content.procedureSteps.map((s) => s.text.trim()),
  });
}

function hasFormulaContent(content: OeContent): boolean {
  return (
    content.materials.some(
      (m) => m.materiaPrima.trim() !== "" || m.codigo.trim() !== "" || m.formulaPct != null
    ) || content.procedureSteps.some((s) => s.text.trim() !== "")
  );
}

/**
 * ¿Empezó la elaboración? Desde ese momento la preparación automática no reemplaza nada
 * (fórmula, lotes ni cantidades): solo una acción explícita con revisión.
 */
export function oeProcesoIniciado(
  status: OrderStatus | string,
  content: OeContent | null | undefined
): { started: boolean; reason: string | null } {
  if (status !== "BORRADOR" && status !== "PENDIENTE") {
    return { started: true, reason: "La OE ya está en proceso o entregada." };
  }
  if (!content || content.kind !== "OE") return { started: false, reason: null };
  if (content.materials.some((m) => m.ajuste != null || (m.ajusteMotivo ?? "").trim() !== "")) {
    return { started: true, reason: "Ya hay ajustes de pesada registrados." };
  }
  const pc = content.processControl;
  if (
    [pc.aspecto, pc.color, pc.olor, pc.ph, pc.viscosidad, pc.fechaFin].some((v) => String(v ?? "").trim() !== "") ||
    pc.cantidadReal != null ||
    pc.cantidadObtenida != null
  ) {
    return { started: true, reason: "Ya hay datos de control de proceso registrados." };
  }
  const qc = content.qualityControl;
  if (String(qc.resultado ?? "").trim() !== "" || String(qc.fecha ?? "").trim() !== "") {
    return { started: true, reason: "Ya hay datos de control de calidad registrados." };
  }
  if ((content.deliveryObservation ?? "").trim() !== "") {
    return { started: true, reason: "Ya hay una observación de entrega." };
  }
  return { started: false, reason: null };
}

/** Cantidad del trabajo en kg. Solo si la unidad es kg: nunca convierte unidades. */
export function workQuantityKg(plannedQuantity: string, unit: string | null): { kg: number | null; message: string | null } {
  const raw = (plannedQuantity ?? "").trim();
  const u = (unit ?? "kg").trim().toLowerCase().replace(/\.$/, "");
  if (!KG_UNITS.has(u)) {
    return { kg: null, message: `La cantidad del trabajo está en «${unit}», no en kg: completala en kg.` };
  }
  if (!raw) return { kg: null, message: "El trabajo no tiene cantidad." };
  const parsed = parseArDecimal(raw);
  if (!parsed.ok || parsed.value == null || !(parsed.value > 0)) {
    return { kg: null, message: `La cantidad del trabajo («${raw}») no es un número válido.` };
  }
  return { kg: parsed.value, message: null };
}

function mpKey(codigo: string, materiaPrima: string): string {
  const c = normalizeSearchKey(codigo ?? "");
  return c ? `c:${c}` : `m:${normalizeSearchKey(materiaPrima ?? "")}`;
}

/** Fila con algo que escribió el elaborador (lote o ajuste): no se borra sin confirmación. */
function hasElaboratorData(m: OeMaterialRow): boolean {
  return (m.lote ?? "").trim() !== "" || m.ajuste != null || (m.ajusteMotivo ?? "").trim() !== "";
}
const lostOf = (m: OeMaterialRow) => ({ materiaPrima: m.materiaPrima, codigo: m.codigo, lote: m.lote, ajuste: m.ajuste });

function occurrenceKeys(rows: Array<{ codigo: string; materiaPrima: string }>): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = mpKey(r.codigo, r.materiaPrima);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${k}#${n}`;
  });
}

/** JSON con claves ordenadas: Postgres (jsonb) devuelve las claves en otro orden que el objeto original. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );
}

/** Vista estable para comparar (sin fecha/actor/motivo de la preparación). */
function stableView(content: OeContent): string {
  const { autoPrep, ...rest } = content;
  const ap = autoPrep
    ? { ...autoPrep, preparedAt: "", preparedBy: "", reason: "", workItemVersion: null }
    : null;
  return canonicalJson({ rest, ap });
}

export function buildAutoPreparedOe(input: BuildAutoPrepInput): BuildAutoPrepResult {
  const { content, work, formula } = input;
  const prev = content.autoPrep;
  const identity = workIdentity(work.client, work.product);
  const pendientes: string[] = [];

  // 1) Encabezado desde el trabajo.
  const qty = workQuantityKg(work.plannedQuantity, work.unit);
  if (qty.message) pendientes.push(qty.message);
  const lot = work.packagingLote ?? "";
  if (!lot.trim()) pendientes.push("Lote de fabricación: Producción todavía no lo cargó en el trabajo.");

  let next: OeContent = {
    ...content,
    header: {
      ...content.header,
      productName: work.product,
      client: work.client,
      quantityKg: qty.kg,
      lot,
    },
  };

  // 2) Fórmula.
  let formulaColumns: FormulaColumnsChange = { kind: "keep" };
  let lostRecords: BuildAutoPrepResult["lostRecords"] = [];
  let formulaMeta: OeAutoPrep["formula"];
  const currentFp = formulaContentFingerprint(content);
  const materialsCameFromAuto =
    Boolean(prev?.formula.fingerprint) && prev!.formula.fingerprint === currentFp;
  const manualContent = hasFormulaContent(content) && !materialsCameFromAuto;

  if (formula.ok) {
    if (manualContent && !input.replaceManual) {
      formulaMeta = {
        status: "manual_content",
        message:
          "La OE ya tenía materias primas cargadas a mano: no se reemplazaron. Revisalas o usá «Actualizar desde fórmula y lotes».",
        identity,
      };
      pendientes.push("Fórmula: revisar las materias primas cargadas a mano.");
    } else {
      // Lo registrado por MP (lote y ajuste con su motivo) se conserva cuando la MP sigue en la fórmula.
      // Clave por aparición: la misma MP puede estar dos veces (fases).
      const prevKeys = occurrenceKeys(content.materials);
      const previousByKey = new Map(content.materials.map((m, i) => [prevKeys[i], m]));
      const formulaKeys = occurrenceKeys(formula.materials);
      const nextKeys = new Set(formulaKeys);
      lostRecords = content.materials.filter((m, i) => hasElaboratorData(m) && !nextKeys.has(prevKeys[i])).map(lostOf);
      const materials: OeMaterialRow[] = formula.materials.map((m, i) => {
        const before = previousByKey.get(formulaKeys[i]);
        return emptyOeMaterial({
          // Mismo id de fila: reintentos idénticos no cambian nada.
          ...(before ? { id: before.id } : {}),
          materiaPrima: m.materiaPrima,
          codigo: m.codigo,
          formulaPct: m.formulaPct,
          kgAPesar: null,
          lote: before?.lote ?? "",
          ajuste: before?.ajuste ?? null,
          ajusteMotivo: before?.ajusteMotivo ?? "",
          ajusteAt: before?.ajusteAt ?? null,
          ajusteBy: before?.ajusteBy ?? null,
        });
      });
      next = {
        ...next,
        header: {
          ...next.header,
          // Cambió el producto: el código anterior ya no corresponde.
          code:
            prev?.formula.identity && prev.formula.identity !== identity
              ? formula.ref.productCode || ""
              : next.header.code || formula.ref.productCode || "",
        },
        materials,
        procedureSteps: formula.procedureSteps.map((s) => ({ id: s.id, text: s.text })),
      };
      formulaMeta = {
        status: "ok",
        message: `Fórmula cargada desde ${formula.ref.source === "DRIVE" ? "Google Drive" : "el banco de fórmulas"}.`,
        source: formula.ref.source,
        formulaProductId: formula.ref.formulaProductId,
        formulaVersionId: formula.ref.formulaVersionId,
        versionHash: formula.ref.versionHash,
        displayClient: formula.ref.displayClient,
        displayProduct: formula.ref.displayProduct,
        driveFileId: formula.ref.driveFileId,
        driveModifiedTime: formula.ref.driveModifiedTime ?? null,
        sourceSheet: formula.ref.sourceSheet,
        identity,
      };
      formulaColumns = {
        kind: "set",
        formulaProductId: formula.ref.formulaProductId,
        formulaVersionId: formula.ref.formulaVersionId,
        versionHash: formula.ref.versionHash,
      };
    }
  } else if (materialsCameFromAuto && prev?.formula.status === "ok" && prev.formula.identity === identity) {
    // Mismo producto: la fórmula ya cargada sigue valiendo aunque ahora no se pudo releer (p. ej. Drive caído).
    formulaMeta = { ...prev.formula, message: `Se mantiene la fórmula cargada. ${formula.message}` };
  } else if (materialsCameFromAuto && prev?.formula.status === "ok") {
    // Cambió el producto y no hay fórmula para el nuevo: se quitan las MP de la fórmula anterior (no aplican).
    lostRecords = content.materials.filter(hasElaboratorData).map(lostOf);
    next = { ...next, materials: [], procedureSteps: [] };
    formulaColumns = { kind: "clear" };
    formulaMeta = { status: formula.status, message: formula.message, identity };
    pendientes.push(`Fórmula: ${formula.message}`);
  } else {
    formulaMeta = {
      status: manualContent ? "manual_content" : formula.status,
      message: manualContent
        ? `${formula.message} Se mantienen las materias primas cargadas a mano.`
        : formula.message,
      identity,
    };
    if (!manualContent) pendientes.push(`Fórmula: ${formula.message}`);
  }

  // 3) Lotes de MP: los completa Elaboración en la OE. Nunca se asignan; los ya escritos se conservaron arriba.

  next = recomputeOeDerived(next);
  if (formulaMeta.status === "ok") formulaMeta = { ...formulaMeta, fingerprint: formulaContentFingerprint(next) };
  else if (formulaMeta.fingerprint) formulaMeta = { ...formulaMeta, fingerprint: formulaContentFingerprint(next) };

  const autoPrep: OeAutoPrep = {
    version: 1,
    preparedAt: input.now,
    preparedBy: input.actorEmail,
    reason: input.reason,
    workItemId: work.id,
    workItemVersion: work.version,
    formula: formulaMeta,
    lotFabricacion: { value: lot, status: lot.trim() ? "ok" : "pendiente" },
    quantity: {
      kg: qty.kg,
      planned: work.plannedQuantity,
      unit: work.unit ?? "kg",
      status: qty.kg != null ? "ok" : "pendiente",
    },
    pendientes,
  };
  next = { ...next, autoPrep };

  return {
    content: next,
    formulaColumns,
    changed: stableView(next) !== stableView(content),
    lostRecords,
  };
}
