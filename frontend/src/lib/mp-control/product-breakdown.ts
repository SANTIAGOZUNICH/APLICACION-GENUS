/**
 * Control semanal por PRODUCTO — reglas PURAS (sin I/O). Parte de las filas ya calculadas por `computeAvailability`
 * (stock compartido, equivalencias aprobadas, consumos ya descontados) y de las producciones de la semana, y arma una
 * sección por producto con su fórmula completa. No toca stock, fórmulas, OE ni consumos.
 *
 * Reglas:
 *  - Una sección por cliente + producto + fórmula. Dos OE del mismo producto se agrupan SOLO si sus fórmulas son
 *    equivalentes (mismas MP y mismos %); si difieren, quedan en secciones separadas y se avisa.
 *  - El stock es COMPARTIDO: cada kg se asigna a UN solo producto. Se reparte por orden de fecha de elaboración (y luego
 *    cliente/producto); el lote reservado a un cliente solo sirve a las producciones de ese cliente. Así dos fórmulas no
 *    pueden mostrarse «cubiertas» con los mismos kilos.
 *  - Una MP no identificada (o sin datos confiables) es GRIS: nunca se lee como stock cero.
 */
import { normText, round3, type AvailabilityRow, type ProductionInput } from "./availability";
import { toneOfNumbers, toneOfStatus, type Tone } from "./availability-tone";

export type ProductLine = {
  /** Clave de la fila consolidada (estado administrativo: observación, gestión, exclusión). */
  rowKey: string;
  materiaPrima: string;
  codigo: string;
  pct: number | null;
  /** Necesidad de ESTE producto (suma de sus OE de la semana); null = sin cantidad confiable. */
  needKg: number | null;
  stockFisico: number;
  /** Stock utilizable total de esta MP (compartido con los demás productos si `shared`). */
  stockUtilizable: number;
  reservado: number;
  /** Kg que le quedan disponibles a ESTE producto tras los productos anteriores (orden de elaboración). */
  availableForThis: number;
  /** availableForThis − necesidad (negativo = faltan). */
  diferencia: number | null;
  /** Saldo de la MP tras TODA la demanda de la semana. */
  saldoProyectado: number;
  rowEstado: AvailabilityRow["estado"];
  tone: Tone;
  saldoTone: Tone;
  shared: boolean;
  sharedWith: string[];
  /** Kg que se asignaron a este producto. */
  allocatedKg: number;
  /** La MP la quitó una persona del control de la semana (no cuenta en los totales). */
  excluded: boolean;
  note?: string;
};

export type ProductOe = { workId: string; oeNumber: string | null; kg: number | null; days: string; source: "OE" | "FORMULA" | "SIN_FORMULA"; note?: string; reliable: boolean };

export type ProductOverall = "CUBIERTA" | "CON_FALTANTES" | "SIN_STOCK" | "DATOS_INCOMPLETOS";
export const OVERALL_LABEL: Record<ProductOverall, string> = {
  CUBIERTA: "FÓRMULA CUBIERTA",
  CON_FALTANTES: "CON FALTANTES",
  SIN_STOCK: "CON MP SIN STOCK",
  DATOS_INCOMPLETOS: "DATOS INCOMPLETOS",
};

export type ProductSection = {
  id: string;
  client: string;
  product: string;
  oes: ProductOe[];
  totalKg: number | null;
  days: string;
  startDate: string;
  lines: ProductLine[];
  counts: { ok: number; partial: number; none: number; unknown: number; total: number };
  overall: ProductOverall;
  /** Otra fórmula distinta del mismo producto en la semana: no se fusionaron. */
  versionNote: string | null;
  notes: string[];
};

export type ProductSummary = {
  products: number;
  covered: number;
  withShortage: number;
  /** MP (consolidadas) con faltante parcial / sin stock / no identificadas. */
  mpPartial: number;
  mpNone: number;
  mpUnidentified: number;
  /** Necesidades (línea de producto × MP) sin datos confiables. */
  incompleteNeeds: number;
};

export function formulaSignature(p: Pick<ProductionInput, "lines">): string {
  const parts = p.lines.filter((l) => normText(l.materiaPrima)).map((l) => `${normText(l.materiaPrima)}:${l.pct == null ? "?" : round3(l.pct)}`).sort();
  return parts.length ? parts.join("|") : "SIN_FORMULA";
}

const startOf = (days: string) => (/^\d{4}-\d{2}-\d{2}/.exec(days)?.[0] ?? "9999-12-31");

export function buildProductBreakdown(params: {
  rows: AvailabilityRow[];
  productions: ProductionInput[];
  /** Filas que una persona quitó del control (y no hay motivo para revisarlas). */
  excludedKeys?: ReadonlySet<string>;
  /** Trabajos de la misma OE que no se suman de nuevo: solo aportan fechas al encabezado. */
  duplicates?: Array<{ id: string; oeNumber?: string; days: string; note?: string }>;
}): { sections: ProductSection[]; summary: ProductSummary } {
  const excludedKeys = params.excludedKeys ?? new Set<string>();
  const rowByKey = new Map(params.rows.map((r) => [r.key, r]));
  // Cada necesidad apunta a su fila consolidada.
  const needIndex = new Map<string, { row: AvailabilityRow; kg: number; unreliable: boolean }[]>();
  for (const row of params.rows) for (const n of row.needs) {
    const k = `${n.productionId}|${n.line ?? ""}`;
    needIndex.set(k, [...(needIndex.get(k) ?? []), { row, kg: n.kg, unreliable: Boolean(n.unreliable) }]);
  }

  // 1) Agrupar producciones por cliente + producto + fórmula.
  const groups = new Map<string, ProductionInput[]>();
  const byProduct = new Map<string, Set<string>>();
  for (const p of params.productions) {
    const product = p.product ?? p.label;
    const pk = `${normText(p.client)}|${normText(product)}`;
    const key = `${pk}|${formulaSignature(p)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
    byProduct.set(pk, (byProduct.get(pk) ?? new Set()).add(key));
  }

  const sections: ProductSection[] = [];
  for (const [key, prods] of groups) {
    const first = prods[0]!;
    const product = first.product ?? first.label;
    const pk = `${normText(first.client)}|${normText(product)}`;
    const versions = byProduct.get(pk)?.size ?? 1;
    const dupDays = (params.duplicates ?? []).filter((d) => d.oeNumber && prods.some((p) => p.oeNumber === d.oeNumber));
    const days = [...new Set([...prods.map((p) => p.days ?? ""), ...dupDays.map((d) => d.days)].filter(Boolean))].join(" · ");
    const kgs = prods.map((p) => p.weekKg).filter((k): k is number => k != null);
    sections.push({
      id: key,
      client: first.client ?? "",
      product,
      oes: [
        ...prods.map((p) => ({ workId: p.id, oeNumber: p.oeNumber ?? null, kg: p.weekKg ?? null, days: p.days ?? "", source: p.source ?? ("OE" as const), note: p.note, reliable: p.reliable })),
        ...dupDays.map((d) => ({ workId: d.id, oeNumber: d.oeNumber ?? null, kg: null, days: d.days, source: "OE" as const, note: d.note, reliable: true })),
      ],
      totalKg: kgs.length ? round3(kgs.reduce((s, k) => s + k, 0)) : null,
      days,
      startDate: prods.map((p) => startOf(p.days ?? "")).sort()[0] ?? "9999-12-31",
      lines: [],
      counts: { ok: 0, partial: 0, none: 0, unknown: 0, total: 0 },
      overall: "CUBIERTA",
      versionNote: versions > 1 ? "Hay otra fórmula DISTINTA de este mismo producto en la semana: no se fusionaron (se muestran por separado)." : null,
      notes: prods.filter((p) => !p.reliable).map((p) => `${p.oeNumber ? `OE ${p.oeNumber}: ` : ""}${p.unreliableReason ?? "sin datos confiables"}`),
    });
  }
  sections.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.client.localeCompare(b.client, "es") || a.product.localeCompare(b.product, "es"));

  // 2) Líneas de cada producto, con el stock repartido por orden (compartido → asignado).
  const pools = new Map<string, { free: number; byClient: Map<string, number> }>();
  const poolOf = (row: AvailabilityRow) => {
    let p = pools.get(row.key);
    if (!p) {
      p = { free: 0, byClient: new Map() };
      for (const l of row.lotes) {
        if (!l.usable || l.kgRegistrados <= 0) continue;
        const c = normText(l.cliente);
        if (c) p.byClient.set(c, round3((p.byClient.get(c) ?? 0) + l.kgRegistrados));
        else p.free = round3(p.free + l.kgRegistrados);
      }
      pools.set(row.key, p);
    }
    return p;
  };
  const sectionsByRow = new Map<string, Set<string>>();
  const prodsOf = (s: ProductSection) => groups.get(s.id) ?? [];
  for (const s of sections) for (const p of prodsOf(s)) for (const l of p.lines) {
    for (const e of needIndex.get(`${p.id}|${normText(l.materiaPrima)}`) ?? []) sectionsByRow.set(e.row.key, (sectionsByRow.get(e.row.key) ?? new Set()).add(s.id));
  }

  for (const s of sections) {
    const prods = prodsOf(s);
    const clientKey = normText(s.client);
    const seen = new Set<string>();
    const lineNames: Array<{ norm: string; name: string; codigo: string; pct: number | null }> = [];
    for (const p of prods) for (const l of p.lines) {
      const norm = normText(l.materiaPrima);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      lineNames.push({ norm, name: l.materiaPrima.trim(), codigo: (l.codigo || l.codigoMp || "").trim(), pct: l.pct ?? null });
    }
    for (const ln of lineNames) {
      let need: number | null = 0;
      let row: AvailabilityRow | undefined;
      let pct: number | null = null;
      for (const p of prods) {
        const entries = needIndex.get(`${p.id}|${ln.norm}`) ?? [];
        for (const e of entries) {
          row = e.row;
          if (e.unreliable) need = null;
          else if (need != null) need = round3(need + e.kg);
        }
        const pl = p.lines.filter((l) => normText(l.materiaPrima) === ln.norm);
        for (const l of pl) if (l.pct != null) pct = round3((pct ?? 0) + l.pct);
        if (!p.reliable) need = null;
      }
      if (!row) {
        // Sin fila consolidada (necesidad nula): no hay dato para compararla.
        s.lines.push({ rowKey: ln.norm, materiaPrima: ln.name, codigo: ln.codigo, pct, needKg: need, stockFisico: 0, stockUtilizable: 0, reservado: 0, availableForThis: 0, diferencia: null, saldoProyectado: 0, rowEstado: "DATOS INCOMPLETOS", tone: "unknown", saldoTone: "unknown", shared: false, sharedWith: [], allocatedKg: 0, excluded: false, note: "Sin datos confiables para esta línea." });
        continue;
      }
      const pool = poolOf(row);
      const clientPool = pool.byClient.get(clientKey) ?? 0;
      const available = round3(pool.free + clientPool);
      const rowUnknown = toneOfStatus(row.estado) === "unknown";
      const tone: Tone = rowUnknown || need == null ? "unknown" : toneOfNumbers({ need, usable: available });
      let allocated = 0;
      if (tone !== "unknown" && need != null) {
        allocated = Math.min(need, available);
        const fromClient = Math.min(allocated, clientPool);
        if (fromClient > 0) pool.byClient.set(clientKey, round3(clientPool - fromClient));
        pool.free = round3(pool.free - (allocated - fromClient));
      }
      const sharers = [...(sectionsByRow.get(row.key) ?? [])].filter((id) => id !== s.id);
      const sharedWith = sharers.map((id) => sections.find((x) => x.id === id)).filter((x): x is ProductSection => Boolean(x)).map((x) => `${x.client} — ${x.product}`);
      const saldoTone: Tone = rowUnknown ? "unknown" : row.stockUtilizable <= 0 && row.requerido > 0 ? "none" : row.saldoProyectado < 0 ? "partial" : "ok";
      const notes: string[] = [];
      if (tone === "none" && row.stockUtilizable > 0) notes.push("El stock de esta MP quedó asignado a productos que se elaboran antes.");
      if (tone === "ok" && row.saldoProyectado < 0) notes.push("Alcanza para este producto, pero la MP no alcanza para todos los de la semana.");
      if (row.estado === "MP NO IDENTIFICADA") notes.push("MP no identificada en el Stock MP: no se asume stock cero.");
      s.lines.push({
        rowKey: row.key,
        materiaPrima: ln.name,
        codigo: ln.codigo || row.codigoMaestro,
        pct,
        needKg: need,
        stockFisico: row.stockFisico,
        stockUtilizable: row.stockUtilizable,
        reservado: row.reservado,
        availableForThis: tone === "unknown" ? 0 : round3(available),
        diferencia: tone === "unknown" || need == null ? null : round3(available - need),
        saldoProyectado: row.saldoProyectado,
        rowEstado: row.estado,
        tone,
        saldoTone,
        shared: sharedWith.length > 0,
        sharedWith,
        allocatedKg: round3(allocated),
        excluded: excludedKeys.has(row.key),
        note: notes.join(" ") || undefined,
      });
    }
    for (const l of s.lines) {
      if (l.excluded) continue;
      s.counts[l.tone] += 1;
      s.counts.total += 1;
    }
    if (prods.some((p) => !p.reliable) && s.counts.unknown === 0) s.counts.unknown = 1;
    s.overall = s.counts.unknown > 0 ? "DATOS_INCOMPLETOS" : s.counts.none > 0 ? "SIN_STOCK" : s.counts.partial > 0 ? "CON_FALTANTES" : "CUBIERTA";
  }

  const summary: ProductSummary = {
    products: sections.length,
    covered: sections.filter((s) => s.overall === "CUBIERTA").length,
    withShortage: sections.filter((s) => s.counts.partial + s.counts.none > 0).length,
    mpPartial: params.rows.filter((r) => r.estado === "FALTANTE" && !excludedKeys.has(r.key)).length,
    mpNone: params.rows.filter((r) => (r.estado === "SIN STOCK" || r.estado === "SIN STOCK UTILIZABLE") && !excludedKeys.has(r.key)).length,
    mpUnidentified: params.rows.filter((r) => r.estado === "MP NO IDENTIFICADA" && !excludedKeys.has(r.key)).length,
    incompleteNeeds: sections.reduce((n, s) => n + s.counts.unknown, 0),
  };
  void rowByKey;
  return { sections, summary };
}

export type ProductFilter = "TODOS" | "SUFICIENTES" | "CON_FALTANTES" | "SIN_STOCK" | "DATOS_INCOMPLETOS";
export function matchesProductFilter(s: ProductSection, f: ProductFilter): boolean {
  switch (f) {
    case "SUFICIENTES":
      return s.overall === "CUBIERTA";
    case "CON_FALTANTES":
      return s.counts.partial + s.counts.none > 0;
    case "SIN_STOCK":
      return s.counts.none > 0;
    case "DATOS_INCOMPLETOS":
      return s.counts.unknown > 0;
    default:
      return true;
  }
}
