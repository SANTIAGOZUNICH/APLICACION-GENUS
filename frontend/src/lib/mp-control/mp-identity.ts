/**
 * Identidad de materias primas — reglas PURAS (sin I/O).
 *
 * Sirve para que una denominación distinta (nombre comercial, inglés, INCI, abreviatura) se reconozca como CANDIDATA a una
 * MP real del catálogo, sin exigir nombres idénticos. Nunca confirma sola: devuelve candidatos con motivo y confianza
 * cualitativa; quien tiene permiso decide. Un candidato que contradice concentración / grado / presentación se DESCARTA.
 *
 * Los grupos de sinónimos son candidatos, no equivalencias universales: «PANTENOL» y «PROVITAMINA B5» solo se proponen
 * y se descartan si las concentraciones informadas difieren.
 */

export type IdentityConfidence = "ALTA" | "MEDIA" | "BAJA";

const strip = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Texto comparable: sin tildes/mayúsculas/signos, espacios simples. */
export const idNorm = (s: string) => strip(s).replace(/[^a-z0-9%.,]+/g, " ").replace(/\s+/g, " ").trim();

/** Grupos de sinónimos (cada término ya normalizado). Solo generan CANDIDATOS. */
const SYNONYM_GROUPS: string[][] = [
  ["glicerina", "glicerina vegetal", "glicerol", "glycerin", "glycerine", "glycerol"],
  ["pantenol", "d pantenol", "dl pantenol", "panthenol", "d panthenol", "dl panthenol", "provitamina b5", "provitamin b5"],
  ["acido hialuronico", "hialuronato de sodio", "sodium hyaluronate", "hyaluronic acid"],
  ["alcohol cetilico", "cetyl alcohol", "alcohol cetilico"],
  ["alcohol cetoestearilico", "cetearyl alcohol", "alcohol cetostearilico"],
  ["propilenglicol", "propilen glicol", "propylene glycol", "pg"],
  ["acido citrico", "citric acid"],
  ["acido salicilico", "salicylic acid"],
  ["niacinamida", "niacinamide", "nicotinamida", "vitamina b3"],
  ["aloe vera", "aloe barbadensis", "aloe barbadensis leaf juice", "sabila"],
  ["tocoferol", "vitamina e", "tocopherol"],
  ["acetato de tocoferol", "tocopheryl acetate", "vitamina e acetato"],
  ["dimeticona", "dimethicone", "silicona liquida"],
  ["urea", "carbamida"],
  ["alantoina", "allantoin"],
  ["fenoxietanol", "phenoxyethanol"],
  ["manteca de karite", "shea butter", "butyrospermum parkii butter", "karite"],
  ["aceite de coco", "coconut oil", "cocos nucifera oil"],
  ["aceite de jojoba", "jojoba oil", "simmondsia chinensis seed oil"],
  ["dioxido de titanio", "titanium dioxide"],
  ["agua destilada", "agua purificada", "agua desmineralizada", "aqua", "purified water", "water"],
];

const synIndex = new Map<string, number[]>();
SYNONYM_GROUPS.forEach((g, i) => {
  for (const t of g) {
    const k = idNorm(t);
    const cur = synIndex.get(k) ?? [];
    if (!cur.includes(i)) cur.push(i);
    synIndex.set(k, cur);
  }
});

/** Concentraciones («70%», «99,5 %», «50 % p/p») y grados/calidades que cambian la identidad. */
export function extractSpec(s: string): { pcts: number[]; grades: string[]; presentation: string[] } {
  const t = strip(s);
  const pcts: number[] = [];
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    const n = Number(m[1]!.replace(",", "."));
    if (Number.isFinite(n)) pcts.push(n);
  }
  const grades = [...new Set([...t.matchAll(/\b(usp|bp|ph\.?\s?eur|ep|fcc|cosmetic[oa]?|grado\s+\w+|tecnic[oa]|farmaceutic[oa]|alimenticio|food|pharma|technical)\b/g)].map((m) => m[1]!.replace(/\s+/g, " ")))];
  const presentation = [...new Set([...t.matchAll(/\b(polvo|powder|liquid[oa]?|liquid|solucion|solution|gel|crema|cristal(?:es)?|granulad[oa]|oleos[oa]|hidrosoluble|liposoluble|en polvo)\b/g)].map((m) => m[1]!))];
  return { pcts, grades, presentation };
}

const PRES_ALIAS: Record<string, string> = { powder: "polvo", "en polvo": "polvo", liquid: "liquido", liquida: "liquido", liquido: "liquido", solution: "solucion" };
const canonPres = (p: string) => PRES_ALIAS[p] ?? p;

/** ¿Las especificaciones informadas se contradicen? (solo si AMBOS lados informan el dato). */
export function specConflict(a: string, b: string): string | null {
  const A = extractSpec(a);
  const B = extractSpec(b);
  if (A.pcts.length && B.pcts.length && !A.pcts.some((x) => B.pcts.some((y) => Math.abs(x - y) < 0.0001))) {
    return `concentración distinta (${A.pcts.join("/")}% vs ${B.pcts.join("/")}%)`;
  }
  if (A.grades.length && B.grades.length && !A.grades.some((g) => B.grades.includes(g))) {
    return `grado distinto (${A.grades.join("/")} vs ${B.grades.join("/")})`;
  }
  const pa = A.presentation.map(canonPres);
  const pb = B.presentation.map(canonPres);
  if (pa.length && pb.length && !pa.some((p) => pb.includes(p))) return `presentación distinta (${pa.join("/")} vs ${pb.join("/")})`;
  return null;
}

/** Nombre sin concentración/grado/presentación, para comparar la identidad base. */
export function coreName(s: string): string {
  return idNorm(
    strip(s)
      .replace(/\d+(?:[.,]\d+)?\s*%(\s*p\/p|\s*p\/v)?/g, " ")
      .replace(/\b(usp|bp|ep|fcc|grado\s+\w+|tecnic[oa]|farmaceutic[oa]|cosmetic[oa]?|alimenticio|polvo|en polvo|powder|liquid[oa]?|liquido|solucion|solution|x\s*\d+\s*(kg|g|l|lt|ml)?|bidon|tambor|bolsa|caja|envase)\b/g, " "),
  );
}

export type IdentityCandidate = { code: string; description: string; confidence: IdentityConfidence; reason: string; kind: "codigo" | "alias" | "normalizado" | "sinonimo" | "parecido" };
export type IdentityCatalogItem = { code: string; description: string; /** Códigos anteriores / del proveedor del propio material. */ otherCodes?: string[]; supplierNames?: string[] };

const codeKeyOf = (s: string) => strip(s).replace(/[^a-z0-9]+/g, "");
const wordTokens = (s: string) => idNorm(s).split(" ").filter((t) => t.length > 2 && !/^\d/.test(t));

/**
 * Candidatos del catálogo REAL para una denominación. Niveles: código exacto único → alias confirmado (`confirmed`)
 * → nombre normalizado igual → sinónimo conocido → palabras en común (solo BAJA/MEDIA). Descarta candidatos cuya
 * concentración/grado/presentación contradice. El resultado es acotado (`limit`) — apto para pasar a un modelo sin
 * enviar todo el inventario.
 */
export function identifyMaterial(
  input: { name: string; code?: string },
  catalog: IdentityCatalogItem[],
  opts: { confirmed?: Array<{ denomination: string; code: string }>; limit?: number } = {},
): { candidates: IdentityCandidate[]; discarded: Array<{ code: string; reason: string }> } {
  const limit = opts.limit ?? 5;
  const out = new Map<string, IdentityCandidate>();
  const discarded: Array<{ code: string; reason: string }> = [];
  const byCode = new Map(catalog.map((c) => [codeKeyOf(c.code), c]));
  const order: Record<IdentityConfidence, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  const put = (c: IdentityCandidate) => {
    const prev = out.get(c.code);
    if (!prev || order[c.confidence] < order[prev.confidence]) out.set(c.code, c);
  };

  // 1) Código exacto y único.
  const ck = codeKeyOf(input.code ?? "");
  if (ck.length >= 3) {
    const hits = catalog.filter((c) => codeKeyOf(c.code) === ck || (c.otherCodes ?? []).some((o) => codeKeyOf(o) === ck));
    if (hits.length === 1) put({ code: hits[0]!.code, description: hits[0]!.description, confidence: "ALTA", reason: "El código coincide exacto con un único material", kind: "codigo" });
  }
  // 2) Alias ya confirmado por una persona.
  const n = idNorm(input.name);
  for (const a of opts.confirmed ?? []) {
    if (idNorm(a.denomination) === n && n) {
      const item = byCode.get(codeKeyOf(a.code));
      if (item) put({ code: item.code, description: item.description, confidence: "ALTA", reason: "Equivalencia ya confirmada antes", kind: "alias" });
    }
  }
  const nCore = coreName(input.name);
  const groups = new Set(synIndex.get(nCore) ?? synIndex.get(n) ?? []);
  const nTokens = new Set(wordTokens(nCore));
  for (const item of catalog) {
    const iNorm = idNorm(item.description);
    const iCore = coreName(item.description);
    const conflict = specConflict(input.name, item.description);
    let cand: IdentityCandidate | null = null;
    if (iNorm === n && n) cand = { code: item.code, description: item.description, confidence: "ALTA", reason: "Mismo nombre (sin diferencias de mayúsculas, tildes o signos)", kind: "normalizado" };
    else if (iCore === nCore && nCore) {
      const sa = extractSpec(input.name);
      const sb = extractSpec(item.description);
      const oneSided = (sa.pcts.length > 0) !== (sb.pcts.length > 0) || (sa.grades.length > 0) !== (sb.grades.length > 0);
      cand = oneSided
        ? { code: item.code, description: item.description, confidence: "MEDIA", reason: "Mismo nombre, pero solo un lado informa concentración/grado: verificá la especificación", kind: "normalizado" }
        : { code: item.code, description: item.description, confidence: "ALTA", reason: "Mismo material; la presentación/grado no se contradicen", kind: "normalizado" };
    }
    else if ((item.supplierNames ?? []).some((s) => idNorm(s) === n && n)) cand = { code: item.code, description: item.description, confidence: "ALTA", reason: "Nombre usado por el proveedor para este material", kind: "alias" };
    else if (groups.size && (synIndex.get(iCore) ?? synIndex.get(iNorm) ?? []).some((g) => groups.has(g))) {
      cand = { code: item.code, description: item.description, confidence: "MEDIA", reason: "Sinónimo conocido (nombre comercial / inglés / INCI): confirmá que sea el mismo material", kind: "sinonimo" };
    } else if (nTokens.size) {
      const have = new Set(wordTokens(iCore));
      let inter = 0;
      for (const t of nTokens) if (have.has(t)) inter++;
      if (inter > 0 && inter / Math.max(nTokens.size, have.size) >= 0.5) cand = { code: item.code, description: item.description, confidence: "BAJA", reason: "Comparte palabras del nombre; función parecida no implica mismo material", kind: "parecido" };
    }
    if (!cand) continue;
    // Un código exacto no se descarta por texto; todo lo demás sí si contradice la especificación.
    if (conflict && cand.kind !== "codigo") {
      discarded.push({ code: item.code, reason: conflict });
      continue;
    }
    put(cand);
  }
  const list = [...out.values()].sort((a, b) => order[a.confidence] - order[b.confidence] || a.code.localeCompare(b.code)).slice(0, limit);
  return { candidates: list, discarded };
}

/**
 * Preselección automática SOLO si hay un único candidato ALTA (o ALTA claramente separada). MEDIA/BAJA nunca se aplican solas.
 */
export function pickAutoIdentity(candidates: IdentityCandidate[]): IdentityCandidate | null {
  const alta = candidates.filter((c) => c.confidence === "ALTA");
  return alta.length === 1 ? alta[0]! : null;
}
