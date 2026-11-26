/**
 * DEPÓSITO › UBICACIONES — reglas PURAS (sin base ni red). El servidor y la pantalla usan las mismas: permisos por sector, normalización y búsqueda
 * (cliente / material / código), estados e indicadores, validación de cantidades, aritmética de traslado (parcial o completo, en milésimas: sin
 * errores de punto flotante), tope por stock disponible y validación de la geometría del mapa.
 */
import { boxClientKey } from "@/lib/cajas-genus/rules";
import { OPERATIONAL_SECTOR_IDS, type SectorId } from "@/types/operational/sector";

// ───────────────────────── Permisos ─────────────────────────

/** Consultan el mapa (solo lectura): TODOS los sectores operativos (la lista sale de OPERATIONAL_SECTOR_IDS, no de una lista fija). */
export const UBICACIONES_READ_SECTORS: readonly SectorId[] = OPERATIONAL_SECTOR_IDS;
/** Asignan, mueven y liberan contenido. */
export const UBICACIONES_WRITE_SECTORS = ["DEPOSITO"] as const satisfies readonly SectorId[];
/** Configuran el mapa (posiciones, geometría, forma del plano). */
export const UBICACIONES_CONFIG_SECTORS = ["DEPOSITO", "DIRECCION"] as const satisfies readonly SectorId[];

const has = (list: readonly string[], s: string | null | undefined) => Boolean(s && list.includes(s));
export const canReadUbicaciones = (s: string | null | undefined) => has(UBICACIONES_READ_SECTORS, s);
export const canWriteUbicaciones = (s: string | null | undefined) => has(UBICACIONES_WRITE_SECTORS, s);
export const canConfigUbicaciones = (s: string | null | undefined) => has(UBICACIONES_CONFIG_SECTORS, s);

export const MAX_LINES = 50;
export const MAX_QUANTITY = 99_999_999;
export const MAX_TEXT = 160;
export const MAX_OBSERVATIONS = 1000;

// ───────────────────────── Texto, clientes y claves ─────────────────────────

/** Minúsculas, sin acentos, espacios colapsados. Base de toda comparación. */
export function normalizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Código de material ME normalizado como en el inventario (trim + espacios colapsados + mayúsculas). */
export function normalizeMaterialCode(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().toUpperCase() : "";
}

/** Clave del cliente: la MISMA que usan Cajas Genus y Entregas («B.L. Cosmetics S.A.» = «BL COSMETICS»; «TRC» ≠ «TRC Cosmetics»). */
export function clientKeyOf(name: unknown): string | null {
  return boxClientKey(name);
}

/** Clave del material dentro de una posición: vinculado a ME = su código; libre = su texto normalizado. */
export function materialKeyOf(m: { codigo?: string | null; name: string }): string {
  const code = normalizeMaterialCode(m.codigo);
  return code ? `me:${code}` : `t:${normalizeText(m.name)}`;
}

export const cleanLabel = (raw: unknown): string => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "");

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

// ───────────────────────── Cantidades (milésimas) ─────────────────────────

export const toMilli = (n: number): number => Math.round(n * 1000);
export const fromMilli = (m: number): number => m / 1000;

/** Cantidad > 0 con hasta 3 decimales. `null`/vacío = sin cantidad (solo si `allowNull`). Acepta «2.000», «2000,5». */
export function parseQuantity(raw: unknown, opts: { allowNull?: boolean } = {}): Validation<number | null> {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return opts.allowNull ? { ok: true, value: null } : { ok: false, message: "Indicá la cantidad." };
  }
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") {
    const t = raw.trim();
    // «2.000» (miles) y «2.000,5» (decimal con coma) como en es-AR; «2000.5» con un solo punto y ≠ 3 decimales se toma como decimal.
    const normalized = /,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
    n = /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
  } else n = Number.NaN;
  if (!Number.isFinite(n)) return { ok: false, message: "La cantidad tiene que ser un número." };
  if (n <= 0) return { ok: false, message: "La cantidad tiene que ser mayor a cero." };
  if (n > MAX_QUANTITY) return { ok: false, message: `La cantidad no puede superar ${MAX_QUANTITY.toLocaleString("es-AR")}.` };
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) return { ok: false, message: "La cantidad admite hasta 3 decimales." };
  return { ok: true, value: fromMilli(toMilli(n)) };
}

export const fmtQty = (n: number | null | undefined, unit = ""): string => (n == null ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`);

// ───────────────────────── Modelo ─────────────────────────

export type UbicacionItem = {
  id: string;
  clientKey: string;
  clientName: string;
  materialKey: string;
  material: string;
  codigo: string | null;
  meMaterialId: string | null;
  unit: string;
  quantity: number | null;
  /** VERIFICADO ⇔ vinculado a un material ME (id): su cantidad se valida contra el stock. Si no, SIN VERIFICAR (texto libre). */
  verified: boolean;
};

/** Cliente asignado DIRECTAMENTE a una posición (sin materiales). */
export type AssignedClient = { id: string; clientKey: string; clientName: string; assignedAt: string; assignedBy: string | null };
/** Cliente de una posición: asignado ∪ el de sus materiales. Los que vienen de materiales NO se pueden quitar a mano. */
export type LocationClient = { clientKey: string; clientName: string; assigned: boolean; hasMaterials: boolean; removable: boolean };

type Occupiable = { items: readonly unknown[]; assignedClients?: readonly unknown[] };
/** OCUPADA ⇔ tiene materiales o al menos un cliente asignado. */
export const isOccupied = (l: Occupiable): boolean => l.items.length > 0 || (l.assignedClients?.length ?? 0) > 0;

export type UbicacionLike = { id: string; code: string; zone: string; active: boolean; items: ReadonlyArray<Pick<UbicacionItem, "clientKey" | "clientName" | "material" | "codigo">>; assignedClients?: ReadonlyArray<Pick<AssignedClient, "clientKey" | "clientName">> };

export type LocationStatus = "LIBRE" | "OCUPADA";
export const locationStatus = (l: Occupiable): LocationStatus => (isOccupied(l) ? "OCUPADA" : "LIBRE");

/** Lista de clientes de la posición = asignados ∪ clientes de sus materiales (por clave normalizada). Un cliente con materiales no es removible. */
export function locationClients(l: { items: ReadonlyArray<{ clientKey: string; clientName: string }>; assignedClients?: ReadonlyArray<{ clientKey: string; clientName: string }> }): LocationClient[] {
  const map = new Map<string, LocationClient>();
  for (const a of l.assignedClients ?? []) if (!map.has(a.clientKey)) map.set(a.clientKey, { clientKey: a.clientKey, clientName: a.clientName, assigned: true, hasMaterials: false, removable: true });
  for (const i of l.items) {
    const cur = map.get(i.clientKey);
    if (cur) {
      cur.hasMaterials = true;
      cur.removable = false;
    } else map.set(i.clientKey, { clientKey: i.clientKey, clientName: i.clientName, assigned: false, hasMaterials: true, removable: false });
  }
  return [...map.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
}

/** ¿Se puede quitar este cliente asignado? No si todavía tiene materiales almacenados en la posición. */
export function canRemoveAssignedClient(l: { items: ReadonlyArray<{ clientKey: string }> }, clientKey: string): Validation<true> {
  if (l.items.some((i) => i.clientKey === clientKey)) return { ok: false, message: "Este cliente todavía tiene materiales almacenados en la ubicación: retiralos primero para poder quitarlo." };
  return { ok: true, value: true };
}

/** Valida el nombre de un cliente a asignar: devuelve nombre limpio + clave compartida. */
export function parseClientName(raw: unknown): Validation<{ clientName: string; clientKey: string }> {
  const clientName = cleanLabel(raw);
  const clientKey = clientKeyOf(clientName);
  if (!clientName || !clientKey) return { ok: false, message: "Indicá el nombre del cliente (por ejemplo TRC)." };
  if (clientName.length > MAX_TEXT) return { ok: false, message: "El nombre del cliente es demasiado largo." };
  return { ok: true, value: { clientName, clientKey } };
}

/** Totales sobre posiciones ACTIVAS (las desactivadas no cuentan). Ocupada = con materiales o con cliente asignado. */
export function computeIndicators(locations: ReadonlyArray<{ active: boolean } & Occupiable>): { total: number; ocupadas: number; libres: number } {
  const active = locations.filter((l) => l.active);
  const ocupadas = active.filter(isOccupied).length;
  return { total: active.length, ocupadas, libres: active.length - ocupadas };
}

/** Texto corto de cliente(s) para la celda del mapa: «TRC», «TRC +1». */
export function clientsLabel(items: ReadonlyArray<{ clientKey: string; clientName: string }>): string {
  const seen = new Map<string, string>();
  for (const i of items) if (!seen.has(i.clientKey)) seen.set(i.clientKey, i.clientName);
  const names = [...seen.values()];
  if (!names.length) return "";
  return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`;
}
export const distinctClients = (items: ReadonlyArray<{ clientKey: string; clientName: string }>): string[] => {
  const seen = new Map<string, string>();
  for (const i of items) if (!seen.has(i.clientKey)) seen.set(i.clientKey, i.clientName);
  return [...seen.values()];
};

// ───────────────────────── Búsqueda ─────────────────────────

const squeezeCode = (s: string) => s.replace(/[^a-z0-9]/g, "").replace(/([a-z])0+(\d)/g, "$1$2");

/**
 * ¿La posición coincide con la búsqueda? Por código («a2» = A02), cliente (por nombre o por clave normalizada) o material (nombre / código ME).
 * Consulta vacía → nada coincide.
 */
export function locationMatches(l: UbicacionLike, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return false;
  const qCode = squeezeCode(q);
  if (qCode && squeezeCode(normalizeText(l.code)).includes(qCode) && /\d|^[a-z]$/.test(q)) return true;
  if (normalizeText(l.code).includes(q)) return true;
  const qKey = boxClientKey(query);
  for (const c of l.assignedClients ?? []) {
    if (normalizeText(c.clientName).includes(q)) return true;
    if (qKey && qKey.length >= 2 && boxClientKey(c.clientName) === qKey) return true;
  }
  for (const i of l.items) {
    if (normalizeText(i.clientName).includes(q)) return true;
    if (qKey && qKey.length >= 2 && boxClientKey(i.clientName) === qKey) return true;
    if (normalizeText(i.material).includes(q)) return true;
    if (i.codigo && normalizeText(i.codigo).includes(q)) return true;
  }
  return false;
}

export function searchLocations<T extends UbicacionLike>(locations: readonly T[], query: string): T[] {
  return locations.filter((l) => l.active && locationMatches(l, query));
}

// ───────────────────────── Estado visual ─────────────────────────

export type CellState = "LIBRE" | "OCUPADA" | "SELECCIONADA" | "RESULTADO" | "INACTIVA";
/** Prioridad: seleccionada > resultado de búsqueda > ocupada/libre. */
export function cellState(l: { active: boolean } & Occupiable, o: { selected: boolean; match: boolean }): CellState {
  if (!l.active) return "INACTIVA";
  if (o.selected) return "SELECCIONADA";
  if (o.match) return "RESULTADO";
  return isOccupied(l) ? "OCUPADA" : "LIBRE";
}

/** «A01 – A11» por zona, en el orden del mapa (para la lista «Sectores y posiciones»). */
export function groupZones<T extends { code: string; zone: string; active: boolean; sortOrder: number }>(locations: readonly T[]): Array<{ zone: string; from: string; to: string; count: number; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const l of [...locations].filter((x) => x.active).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))) {
    const key = l.zone || "Sin zona";
    map.set(key, [...(map.get(key) ?? []), l]);
  }
  return [...map.entries()].map(([zone, items]) => ({ zone, from: items[0]!.code, to: items[items.length - 1]!.code, count: items.length, items }));
}

// ───────────────────────── Líneas de contenido ─────────────────────────

export type LineInput = { clientName: string; material: string; quantity: number | null; unit: string; codigo: string | null; meMaterialId: string | null; /** Renglón LIBRE existente al que se suma (elección explícita; nunca por coincidencia de texto). */ mergeIntoItemId: string | null };

/** Valida una línea del pedido (alta/agregado). El cliente se normaliza con la clave compartida; el material libre solo exige texto. */
export function parseLineInput(raw: unknown): Validation<LineInput & { clientKey: string; materialKey: string }> {
  if (!raw || typeof raw !== "object") return { ok: false, message: "Línea inválida." };
  const r = raw as Record<string, unknown>;
  const clientName = cleanLabel(r.clientName);
  const clientKey = clientKeyOf(clientName);
  if (!clientName || !clientKey) return { ok: false, message: "Indicá el cliente (por ejemplo TRC)." };
  if (clientName.length > MAX_TEXT) return { ok: false, message: "El nombre del cliente es demasiado largo." };
  const material = cleanLabel(r.material);
  if (!material) return { ok: false, message: "Indicá el material." };
  if (material.length > MAX_TEXT) return { ok: false, message: "El nombre del material es demasiado largo." };
  const q = parseQuantity(r.quantity, { allowNull: true });
  if (!q.ok) return q;
  const meMaterialId = typeof r.meMaterialId === "string" && r.meMaterialId.trim() ? r.meMaterialId.trim() : null;
  // Un código sin vínculo (id) no respalda nada: el renglón queda libre / sin verificar.
  const codigo = meMaterialId ? normalizeMaterialCode(r.codigo) || null : null;
  if (meMaterialId && !codigo) return { ok: false, message: "El material vinculado necesita su código." };
  const mergeIntoItemId = typeof r.mergeIntoItemId === "string" && r.mergeIntoItemId.trim() ? r.mergeIntoItemId.trim() : null;
  if (mergeIntoItemId && meMaterialId) return { ok: false, message: "Un material del inventario se suma por su identidad, no eligiendo un renglón." };
  if (meMaterialId && q.value == null) return { ok: false, message: "Un material vinculado al inventario necesita cantidad." };
  const unit = cleanLabel(r.unit).slice(0, 20) || "u";
  return { ok: true, value: { clientName, clientKey, material, quantity: q.value, unit, codigo, meMaterialId, mergeIntoItemId, materialKey: materialKeyOf({ codigo, name: material }) } };
}

// ───────────────────────── Verificadas vs sin verificar ─────────────────────────

export const isVerified = (i: { meMaterialId?: string | null; verified?: boolean }): boolean => (i.verified !== undefined ? i.verified : Boolean(i.meMaterialId));

export type Subtotal = { rows: number; byUnit: Record<string, number> };
/** Subtotales SEPARADOS: nunca se suman verificadas con sin verificar. Por unidad (no se mezclan unidades). Los renglones sin cantidad cuentan como renglón. */
export function subtotals(items: ReadonlyArray<{ quantity: number | null; unit: string; verified: boolean }>): { verified: Subtotal; unverified: Subtotal } {
  const acc = { verified: { rows: 0, milli: {} as Record<string, number> }, unverified: { rows: 0, milli: {} as Record<string, number> } };
  for (const i of items) {
    const t = i.verified ? acc.verified : acc.unverified;
    t.rows++;
    if (i.quantity != null) t.milli[i.unit || "u"] = (t.milli[i.unit || "u"] ?? 0) + toMilli(i.quantity);
  }
  const out = (t: { rows: number; milli: Record<string, number> }): Subtotal => ({ rows: t.rows, byUnit: Object.fromEntries(Object.entries(t.milli).map(([u, m]) => [u, fromMilli(m)])) });
  return { verified: out(acc.verified), unverified: out(acc.unverified) };
}
export const fmtSubtotal = (t: Subtotal): string => (Object.entries(t.byUnit).map(([u, n]) => fmtQty(n, u)).join(" + ") || (t.rows ? "sin cantidad" : "0"));

/** Identidad de un renglón: ME ⇒ id del material + cliente; libre ⇒ su lote (o su propio id). Dos renglones con igual texto NO son el mismo. */
export function identityOf(i: { id: string; meMaterialId: string | null; clientKey: string; lotKey?: string | null }): string {
  return i.meMaterialId ? `me:${i.meMaterialId}|${i.clientKey}` : `lot:${i.lotKey ?? i.id}`;
}

/** Renglones LIBRES de la posición con el mismo cliente y un texto parecido (para ofrecer «sumar al existente»; por defecto se crea aparte). */
export function similarFreeItems<T extends { id: string; clientKey: string; material: string; meMaterialId: string | null }>(items: readonly T[], line: { clientName: string; material: string }): T[] {
  const key = clientKeyOf(line.clientName);
  const t = normalizeText(line.material);
  if (!key || t.length < 3) return [];
  return items.filter((i) => !i.meMaterialId && i.clientKey === key && (normalizeText(i.material) === t || normalizeText(i.material).includes(t) || t.includes(normalizeText(i.material))));
}

/** ¿Este renglón coincide con la búsqueda (cliente / material / código)? */
export function itemMatches(i: { clientName: string; material: string; codigo: string | null }, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return false;
  const k = boxClientKey(query);
  return normalizeText(i.clientName).includes(q) || Boolean(k && k.length >= 2 && boxClientKey(i.clientName) === k) || normalizeText(i.material).includes(q) || Boolean(i.codigo && normalizeText(i.codigo).includes(q));
}

/** Diferencia entre el total actual del ingreso y lo ya aplicado al mapa (milésimas). Solo se ajusta la DIFERENCIA, nunca se re-suma el total. */
export function ingresoDelta(total: number, applied: number): { diffMilli: number; kind: "IGUAL" | "AUMENTO" | "BAJA" } {
  const diffMilli = toMilli(total) - toMilli(applied);
  return { diffMilli, kind: diffMilli === 0 ? "IGUAL" : diffMilli > 0 ? "AUMENTO" : "BAJA" };
}

// ───────────────────────── Traslado / retiro ─────────────────────────

export type SourceItem = { id: string; quantity: number | null; material?: string };
export type MoveRequestLine = { itemId: string; quantity: number | null };
export type MovePlan = { itemId: string; /** milésimas movidas; null = el ítem no tenía cantidad */ moveMilli: number | null; /** milésimas que quedan; null = no tenía cantidad */ remainMilli: number | null; whole: boolean };

/**
 * Plan de un traslado o retiro. `quantity: null` = el renglón completo. Con cantidad: > 0, ≤ lo que hay (si es igual, se mueve todo). Un renglón SIN
 * cantidad solo se puede mover completo. Sin renglones repetidos. La suma movida + lo que queda = lo que había (milésimas exactas).
 */
export function planMove(items: readonly SourceItem[], lines: readonly MoveRequestLine[]): Validation<MovePlan[]> {
  if (!lines.length) return { ok: false, message: "Elegí qué materiales mover." };
  if (lines.length > MAX_LINES) return { ok: false, message: `No se pueden mover más de ${MAX_LINES} materiales a la vez.` };
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const plan: MovePlan[] = [];
  for (const l of lines) {
    const src = byId.get(l.itemId);
    if (!src) return { ok: false, message: "Un material ya no está en la ubicación de origen. Actualizá la pantalla." };
    if (seen.has(l.itemId)) return { ok: false, message: "Un material está repetido en el pedido." };
    seen.add(l.itemId);
    if (src.quantity == null) {
      if (l.quantity != null) return { ok: false, message: `«${src.material ?? "El material"}» no tiene cantidad cargada: solo se puede mover completo.` };
      plan.push({ itemId: l.itemId, moveMilli: null, remainMilli: null, whole: true });
      continue;
    }
    const have = toMilli(src.quantity);
    if (l.quantity == null) {
      plan.push({ itemId: l.itemId, moveMilli: have, remainMilli: 0, whole: true });
      continue;
    }
    const q = parseQuantity(l.quantity);
    if (!q.ok) return q;
    const mv = toMilli(q.value as number);
    if (mv > have) return { ok: false, message: `No hay tanta cantidad de «${src.material ?? "el material"}»: hay ${fmtQty(src.quantity)} y querés mover ${fmtQty(fromMilli(mv))}.` };
    plan.push({ itemId: l.itemId, moveMilli: mv, remainMilli: have - mv, whole: mv === have });
  }
  return { ok: true, value: plan };
}

/** Suma al destino lo movido: cantidades en milésimas; sin cantidad + sin cantidad = sin cantidad; sin cantidad + cantidad = la cantidad. */
export function mergeQuantity(existing: number | null, addMilli: number | null): number | null {
  if (addMilli == null) return existing;
  return fromMilli((existing == null ? 0 : toMilli(existing)) + addMilli);
}

// ───────────────────────── Tope por stock disponible ─────────────────────────

/**
 * La suma distribuida entre ubicaciones de un material vinculado a ME no puede superar el stock disponible de ese código. `elsewhere` = lo ya
 * distribuido (todas las posiciones, incluida la de destino); `adding` = lo que se quiere sumar.
 */
export function checkStockCap(input: { available: number; elsewhere: number; adding: number; label: string }): Validation<true> {
  const total = toMilli(input.elsewhere) + toMilli(input.adding);
  if (total <= toMilli(Math.max(0, input.available))) return { ok: true, value: true };
  const free = Math.max(0, toMilli(input.available) - toMilli(input.elsewhere));
  return { ok: false, message: `«${input.label}»: el stock disponible es ${fmtQty(input.available)} y ya hay ${fmtQty(input.elsewhere)} distribuido en ubicaciones. Podés ubicar hasta ${fmtQty(fromMilli(free))} más.` };
}

// ───────────────────────── Configuración del mapa ─────────────────────────

export const MAX_CODE = 12;
/** Código de posición: 1–12 caracteres, letras/números/guion, en mayúsculas. */
export function parseLocationCode(raw: unknown): Validation<string> {
  const c = typeof raw === "string" ? raw.replace(/\s+/g, "").toUpperCase() : "";
  if (!c) return { ok: false, message: "Indicá el código de la ubicación." };
  if (c.length > MAX_CODE) return { ok: false, message: `El código no puede superar ${MAX_CODE} caracteres.` };
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(c)) return { ok: false, message: "El código solo admite letras, números y guiones." };
  return { ok: true, value: c };
}

export type Geometry = { x: number; y: number; w: number; h: number };
export const MIN_SIZE = 8;
/** Rectángulo dentro del lienzo, con tamaño mínimo. */
export function parseGeometry(raw: Partial<Record<keyof Geometry, unknown>>, canvas: { width: number; height: number }): Validation<Geometry> {
  const g = {} as Geometry;
  for (const k of ["x", "y", "w", "h"] as const) {
    const n = typeof raw[k] === "string" ? Number((raw[k] as string).replace(",", ".")) : (raw[k] as number);
    if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, message: `El valor «${k}» tiene que ser un número.` };
    g[k] = Math.round(n * 10) / 10;
  }
  if (g.w < MIN_SIZE || g.h < MIN_SIZE) return { ok: false, message: `El ancho y el alto mínimos son ${MIN_SIZE}.` };
  if (g.x < 0 || g.y < 0 || g.x + g.w > canvas.width || g.y + g.h > canvas.height) return { ok: false, message: `La posición se sale del plano (${canvas.width} × ${canvas.height}).` };
  return { ok: true, value: g };
}

/** Posición de `others` que se superpone con el rectángulo (los bordes que solo se tocan no cuentan). */
export function findOverlap<T extends Geometry & { id: string; code: string; active: boolean }>(rect: Geometry & { id?: string }, others: readonly T[]): T | null {
  const eps = 0.05;
  return others.find((o) => o.active && o.id !== rect.id && rect.x < o.x + o.w - eps && o.x < rect.x + rect.w - eps && rect.y < o.y + o.h - eps && o.y < rect.y + rect.h - eps) ?? null;
}

/** Una posición solo se puede desactivar o renombrar si está vacía: así el historial y el contenido nunca quedan huérfanos. */
export function canRetireOrRename(l: Occupiable): boolean {
  return !isOccupied(l);
}

export const SHAPE_KINDS = ["CONTORNO", "PASILLO", "ESCALERA", "VACIO"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export const SHAPE_KIND_LABEL: Record<ShapeKind, string> = { CONTORNO: "Contorno", PASILLO: "Pasillo / circulación", ESCALERA: "Escalera", VACIO: "Vacío" };

/** Validación del polígono del contorno `[[x,y],…]` (≥ 3 puntos dentro del lienzo). */
export function parsePolygon(raw: unknown, canvas: { width: number; height: number }): Validation<Array<[number, number]>> {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, message: "Los puntos del contorno no son un JSON válido." };
    }
  }
  if (!Array.isArray(data) || data.length < 3 || data.length > 64) return { ok: false, message: "El contorno necesita entre 3 y 64 puntos." };
  const pts: Array<[number, number]> = [];
  for (const p of data) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) return { ok: false, message: "Cada punto del contorno es [x, y]." };
    const [x, y] = p as [number, number];
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return { ok: false, message: "Un punto del contorno se sale del plano." };
    pts.push([x, y]);
  }
  return { ok: true, value: pts };
}

export const MOVEMENT_KIND_LABEL: Record<string, string> = {
  ASIGNACION: "Asignación",
  AGREGADO: "Material agregado",
  RETIRO: "Material retirado",
  TRASLADO: "Traslado",
  LIBERACION: "Liberación",
  OBSERVACION: "Observaciones",
  INGRESO_ME: "Ingreso de ME",
  CONFIG: "Configuración del mapa",
};
