export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokenizeQuery(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

/** All query tokens must appear somewhere in the combined searchable text. */
export function matchesConsultaQuery(
  searchableFields: Array<string | undefined>,
  query: string
): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return false;

  const haystack = normalizeSearchText(
    searchableFields.filter(Boolean).join(" ")
  );

  return tokens.every((token) => haystack.includes(token));
}
