/** IDs de UI: `native:<uuid>` o calidad `qc:native:<uuid>`. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseNativeWorkItemId(id: string): string | null {
  let raw = id.trim();
  if (raw.startsWith("qc:")) raw = raw.slice(3);
  if (raw.startsWith("native:")) raw = raw.slice(7);
  if (!UUID_RE.test(raw)) return null;
  return raw;
}

export function toNativeWorkItemId(uuid: string): string {
  return `native:${uuid}`;
}

export function toNativeQualityItemId(uuid: string): string {
  return `qc:native:${uuid}`;
}
