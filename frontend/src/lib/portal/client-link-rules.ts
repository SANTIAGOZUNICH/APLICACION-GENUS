/**
 * Reglas PURAS del vínculo pedido/trabajo ⇄ cliente del portal (sin E/S).
 *
 * El ID del cliente (`portal_clients.id`) es el vínculo PRINCIPAL: independiente del usuario, del correo y de cómo se escriba el
 * nombre comercial. El nombre normalizado (alias o nombre comercial) solo sirve de RESPALDO para datos históricos y SOLO cuando
 * es INEQUÍVOCO: si el mismo nombre normalizado apunta a 2 o más clientes, no se vincula nada (se reporta).
 */
import { normalizeClientName } from "./client-identity-rules";

/** nombre normalizado → conjunto de clientes del portal que lo reclaman (alias vigentes + nombre comercial). */
export type NameIndex = Map<string, Set<string>>;

export function buildNameIndex(
  clients: ReadonlyArray<{ id: string; displayName: string }>,
  aliases: ReadonlyArray<{ clientId: string; nameKey: string }>
): NameIndex {
  const index: NameIndex = new Map();
  const add = (key: string | null | undefined, clientId: string) => {
    if (!key) return;
    const set = index.get(key) ?? new Set<string>();
    set.add(clientId);
    index.set(key, set);
  };
  for (const c of clients) add(normalizeClientName(c.displayName)?.key, c.id);
  for (const a of aliases) add(a.nameKey, a.clientId);
  return index;
}

export type NameResolution = { status: "unique"; clientId: string } | { status: "ambiguous"; clientIds: string[] } | { status: "none" };

/** Resuelve un nombre libre contra el índice: único, ambiguo (2+ clientes) o sin coincidencia. */
export function resolveName(raw: unknown, index: NameIndex): NameResolution {
  const n = normalizeClientName(raw);
  if (!n) return { status: "none" };
  const set = index.get(n.key);
  if (!set || set.size === 0) return { status: "none" };
  if (set.size === 1) return { status: "unique", clientId: [...set][0]! };
  return { status: "ambiguous", clientIds: [...set].sort() };
}

export type RowOwner = { kind: "client"; clientId: string; by: "id" } | { kind: "name" };

/**
 * Dueño efectivo de un TRABAJO: el ID de su PEDIDO (asignación explícita de Producción) y, si el pedido no tiene, el del propio
 * trabajo (derivado de su nombre al crearlo). Si no hay ningún ID → `name` (respaldo histórico por nombre inequívoco).
 * Un trabajo tiene UN solo dueño: nunca se muestra a dos clientes.
 */
export function workOwner(workClientId: string | null | undefined, pedidoClientId: string | null | undefined): RowOwner {
  const id = pedidoClientId || workClientId || null;
  return id ? { kind: "client", clientId: id, by: "id" } : { kind: "name" };
}

/** ¿El renglón pertenece a `clientId`? `name` solo vale si el nombre resuelve ÚNICAMENTE a ese cliente. */
export function belongsToClient(owner: RowOwner, rawName: unknown, clientId: string, index: NameIndex): boolean {
  if (owner.kind === "client") return owner.clientId === clientId;
  const r = resolveName(rawName, index);
  return r.status === "unique" && r.clientId === clientId;
}

/** Estado manual de un pedido SIN trabajos → etapa que ve el cliente (nunca «Listo» ni «Entregado»: eso exige evidencia operativa). */
export function manualStageOf(estado: string | null | undefined): "ELABORACION" | "ENVASADO" | null {
  const e = String(estado ?? "").trim().toUpperCase();
  if (e === "EN_ELABORACION") return "ELABORACION";
  if (e === "EN_ENVASADO" || e === "EN_CODIFICADO" || e === "LISTO_PARA_ENTREGAR") return "ENVASADO";
  return null;
}

/** Los id válidos de cliente viajan como uuid: cualquier otra cosa se descarta (nunca se interpola en SQL). */
export const isClientUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Clientes del selector cuyas etiquetas (nombre comercial / alias) coinciden EXACTO (normalizado) con el texto tipeado. */
export function choicesMatching(text: unknown, choices: ReadonlyArray<{ id: string; labels: ReadonlyArray<string> }>): string[] {
  const key = normalizeClientName(text)?.key;
  if (!key) return [];
  return choices.filter((c) => c.labels.some((l) => normalizeClientName(l)?.key === key)).map((c) => c.id);
}

/**
 * ¿Producción ya ENVIÓ el pedido a un sector? Al asignar el trabajo (p. ej. a Elaboración) el pedido pasa a EN_ELABORACION
 * (production_pedidos.estado, monótono). Para el cliente eso es «En elaboración» desde ese momento, aunque el operario todavía
 * no haya registrado avance en el trabajo. Antes solo se miraba el avance del trabajo y el envío quedaba como «Pedido programado».
 */
export function pedidoSentToSector(estado: string | null | undefined): boolean {
  const e = String(estado ?? "").trim().toUpperCase();
  return e === "EN_ELABORACION" || e === "EN_PROCESO" || e === "EN_ENVASADO" || e === "EN_CODIFICADO" || e === "LISTO_PARA_ENTREGAR" || e === "TERMINADO";
}
