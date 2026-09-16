/**
 * Sincronización retroactiva Asignación de Lotes → WorkItem (caso 12 del
 * pedido: "Producción asignó sin lote/VTO; después alguien carga la
 * asignación — evitar tener que volver a escribirlo a mano").
 *
 * Regla, deliberadamente conservadora: solo completa un WorkItem cuando
 * AMBOS packagingLote y packagingVto siguen en null (nunca toca un trabajo
 * que ya tiene un valor propio, aunque sea distinto — "si el WorkItem ya
 * tiene un Lote/VTO distinto, NO sobreescribirlo automáticamente"), y solo
 * cuando la coincidencia cliente+producto es INEQUÍVOCA (exactamente un
 * WorkItem "en blanco" — nunca adivina entre varios). Guardado atómico vía
 * WHERE packaging_lote IS NULL AND packaging_vto IS NULL, mismo patrón de
 * carrera-segura que el resto de este módulo.
 */
import "server-only";

import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, workItems } from "@/lib/db/schema";
import { normalizeSearchKey } from "@/lib/formulas/types";
import type { AsignacionLote } from "./types";

export interface FillBareWorkItemsResult {
  filledWorkItemId: string | null;
}

/**
 * Se llama después de guardar una AsignacionLote con lote Y vto ya
 * presentes (alta manual, edición o import). No-op si falta cualquiera de
 * los dos, o si no hay evidencia de Neon configurada.
 */
export async function fillBareWorkItemsFromAsignacionLote(
  record: Pick<AsignacionLote, "id" | "lote" | "vto" | "producto" | "marca" | "updatedBy">,
  actorSector: string = "SYSTEM"
): Promise<FillBareWorkItemsResult> {
  const lote = record.lote?.trim();
  const vto = record.vto?.trim();
  if (!lote || !vto) return { filledWorkItemId: null };

  const cliente = normalizeSearchKey(record.marca ?? "");
  const producto = normalizeSearchKey(record.producto ?? "");
  if (!cliente || !producto) return { filledWorkItemId: null };

  const db = getDb();
  const candidates = await db
    .select({
      id: workItems.id,
      client: workItems.client,
      product: workItems.product,
      planningWeekId: workItems.planningWeekId,
    })
    .from(workItems)
    .where(
      and(
        ne(workItems.sector, "ELABORACION"),
        isNull(workItems.deletedAt),
        isNull(workItems.packagingLote),
        isNull(workItems.packagingVto)
      )
    );

  const matches = candidates.filter(
    (row) => normalizeSearchKey(row.client) === cliente && normalizeSearchKey(row.product) === producto
  );
  if (matches.length !== 1) return { filledWorkItemId: null };

  const target = matches[0]!;
  const now = new Date();
  const [row] = await db
    .update(workItems)
    .set({ packagingLote: lote, packagingVto: vto, updatedAt: now })
    .where(
      and(
        eq(workItems.id, target.id),
        isNull(workItems.packagingLote),
        isNull(workItems.packagingVto)
      )
    )
    .returning({ id: workItems.id });
  if (!row) return { filledWorkItemId: null };

  await db.insert(operationalEvents).values({
    workItemId: target.id,
    planningWeekId: target.planningWeekId,
    type: "LOTE_VTO_FILLED",
    fromStatus: JSON.stringify({ lote: null, vto: null }),
    toStatus: JSON.stringify({ lote, vto }),
    actorEmail: record.updatedBy?.trim() || "asignacion-lotes-sync",
    actorSector,
    note: `Completado automáticamente desde Asignación de Lotes (id=${record.id}) tras carga posterior — Producción no lo había cargado.`,
  });

  return { filledWorkItemId: target.id };
}
