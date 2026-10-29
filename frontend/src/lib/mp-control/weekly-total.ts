/**
 * CONTROL SEMANAL TOTAL de MP — reglas PURAS (sin I/O). Suma, por MATERIA PRIMA DE INVENTARIO, lo que necesitan TODAS las OE /
 * producciones de Elaboración de una semana, y lo compara con el stock real. Solo lectura: no mueve stock ni toca fórmulas.
 *
 * Identidad de la MP (nunca solo por texto):
 *   1. el CÓDIGO MP de la línea (o el de la fórmula) coincide con el código de inventario (o uno anterior) de UN solo código → ese código;
 *   2. si no hay código válido, el NOMBRE (igual normalizado o equivalencia aprobada) lleva a UN solo código de inventario → ese código;
 *   3. nombre que coincide con varios códigos, o con filas sin código → fila «ambigua» (se suma el stock de esas filas, marcada);
 *   4. sin coincidencia → «no identificada» (se suma la necesidad por nombre, sin stock).
 * Dos MP con nombres parecidos pero códigos distintos NUNCA se mezclan.
 *
 * Tres cantidades distintas por MP: necesidad TEÓRICA (% × kg del lote), consumo ya REGISTRADO (libro mayor, por OE) y
 * necesidad PENDIENTE = teórica − consumida (nunca negativa). El faltante se calcula con la pendiente.
 */
import {
  baseName,
  lotUsability,
  normCode,
  normText,
  round3,
  toNumber,
  type NameAlias,
  type ProductionInput,
  type StockLot,
} from "./availability";

export type TotalOeNeed = {
  productionId: string;
  oeNumber: string;
  client: string;
  product: string;
  /** Fecha(s) de elaboración tal como se planificó («2026-11-03», «2026-11-03 → 2026-11-04» o «Sin fecha»). */
  days: string;
  /** Tamaño del lote (kg) de esta elaboración. */
  lotKg: number | null;
  teorico: number;
  consumido: number;
  pendiente: number;
  /** La producción no tiene cantidad/fórmula confiable: no se sumó. */
  incompleta: boolean;
};

export type TotalStatus = "SUFICIENTE" | "FALTANTE" | "SIN STOCK" | "MP NO IDENTIFICADA" | "MP AMBIGUA" | "DATOS INCOMPLETOS";

export type TotalRow = {
  key: string;
  codigo: string;
  materiaPrima: string;
  teorico: number;
  consumido: number;
  /** Necesidad PENDIENTE (lo que falta elaborar): es el «total necesario». */
  necesario: number;
  stockDisponible: number;
  stockFisico: number;
  faltante: number;
  oeCount: number;
  identificada: boolean;
  estado: TotalStatus;
  notas: string[];
  needs: TotalOeNeed[];
};

export type WeeklyTotalResult = {
  rows: TotalRow[];
  /** Producciones que no pudieron sumarse (sin cantidad/fórmula confiable). */
  incompletas: Array<{ id: string; label: string; reason: string }>;
  summary: { total: number; conFaltante: number; sinIdentificar: number; oeCount: number; necesarioKg: number; faltanteKg: number };
};

type Idx = {
  /** código normalizado (actual o anterior) → códigos canónicos de inventario */
  byCode: Map<string, Set<string>>;
  /** nombre base normalizado → códigos canónicos ("" = filas sin código) */
  byName: Map<string, Set<string>>;
  lots: StockLot[];
};

const canon = (l: StockLot) => normCode(l.codigo);

function buildIndex(lots: StockLot[]): Idx {
  const byCode = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const active = lots.filter((l) => !l.archived);
  for (const l of active) {
    const c = canon(l);
    if (c) {
      for (const k of [c, ...(l.codigosAnteriores ?? []).map(normCode)]) {
        if (!k) continue;
        const s = byCode.get(k) ?? new Set<string>();
        s.add(c);
        byCode.set(k, s);
      }
    }
    const n = baseName(l.descripcion, l.proveedor);
    if (n) {
      const s = byName.get(n) ?? new Set<string>();
      s.add(c);
      byName.set(n, s);
    }
  }
  return { byCode, byName, lots: active };
}

type Ident = { key: string; codigo: string; identificada: boolean; ambigua: boolean; nameKeys: string[] };

function identify(line: { materiaPrima: string; codigo?: string; codigoMp?: string }, idx: Idx, aliases: NameAlias[]): Ident {
  for (const raw of [line.codigoMp, line.codigo]) {
    const k = normCode(raw);
    if (!k) continue;
    const hit = idx.byCode.get(k);
    if (hit && hit.size === 1) {
      const c = [...hit][0]!;
      return { key: `cod:${c}`, codigo: c, identificada: true, ambigua: false, nameKeys: [] };
    }
  }
  const f = normText(line.materiaPrima);
  const names = [f, ...aliases.filter((a) => a.formulaName === f).map((a) => a.stockName)].filter(Boolean);
  const codes = new Set<string>();
  let anyName = false;
  for (const n of names) {
    const s = idx.byName.get(n);
    if (!s) continue;
    anyName = true;
    for (const c of s) codes.add(c);
  }
  if (anyName && codes.size === 1 && !codes.has("")) {
    const c = [...codes][0]!;
    return { key: `cod:${c}`, codigo: c, identificada: true, ambigua: false, nameKeys: names };
  }
  if (anyName) return { key: `name:${f}`, codigo: "", identificada: false, ambigua: true, nameKeys: names };
  return { key: `name:${f}`, codigo: "", identificada: false, ambigua: false, nameKeys: [] };
}

const prodNumber = (p: ProductionInput) => p.oeNumber ?? "";

export function buildWeeklyTotal(params: { lots: StockLot[]; productions: ProductionInput[]; todayIso: string; aliases?: NameAlias[] }): WeeklyTotalResult {
  const aliases = params.aliases ?? [];
  const idx = buildIndex(params.lots);
  const acc = new Map<string, TotalRow & { _name: string; _nameKeys: Set<string>; _clients: Set<string>; _ambiguous: boolean }>();
  const incompletas: WeeklyTotalResult["incompletas"] = [];
  const oeIds = new Set<string>();

  const ensure = (id: Ident, displayName: string) => {
    let r = acc.get(id.key);
    if (!r) {
      r = {
        key: id.key, codigo: id.codigo, materiaPrima: displayName, teorico: 0, consumido: 0, necesario: 0, stockDisponible: 0, stockFisico: 0, faltante: 0,
        oeCount: 0, identificada: id.identificada, estado: "SUFICIENTE", notas: [], needs: [],
        _name: displayName, _nameKeys: new Set(id.nameKeys), _clients: new Set<string>(), _ambiguous: id.ambigua,
      };
      acc.set(id.key, r);
    }
    for (const n of id.nameKeys) r._nameKeys.add(n);
    return r;
  };

  for (const prod of params.productions) {
    if (!prod.reliable) incompletas.push({ id: prod.id, label: prod.label, reason: prod.unreliableReason ?? "Sin datos confiables" });
    // Teórico de ESTA producción por MP de inventario (una MP puede repetirse en varias fases de la fórmula).
    const perKey = new Map<string, { id: Ident; name: string; teorico: number; unreliable: boolean }>();
    for (const line of prod.lines) {
      if (!normText(line.materiaPrima) && !normCode(line.codigoMp || line.codigo)) continue;
      const id = identify(line, idx, aliases);
      const e = perKey.get(id.key) ?? { id, name: line.materiaPrima.trim() || id.codigo, teorico: 0, unreliable: false };
      if (!prod.reliable || line.kg == null || !Number.isFinite(line.kg)) e.unreliable = true;
      else e.teorico = round3(e.teorico + line.kg);
      perKey.set(id.key, e);
    }
    // Consumo ya registrado de ESTA producción, por MP de inventario (nunca más que su teórico).
    const consumedByKey = new Map<string, number>();
    for (const [code, kg] of Object.entries(prod.consumedByCode ?? {})) {
      const c = normCode(code);
      const hit = idx.byCode.get(c);
      const key = `cod:${hit && hit.size === 1 ? [...hit][0]! : c}`;
      consumedByKey.set(key, round3((consumedByKey.get(key) ?? 0) + kg));
    }
    for (const [key, e] of perKey) {
      const row = ensure(e.id, e.name);
      if (prod.client) row._clients.add(normText(prod.client));
      const consumido = e.unreliable ? 0 : Math.min(consumedByKey.get(key) ?? 0, e.teorico);
      const pendiente = e.unreliable ? 0 : round3(Math.max(0, e.teorico - consumido));
      row.teorico = round3(row.teorico + (e.unreliable ? 0 : e.teorico));
      row.consumido = round3(row.consumido + consumido);
      row.necesario = round3(row.necesario + pendiente);
      row.needs.push({
        productionId: prod.id,
        oeNumber: prodNumber(prod),
        client: prod.client ?? "",
        product: prod.product ?? prod.label,
        days: prod.days ?? "",
        lotKg: prod.weekKg ?? null,
        teorico: e.unreliable ? 0 : e.teorico,
        consumido,
        pendiente,
        incompleta: e.unreliable,
      });
      if (!e.unreliable) oeIds.add(prodNumber(prod) || prod.id);
    }
  }

  // Stock real por MP de inventario.
  for (const row of acc.values()) {
    let lots: StockLot[] = [];
    if (row.key.startsWith("cod:")) lots = idx.lots.filter((l) => canon(l) === row.codigo);
    else if (row._ambiguous) lots = idx.lots.filter((l) => row._nameKeys.has(baseName(l.descripcion, l.proveedor)));
    // Nombre mostrado: el del inventario cuando la MP está identificada (la fórmula puede llamarla distinto).
    if (row.key.startsWith("cod:") && lots[0]) row.materiaPrima = String(lots[0].descripcion).split(/\s+[—–]\s+/)[0]!.trim() || row.materiaPrima;
    row.stockFisico = round3(lots.reduce((s, l) => s + Math.max(0, toNumber(l.cantidadKg) ?? 0), 0));
    row.stockDisponible = round3(
      lots.reduce((s, l) => {
        if (!lotUsability(l, params.todayIso).usable) return s;
        // Lote reservado a un cliente: solo lo usan las producciones de ese cliente.
        const reservedFor = normText(l.cliente);
        if (reservedFor && !row._clients.has(reservedFor)) return s;
        return s + (toNumber(l.cantidadKg) ?? 0);
      }, 0)
    );
    row.faltante = round3(Math.max(0, row.necesario - row.stockDisponible));
    const incompleto = row.needs.some((n) => n.incompleta);
    row.oeCount = new Set(row.needs.filter((n) => !n.incompleta).map((n) => n.oeNumber || n.productionId)).size;
    if (row._ambiguous) row.notas.push("El nombre coincide con varios códigos o filas sin código del inventario: el stock mostrado suma esas filas.");
    if (!row.identificada && !row._ambiguous) row.notas.push("No se encontró en el inventario por código ni por nombre.");
    if (incompleto) row.notas.push("Hay producciones sin cantidad/fórmula confiable que no se pudieron sumar.");
    if (row.consumido > 0) row.notas.push(`Ya se consumieron ${row.consumido} kg (libro mayor): no se vuelven a contar.`);
    row.estado = !row.identificada && !row._ambiguous ? "MP NO IDENTIFICADA" : row._ambiguous ? "MP AMBIGUA" : incompleto && row.necesario === 0 ? "DATOS INCOMPLETOS" : row.faltante > 0 ? (row.stockDisponible <= 0 ? "SIN STOCK" : "FALTANTE") : "SUFICIENTE";
  }

  const rows = [...acc.values()]
    .map(({ _name, _nameKeys, _clients, _ambiguous, ...r }) => {
      void _name; void _nameKeys; void _clients; void _ambiguous;
      return { ...r, needs: [...r.needs].sort((a, b) => a.days.localeCompare(b.days) || a.oeNumber.localeCompare(b.oeNumber)) };
    })
    .sort((a, b) => b.faltante - a.faltante || b.necesario - a.necesario || a.materiaPrima.localeCompare(b.materiaPrima, "es"));

  return {
    rows,
    incompletas,
    summary: {
      total: rows.length,
      conFaltante: rows.filter((r) => r.faltante > 0).length,
      sinIdentificar: rows.filter((r) => !r.identificada).length,
      oeCount: oeIds.size,
      necesarioKg: round3(rows.reduce((s, r) => s + r.necesario, 0)),
      faltanteKg: round3(rows.reduce((s, r) => s + r.faltante, 0)),
    },
  };
}

/** Filas planas para exportar a Excel (los totales salen de las MISMAS filas que se ven en pantalla). */
export function weeklyTotalToSheets(result: WeeklyTotalResult): { total: Array<Array<string | number>>; detalle: Array<Array<string | number>> } {
  const total: Array<Array<string | number>> = [["Código", "Materia prima", "Necesidad teórica (kg)", "Consumo registrado (kg)", "Necesidad pendiente / Total necesario (kg)", "Stock disponible (kg)", "Faltante (kg)", "Cantidad de OE", "Estado"]];
  for (const r of result.rows) total.push([r.codigo, r.materiaPrima, r.teorico, r.consumido, r.necesario, r.stockDisponible, r.faltante, r.oeCount, r.estado]);
  total.push(["", "TOTAL", round3(result.rows.reduce((s, r) => s + r.teorico, 0)), round3(result.rows.reduce((s, r) => s + r.consumido, 0)), result.summary.necesarioKg, "", result.summary.faltanteKg, result.summary.oeCount, ""]);
  const detalle: Array<Array<string | number>> = [["Código", "Materia prima", "OE", "Cliente", "Producto", "Fecha de elaboración", "Tamaño del lote (kg)", "Teórico (kg)", "Consumido (kg)", "Pendiente (kg)"]];
  for (const r of result.rows) {
    for (const n of r.needs) detalle.push([r.codigo, r.materiaPrima, n.oeNumber, n.client, n.product, n.days, n.lotKg ?? "", n.teorico, n.consumido, n.pendiente]);
    detalle.push([r.codigo, `${r.materiaPrima} — TOTAL`, "", "", "", "", "", r.teorico, r.consumido, r.necesario]);
  }
  return { total, detalle };
}
