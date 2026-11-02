/**
 * Sugerencias de materiales por producto — reglas PURAS + armado/validación del pedido a la IA (Creamy OS / Gemini).
 *
 * Principios (no negociables):
 *  - La IA recibe SOLO candidatos reales del inventario de ME y su respuesta se valida: un código fuera de la lista se
 *    descarta. Nunca inventa un SKU ni afirma que hay stock.
 *  - Una sugerencia es SIEMPRE «SUGERIDO»: nadie la da por confirmada salvo una persona (Depósito).
 *  - Dos piezas no son compatibles porque se parezcan sus nombres: solo hay compatibilidad confirmada si una persona la
 *    registró. Las marcadas INCOMPATIBLE jamás se vuelven a sugerir.
 */
import { accessoriesNeededBy, classifyRole, keyOf, type MeRole } from "./families";
import type { ConfigRow } from "./compute";

export type CatalogMaterial = { codigo: string; descripcion: string; cliente: string; producto: string };
export type CompatRow = { baseCodigo: string; accessoryCodigo: string; status: "COMPATIBLE" | "INCOMPATIBLE" };

export type SuggestedRow = { materialCodigo: string; role: MeRole; qtyPerUnit: number; source: "INVENTARIO" | "COMPATIBILIDAD" | "IA"; reason: string };

export type AccessoryGap = { envaseCodigo: string; envaseDescripcion: string; role: "CIERRE" | "DISPENSADOR"; label: string; hint: string; candidates: CatalogMaterial[] };

const MAX_CANDIDATES = 8;

/** Sugerencias determinísticas (sin IA): vínculo del inventario con el producto + compatibilidades registradas. */
export function deterministicSuggestions(args: { client: string; product: string; rows: readonly ConfigRow[]; catalog: readonly CatalogMaterial[]; compat: readonly CompatRow[] }): { suggestions: SuggestedRow[]; gaps: AccessoryGap[] } {
  const live = args.rows.filter((r) => r.status !== "RECHAZADO");
  const rejected = new Set(args.rows.filter((r) => r.status === "RECHAZADO" && r.materialCodigo).map((r) => `${r.role}|${keyOf(r.materialCodigo)}`));
  const taken = new Set(live.filter((r) => r.materialCodigo).map((r) => keyOf(r.materialCodigo)));
  const ck = keyOf(args.client);
  const pk = keyOf(args.product);
  const byCode = new Map(args.catalog.map((m) => [keyOf(m.codigo), m]));
  const suggestions: SuggestedRow[] = [];
  const add = (s: SuggestedRow) => {
    const k = keyOf(s.materialCodigo);
    if (taken.has(k) || rejected.has(`${s.role}|${k}`)) return;
    taken.add(k);
    suggestions.push(s);
  };

  // 1) Producto sin nada asociado: materiales del inventario cuyo CLIENTE + PRODUCTO coinciden exactamente.
  if (live.length === 0 && ck && pk) {
    for (const m of args.catalog) {
      if (keyOf(m.cliente) === ck && keyOf(m.producto) === pk) add({ materialCodigo: m.codigo, role: classifyRole(m.descripcion), qtyPerUnit: 1, source: "INVENTARIO", reason: "El material de Stock ME está cargado para este cliente y producto." });
    }
  }

  // 2) Envases que todavía no tienen su accesorio.
  const all = [...live.map((r) => ({ codigo: r.materialCodigo, role: r.role })), ...suggestions.map((s) => ({ codigo: s.materialCodigo, role: s.role }))];
  const gaps: AccessoryGap[] = [];
  for (const base of all) {
    if (base.role !== "ENVASE" || !base.codigo) continue;
    const mat = byCode.get(keyOf(base.codigo));
    const desc = mat?.descripcion ?? base.codigo;
    for (const need of accessoriesNeededBy(desc)) {
      const hasRole = [...live.map((r) => r.role), ...suggestions.map((s) => s.role)].includes(need.role);
      if (hasRole) continue;
      const pairs = args.compat.filter((c) => keyOf(c.baseCodigo) === keyOf(base.codigo));
      const bad = new Set(pairs.filter((c) => c.status === "INCOMPATIBLE").map((c) => keyOf(c.accessoryCodigo)));
      const okPair = pairs.find((c) => c.status === "COMPATIBLE" && classifyRole(byCode.get(keyOf(c.accessoryCodigo))?.descripcion ?? "") === need.role && !bad.has(keyOf(c.accessoryCodigo)));
      if (okPair) {
        add({ materialCodigo: okPair.accessoryCodigo, role: need.role, qtyPerUnit: 1, source: "COMPATIBILIDAD", reason: `Compatibilidad registrada entre ${base.codigo} y ${okPair.accessoryCodigo}.` });
        continue;
      }
      const candidates = args.catalog
        .filter((m) => classifyRole(m.descripcion) === need.role && !bad.has(keyOf(m.codigo)) && !rejected.has(`${need.role}|${keyOf(m.codigo)}`) && !taken.has(keyOf(m.codigo)))
        .sort((a, b) => Number(keyOf(b.cliente) === ck) - Number(keyOf(a.cliente) === ck) || a.codigo.localeCompare(b.codigo))
        .filter((m) => !ck || !m.cliente || keyOf(m.cliente) === ck)
        .slice(0, MAX_CANDIDATES);
      gaps.push({ envaseCodigo: base.codigo, envaseDescripcion: desc, role: need.role, label: need.label, hint: need.hint, candidates });
    }
  }
  return { suggestions, gaps };
}

export function buildAccessoryPrompt(client: string, product: string, gaps: readonly AccessoryGap[]): string {
  const payload = gaps.map((g, i) => ({
    gapId: String(i),
    cliente: client,
    producto: product,
    envase: { codigo: g.envaseCodigo, descripcion: g.envaseDescripcion },
    necesita: `${g.label} (${g.hint})`,
    candidatos: g.candidates.map((c) => ({ codigo: c.codigo, descripcion: c.descripcion, cliente: c.cliente })),
  }));
  return `Sos un especialista en materiales de envase de un laboratorio de cosmética. Para cada envase te paso candidatos REALES de nuestro inventario para el accesorio que necesita (tapa, dropper, válvula, pulverizador, bolilla…).
Reglas estrictas:
- Usá SOLO los códigos de "candidatos" de ese envase. Nunca inventes un código ni propongas algo que no esté en la lista.
- NO asumas compatibilidad porque los nombres se parezcan: considerá tipo de rosca/cuello, volumen o medida si figuran, y el cliente. Si falta un dato para asegurar que encajan, el veredicto es "probable"; si hay una contradicción (otra medida, otro tipo), "no_compatible".
- Nunca afirmes que hay stock: eso no lo sabés.
- Explicá en una frase corta (máx. 140 caracteres) en español.
Devolvé SOLO JSON: {"results":[{"gapId":string,"options":[{"code":string,"verdict":"compatible"|"probable"|"no_compatible","reason":string}]}]}
Datos:
${JSON.stringify(payload)}`;
}

/** Valida la respuesta del modelo contra los candidatos enviados. Nunca confía en ella. Devuelve a lo sumo UNA sugerencia por hueco. */
export function parseAccessoryAnswer(answer: unknown, gaps: readonly AccessoryGap[]): Array<{ gapIndex: number; suggestion: SuggestedRow }> {
  const out: Array<{ gapIndex: number; suggestion: SuggestedRow }> = [];
  const root = (answer && typeof answer === "object" ? answer : {}) as { results?: unknown };
  const results = Array.isArray(root.results) ? root.results : Array.isArray(answer) ? (answer as unknown[]) : [];
  for (const r of results) {
    const o = (r && typeof r === "object" ? r : {}) as { gapId?: unknown; options?: unknown };
    const idx = Number(o.gapId);
    const gap = gaps[idx];
    if (!gap || !Array.isArray(o.options)) continue;
    const allowed = new Map(gap.candidates.map((c) => [keyOf(c.codigo), c]));
    const ranked = (o.options as unknown[])
      .map((x) => (x && typeof x === "object" ? x : {}) as { code?: unknown; verdict?: unknown; reason?: unknown })
      .map((x) => ({ cand: allowed.get(keyOf(String(x.code ?? ""))), verdict: String(x.verdict ?? ""), reason: String(x.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160) }))
      .filter((x) => x.cand && (x.verdict === "compatible" || x.verdict === "probable"))
      .sort((a, b) => Number(b.verdict === "compatible") - Number(a.verdict === "compatible"));
    const best = ranked[0];
    if (!best?.cand) continue;
    out.push({ gapIndex: idx, suggestion: { materialCodigo: best.cand.codigo, role: gap.role, qtyPerUnit: 1, source: "IA", reason: `IA (${best.verdict}): ${best.reason || "evaluado por IA"} — requiere confirmación.` } });
  }
  return out;
}
