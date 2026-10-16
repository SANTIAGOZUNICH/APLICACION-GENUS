/**
 * Reglas PURAS para encontrar la fórmula de un trabajo en el índice de la carpeta nueva de Drive
 * (carpetas de clientes → archivos .xlsx/.xls/Google Sheets). Sin E/S: se prueban con datos descartables.
 *
 * Orden de búsqueda:
 *  1. CLIENTE: la carpeta cuyo nombre coincide con el cliente del trabajo, admitiendo tildes, mayúsculas, guiones,
 *     signos y sufijos societarios (S.A., S.R.L., S.A.S.). Si no hay una coincidencia así, solo se SUGIEREN carpetas
 *     parecidas (abreviaturas, iniciales, palabras en común): nunca se elige una sola.
 *  2. PRODUCTO dentro de la(s) carpeta(s) del cliente:
 *     - código exacto (p. ej. «AB-123») cuando el trabajo y el archivo lo tienen;
 *     - mismo nombre normalizado (sin cliente, prefijos «OE», «Copia de», versiones, fechas ni «(1)»);
 *     - mismas palabras en otro orden;
 *     - parecidos (palabras incluidas, errores de tipeo): solo como OPCIÓN para que Producción elija.
 *  3. Se usa un archivo automáticamente SOLO si es el único con coincidencia fuerte y no parece de otro cliente.
 *     Copias, versiones o archivos repetidos con el mismo producto → «ambiguo»: Producción elige y vincula.
 */
import { deriveProductFromFilename, looksLikeCopyName, normalizeSearchKey } from "./types";

export type DriveIndexFlag =
  | "copia"
  | "version"
  | "subcarpeta"
  | "carpeta_antigua"
  | "otro_cliente"
  | "duplicado";

export type DriveIndexFile = {
  fileId: string;
  clientFolderId: string;
  clientFolderName: string;
  subPath: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string | null;
  productLabel: string;
  productKey: string;
  productCode: string | null;
  flags: DriveIndexFlag[];
  /** Nombre de la otra carpeta de cliente que aparece en el nombre del archivo (flag «otro_cliente»). */
  otherClient?: string | null;
};

export type MatchReason = "codigo" | "nombre_exacto" | "nombre_compacto" | "mismas_palabras" | "contiene" | "parecido";

export type DriveCandidate = DriveIndexFile & { score: number; reason: MatchReason };

export type DriveMatchDecision =
  | { kind: "one"; file: DriveCandidate; candidates: DriveCandidate[]; clientFolders: string[] }
  | { kind: "ambiguous"; candidates: DriveCandidate[]; clientFolders: string[]; message: string }
  | { kind: "none"; candidates: DriveCandidate[]; clientFolders: string[]; clientSuggestions: string[]; message: string };

/** Puntaje mínimo para usar un archivo sin que Producción lo elija (y tiene que ser el único). */
export const AUTO_SCORE = 860;

const LEGAL_SUFFIX = /\s(s\s?a\s?s|s\s?r\s?l|s\s?a|sociedad anonima|ltda|inc|llc|s\s?a\s?u)$/;
const STOP = new Set(["de", "del", "la", "el", "los", "las", "con", "y", "para", "al", "x", "en", "a", "e"]);
const VERSION_WORDS = /\b(final|nueva|nuevo|vieja|viejo|old|new|anterior|actualizada|actualizado|corregida|corregido|ultima|ultimo|definitiva|borrador)\b/g;
const VERSION_NUM = /\b(v|ver|version|rev|revision)\s?\d{1,3}\b/g;
const DATE_LIKE = /\b\d{1,2}\s\d{1,2}\s\d{2,4}\b|\b(20[1-3]\d)\b/g;
const OLD_FOLDER = /(viej|anterior|old|historial|backup|obsolet|archiv|no usar|descart)/;

/** Normalización base: tildes, mayúsculas, guiones, puntos, barras y signos → espacios. */
export function canon(value: string): string {
  return normalizeSearchKey(value.replace(/&/g, " y ").replace(/\+/g, " "))
    .replace(/[()[\]{},'"´`*#°º!?¿¡|<>=~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clave de cliente: sin sufijos societarios. */
export function clientKey(name: string): string {
  let c = canon(name);
  for (let i = 0; i < 2; i++) c = c.replace(LEGAL_SUFFIX, "").trim();
  return c;
}

const compact = (s: string) => s.replace(/\s+/g, "");
const tokens = (s: string) => s.split(" ").filter(Boolean);
const tokenSet = (s: string) => [...new Set(tokens(s).filter((t) => !STOP.has(t)))].sort();

/** Quita una secuencia de palabras (p. ej. el cliente) de una clave. */
function removePhrase(key: string, phrase: string): string {
  const p = tokens(phrase);
  if (!p.length) return key;
  const t = tokens(key);
  const out: string[] = [];
  for (let i = 0; i < t.length; ) {
    if (p.every((w, k) => t[i + k] === w)) {
      i += p.length;
      continue;
    }
    out.push(t[i]!);
    i++;
  }
  return out.join(" ");
}

const hasPhrase = (key: string, phrase: string) => {
  const p = tokens(phrase);
  const t = tokens(key);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= t.length; i++) if (p.every((w, k) => t[i + k] === w)) return true;
  return false;
};

/** Código de producto (letras + números, p. ej. «AB-123», «CR 045»). Null si no hay uno claro. */
export function extractProductCode(raw: string): string | null {
  const name = raw.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, "");
  const m = [...name.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z]{1,4})[\s\-_.]?(\d{2,6})(?=$|[^A-Za-z0-9%])/g)];
  const codes = m
    .map((x) => `${x[1]!.toLowerCase()}${x[2]}`)
    // «V2», «REV 03», años y medidas no son códigos de producto.
    .filter((c) => !/^(v|ver|rev|version)\d+$/.test(c) && !/^(ml|gr|g|kg|cc|lt|l)\d+$/.test(c));
  return codes.length === 1 ? codes[0]! : null;
}

/** Clave de producto: sin extensión, prefijos de plantilla, cliente, copias, versiones ni fechas. */
export function productKeyOf(label: string, clientName?: string, alsoRemove: string[] = []): string {
  let base = label.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, "");
  base = base.replace(/\(\s*\d+\s*\)/g, " ");
  let k = canon(base);
  k = k.replace(/^(copia de|copy of)\s+/, "").replace(/\s(copia|copy)(\s\d+)?$/, "");
  k = k.replace(/^(o\s?e|orden de elaboracion|formula|formulacion)\s+/, "");
  k = k.replace(VERSION_NUM, " ").replace(VERSION_WORDS, " ").replace(DATE_LIKE, " ");
  if (clientName) k = removePhrase(k, clientKey(clientName));
  for (const other of alsoRemove) if (other) k = removePhrase(k, clientKey(other));
  return k.replace(/\s+/g, " ").trim();
}

/** Etiqueta legible del producto desde el nombre del archivo (reutiliza la regla existente). */
export function productLabelOf(fileName: string, clientName: string): string {
  return deriveProductFromFilename(fileName, clientName) || fileName.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, "");
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]!);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length]!;
}

/** Marcas de un archivo del índice (se calculan al indexar, con todas las carpetas de clientes a la vista). */
export function computeFlags(
  file: { fileName: string; subPath: string; clientFolderName: string },
  otherClientNames: string[]
): { flags: DriveIndexFlag[]; otherClient: string | null } {
  const flags: DriveIndexFlag[] = [];
  const n = canon(file.fileName.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, ""));
  if (looksLikeCopyName(file.fileName) || /\b(copia|copy)\b/.test(n)) flags.push("copia");
  if ((n.match(VERSION_NUM) ?? []).length || (n.match(VERSION_WORDS) ?? []).length || (n.match(DATE_LIKE) ?? []).length) flags.push("version");
  if (file.subPath.trim()) {
    flags.push("subcarpeta");
    if (OLD_FOLDER.test(canon(file.subPath))) flags.push("carpeta_antigua");
  }
  const own = clientKey(file.clientFolderName);
  let otherClient: string | null = null;
  if (!hasPhrase(n, own)) {
    for (const other of otherClientNames) {
      const ok = clientKey(other);
      if (!ok || ok === own || compact(ok).length < 4) continue;
      if (hasPhrase(n, ok)) {
        otherClient = other;
        break;
      }
    }
  }
  if (otherClient) flags.push("otro_cliente");
  return { flags, otherClient };
}

/** Archivos con el mismo producto dentro de la misma carpeta de cliente → «duplicado». */
export function markDuplicates<T extends { clientFolderId: string; productKey: string; flags: DriveIndexFlag[] }>(files: T[]): T[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const k = `${f.clientFolderId}|${f.productKey}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return files.map((f) =>
    (counts.get(`${f.clientFolderId}|${f.productKey}`) ?? 0) > 1 && !f.flags.includes("duplicado")
      ? { ...f, flags: [...f.flags, "duplicado" as const] }
      : f
  );
}

/**
 * Regla de texto de la búsqueda MANUAL (selector de fórmulas de Órdenes de Elaboración): empieza con / alguna palabra
 * empieza con / contiene / todas las palabras. La búsqueda automática usa la MISMA regla para encontrar carpetas.
 */
export type TextRank = "exact_prefix" | "word_prefix" | "contains" | "fuzzy";
export function rankText(queryNorm: string, candidateNorm: string): TextRank | null {
  if (!queryNorm || !candidateNorm) return null;
  if (candidateNorm.startsWith(queryNorm)) return "exact_prefix";
  const words = candidateNorm.split(" ").filter(Boolean);
  if (words.some((w) => w.startsWith(queryNorm))) return "word_prefix";
  if (candidateNorm.includes(queryNorm)) return "contains";
  const qTokens = queryNorm.split(" ").filter((t) => t.length >= 2);
  if (qTokens.length && qTokens.every((t) => candidateNorm.includes(t))) return "fuzzy";
  return null;
}

export type ClientFolderMatch = {
  /** Carpeta(s) del cliente, seguras para usar sin intervención. */
  exact: Array<{ id: string; name: string }>;
  /** Cómo se identificó: vínculo guardado por Producción, mismo nombre o nombre que contiene al cliente como palabra. */
  how: "vinculo" | "nombre" | "contiene" | null;
  /** Carpetas parecidas (regla de la búsqueda manual): solo para mostrar opciones, nunca se usan solas. */
  suggestions: Array<{ id: string; name: string }>;
};

/**
 * Carpeta(s) de cliente para el cliente del trabajo. Orden:
 *  1. las carpetas de los archivos que Producción ya vinculó para ese cliente (vínculo validado);
 *  2. mismo nombre normalizado (tildes, mayúsculas, guiones, puntos, «S.A.»…; «T.R.C.» = «TRC»);
 *  3. una ÚNICA carpeta cuyo nombre contiene al cliente como palabra(s) completa(s) («TRC» → «TRC HAIR CARE»,
 *     «LABORATORIO TRC»), o al revés. Si hay varias, ninguna es segura.
 * El resto de lo que encuentra la búsqueda manual (empieza con, contiene, iniciales) son solo sugerencias.
 */
export function matchClientFolders(
  client: string,
  folders: Array<{ id: string; name: string }>,
  learnedFolderIds: ReadonlyArray<string> = []
): ClientFolderMatch {
  const ck = clientKey(client);
  if (!ck) return { exact: [], how: null, suggestions: [] };
  const learned = folders.filter((f) => learnedFolderIds.includes(f.id));
  if (learned.length) return { exact: learned, how: "vinculo", suggestions: [] };
  const same = folders.filter((f) => {
    const fk = clientKey(f.name);
    return fk === ck || compact(fk) === compact(ck);
  });
  if (same.length) return { exact: same, how: "nombre", suggestions: [] };

  const ckc = compact(ck);
  const asWords = folders.filter((f) => {
    const fk = clientKey(f.name);
    // Palabra completa en cualquiera de los dos sentidos; también «T.R.C.» (letras sueltas) contra «TRC».
    return hasPhrase(fk, ck) || hasPhrase(ck, fk) || hasCompactWords(fk, ckc) || hasCompactWords(ck, compact(fk));
  });
  if (asWords.length === 1) return { exact: asWords, how: "contiene", suggestions: [] };

  const initials = (s: string) => tokens(s).map((t) => t[0]).join("");
  const ct = new Set(tokenSet(ck));
  const suggestions = folders.filter((f) => {
    if (asWords.includes(f)) return true;
    const fk = clientKey(f.name);
    if (rankText(ck, fk) || rankText(fk, ck)) return true; // misma regla que la búsqueda manual
    const a = compact(fk);
    if (a.length >= 3 && ckc.length >= 3 && (a.startsWith(ckc) || ckc.startsWith(a))) return true;
    if (ckc.length >= 2 && ckc === initials(fk)) return true;
    if (a.length >= 2 && a === initials(ck)) return true;
    const ft = tokenSet(fk);
    const common = ft.filter((t) => ct.has(t) && t.length >= 3).length;
    return common > 0 && common / Math.max(ft.length, ct.size) >= 0.5;
  });
  return { exact: [], how: null, suggestions };
}

/** ¿Alguna secuencia contigua de palabras de `key`, pegada, es exactamente `target`? («t r c» contiene «trc»). */
function hasCompactWords(key: string, target: string): boolean {
  if (!target) return false;
  const t = tokens(key);
  for (let i = 0; i < t.length; i++) {
    let acc = "";
    for (let j = i; j < t.length && acc.length < target.length; j++) {
      acc += t[j];
      if (acc === target && j > i) return true;
    }
  }
  return false;
}

/** Puntaje de un archivo para el producto del trabajo (0 = no corresponde). */
export function scoreProduct(product: string, client: string, file: DriveIndexFile): { score: number; reason: MatchReason } | null {
  // El nombre del cliente (como figura en el trabajo o en la carpeta) no es parte del producto.
  const strip = (k: string) => [clientKey(client), clientKey(file.clientFolderName)].reduce((acc, ph) => removePhrase(acc, ph), k).replace(/\s+/g, " ").trim();
  const stripCompact = (k: string) => {
    let out = strip(k);
    for (const c of [compact(clientKey(client)), compact(clientKey(file.clientFolderName))]) {
      if (c.length >= 2) out = tokens(out).filter((w) => w !== c).join(" ");
    }
    return out;
  };
  const wk = stripCompact(productKeyOf(product, client));
  const fk = stripCompact(file.productKey || productKeyOf(file.productLabel, file.clientFolderName));
  if (!wk || !fk) return null;
  const wCode = extractProductCode(product);
  const fCode = file.productCode;
  const ws = tokenSet(wk);
  const fs = tokenSet(fk);
  const common = ws.filter((t) => fs.includes(t)).length;
  const jaccard = common / new Set([...ws, ...fs]).size;

  let score = 0;
  let reason: MatchReason = "parecido";
  if (wk === fk) {
    score = 900;
    reason = "nombre_exacto";
  } else if (compact(wk) === compact(fk)) {
    score = 880;
    reason = "nombre_compacto";
  } else if (ws.length && ws.join(" ") === fs.join(" ")) {
    score = 860;
    reason = "mismas_palabras";
  } else if (ws.length && common === ws.length) {
    score = 600 + Math.round(jaccard * 100);
    reason = "contiene";
  } else if (compact(wk).length >= 6 && levenshtein(compact(wk), compact(fk), 2) <= 2) {
    score = 700;
    reason = "parecido";
  } else if (jaccard >= 0.5) {
    score = 400 + Math.round(jaccard * 100);
    reason = "parecido";
  }

  if (wCode && fCode) {
    if (wCode === fCode) {
      // El código exacto manda, siempre que el nombre no contradiga (alguna palabra en común).
      if (score >= 860) score += 150;
      else if (jaccard >= 0.3 || score > 0) {
        score = 950;
        reason = "codigo";
      }
    } else if (score > 0) {
      // Códigos distintos: nunca se usa solo (puede ser otra presentación o variante).
      score = Math.min(score, 500);
    }
  }
  return score > 0 ? { score, reason } : null;
}

/** Decide qué archivo corresponde al trabajo. Nunca elige entre varios parecidos. */
export function decideDriveFormula(
  client: string,
  product: string,
  files: DriveIndexFile[],
  opts: { learnedFolderIds?: ReadonlyArray<string> } = {}
): DriveMatchDecision {
  const folders = [...new Map(files.map((f) => [f.clientFolderId, { id: f.clientFolderId, name: f.clientFolderName }])).values()];
  const { exact, suggestions } = matchClientFolders(client, folders, opts.learnedFolderIds ?? []);
  const scopeIds = new Set((exact.length ? exact : suggestions).map((f) => f.id));
  const scored: DriveCandidate[] = [];
  for (const f of files) {
    if (!scopeIds.has(f.clientFolderId)) continue;
    const s = scoreProduct(product, client, f);
    if (s) scored.push({ ...f, ...s });
  }
  scored.sort((a, b) => b.score - a.score || (Date.parse(b.modifiedTime ?? "") || 0) - (Date.parse(a.modifiedTime ?? "") || 0));
  const candidates = scored.slice(0, 12);
  const clientFolders = (exact.length ? exact : suggestions).map((f) => f.name);

  if (!exact.length) {
    return {
      kind: "none",
      candidates,
      clientFolders: [],
      clientSuggestions: suggestions.map((s) => s.name),
      message: suggestions.length
        ? `No hay una carpeta de cliente «${client}» en Drive. Carpetas parecidas: ${suggestions.map((s) => `«${s.name}»`).join(", ")}. Elegí el archivo correcto y vinculalo.`
        : `No hay una carpeta de cliente «${client}» en la carpeta de fórmulas de Drive.`,
    };
  }
  const strong = candidates.filter((c) => c.score >= AUTO_SCORE);
  if (strong.length === 1 && !strong[0]!.flags.includes("otro_cliente")) {
    return { kind: "one", file: strong[0]!, candidates, clientFolders };
  }
  if (strong.length > 1) {
    return {
      kind: "ambiguous",
      candidates,
      clientFolders,
      message: `Hay ${strong.length} archivos que coinciden con «${product}» en ${clientFolders.map((c) => `«${c}»`).join(", ")} (copias, versiones o repetidos): elegí cuál es la fórmula correcta y vinculala.`,
    };
  }
  if (strong.length === 1) {
    return {
      kind: "ambiguous",
      candidates,
      clientFolders,
      message: `El archivo «${strong[0]!.fileName}» parece ser de otro cliente («${strong[0]!.otherClient ?? "?"}»): confirmá si es la fórmula correcta antes de vincularla.`,
    };
  }
  return {
    kind: "none",
    candidates,
    clientFolders,
    clientSuggestions: [],
    message: candidates.length
      ? `No hay un archivo que coincida exactamente con «${product}» en ${clientFolders.map((c) => `«${c}»`).join(", ")}. Hay opciones parecidas: elegí la correcta y vinculala.`
      : `No se encontró la fórmula de «${product}» en la carpeta de ${clientFolders.map((c) => `«${c}»`).join(", ")} de Drive.`,
  };
}
