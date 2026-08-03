/**
 * Sanitización y normalización de texto para la memoria de Creamy.
 * Módulo puro (sin server-only) para poder usarse en tools y tests.
 */

const TEST_PREFIX_RE = /^(test_|__test__)/i;
const FIXTURE_MOCK_RE = /\bfixtur\w*\b|\bmock\w*\b/i;

/** Detecta valores tipo TEST_* / fixtures / mocks que no deben persistirse ni mostrarse. */
export function isTestLikeValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return TEST_PREFIX_RE.test(trimmed) || FIXTURE_MOCK_RE.test(trimmed);
}

/** Quita tokens tipo TEST_, fixture o mock de un texto libre, preservando el resto. */
export function stripTestEntities(text: string): string {
  if (!text) return text;
  return text
    .split(/(\s+)/)
    .filter((token) => !isTestLikeValue(token))
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Colapsa espacios, minúsculas y quita acentos (fold liviano) para deduplicar por clave. */
export function normalizeMemoryKey(content: string): string {
  return content
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/** Nombres de tools internas de Creamy — nunca deben filtrarse en una respuesta al usuario. */
export const CREAMY_INTERNAL_TOOL_NAMES = [
  "searchWorkItems",
  "getOverdueWork",
  "getWorkBySector",
  "searchLots",
  "getExpiringLots",
  "searchRawMaterials",
  "checkRawMaterialAvailability",
  "searchOrders",
  "getPendingQualityDecisions",
  "searchDeliveries",
  "getPendingDeliveries",
  "getLateDeliveries",
  "getDeliveriesByCustomer",
  "getDeliveriesByDateRange",
  "getApplicationHelp",
  "getElaborationWork",
  "getElaborationWorkByOperator",
  "getProductFormulaOrBOM",
  "checkProductFormulaAvailability",
  "getPreviousElaborationObservations",
  "searchApprovedSubstitutions",
  "getElaborationOrder",
  "rememberOperationalFact",
  "searchOperationalMemories",
  "searchOrdersForCreamy",
  "getOrderSummaryForCreamy",
] as const;

const FORBIDDEN_LINE_PATTERNS: RegExp[] = [
  /\bTEST_[A-Z0-9_]*/i,
  /proveedor alternativo/i,
  /respuesta generada/i,
  /\bmock(s|ed|ing)?\b/i,
  /\bfixture(s)?\b/i,
  /system prompt/i,
  /\bsourceContext\b/i,
  /\bavailableNav\b/i,
  ...CREAMY_INTERNAL_TOOL_NAMES.map((name) => new RegExp(`\\b${name}\\b`)),
];

const NAV_ACTIONS_LINE_RE = /^\s*NAV_ACTIONS:/i;

/**
 * Limpia líneas con datos de prueba, notas de proveedor/fallback, nombres de
 * tools internas o referencias al system prompt antes de mostrar una
 * respuesta de Creamy. La línea `NAV_ACTIONS:` se preserva siempre — el
 * cliente la parsea por separado (ver stripNavActionsLine en creamy-chat.tsx).
 */
export function sanitizeCreamyReply(text: string): string {
  if (!text) return text;
  let cleaned = text
    .replace(/_\([^)]*proveedor[^)]*\)_/gi, "")
    .replace(/_\([^)]*respuesta generada[^)]*\)_/gi, "")
    .replace(/\(Respuesta generada con proveedor alternativo\.\)/gi, "")
    .replace(/Respuesta generada con proveedor alternativo\.?/gi, "");

  const lines = cleaned.split("\n");
  const kept = lines.filter((line) => {
    if (NAV_ACTIONS_LINE_RE.test(line)) return true;
    return !FORBIDDEN_LINE_PATTERNS.some((pattern) => pattern.test(line));
  });
  cleaned = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Soft trim to ~100 words without cutting NAV_ACTIONS
  const navMatch = cleaned.match(/\n?NAV_ACTIONS:\s*.+$/im);
  const nav = navMatch?.[0] ?? "";
  const body = nav ? cleaned.replace(nav, "").trim() : cleaned;
  const words = body.split(/\s+/).filter(Boolean);
  const trimmedBody = words.length > 110 ? `${words.slice(0, 100).join(" ")}…` : body;
  return `${trimmedBody}${nav ? `\n${nav.trim()}` : ""}`.trim();
}
