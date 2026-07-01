export type GenusDataMode = "demo" | "real";

/** Client-safe data mode (not a secret). */
export function getClientDataMode(): GenusDataMode {
  const mode = process.env.NEXT_PUBLIC_GENUS_DATA_MODE ?? "demo";
  return mode === "real" ? "real" : "demo";
}

/** Server-side data mode. Falls back to client env for local dev parity. */
export function getServerDataMode(): GenusDataMode {
  const mode =
    process.env.GENUS_DATA_MODE ??
    process.env.NEXT_PUBLIC_GENUS_DATA_MODE ??
    "demo";
  return mode === "real" ? "real" : "demo";
}

export function shouldFallbackToDemo(): boolean {
  const value = process.env.GENUS_FALLBACK_TO_DEMO ?? "true";
  return value !== "false";
}
