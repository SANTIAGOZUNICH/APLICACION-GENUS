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

import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, workItems } from "@/lib/db/schema";
import { clienteRelation, productoRelation } from "./resolve-for-work-item";
import type { AsignacionLote } from "./types";

export interface FillBareWorkItemsResult {
  filledWorkItemId: string | null;
  /** id del WorkItem para el que se detectó una posible inconsistencia (no se modificó nada). */
  flaggedInconsistencyWorkItemId: string | null;
}

/**
 * Se llama después de guardar una AsignacionLote con lote Y vto ya
 * presentes (alta manual, edición o import). No-op si falta cualquiera de
 * los dos, o si no hay evidencia de Neon configurada.
 *
 * Usa la misma tolerancia determinística (no fuzzy) que
 * `resolveAsignacionLoteForWorkItem` — cliente por subconjunto de tokens de
 * submarca, producto por cobertura de tokens significativos — para que el
 * caso real ECODERM/ROSEHIP (ver resolve-for-work-item.ts) también se
 * complete acá, no solo en Asignar trabajo.
 */
export async function fillBareWorkItemsFromAsignacionLote(
  record: Pick<AsignacionLote, "id" | "lote" | "vto" | "producto" | "marca" | "codigo" | "updatedBy">,
  actorSector: string = "SYSTEM"
): Promise<FillBareWorkItemsResult> {
  const lote = record.lote?.trim();
  const vto = record.vto?.trim();
  if (!lote || !vto) return { filledWorkItemId: null, flaggedInconsistencyWorkItemId: null };
  if (!record.marca?.trim() || !record.producto?.trim()) {
    return { filledWorkItemId: null, flaggedInconsistencyWorkItemId: null };
  }

  const qualifies = (client: string, product: string) =>
    clienteRelation(client, record.marca) !== "NONE" &&
    productoRelation(record, product) !== "NONE";

  const db = getDb();

  // Sección 12: completar SOLO WorkItems "en blanco" (lote Y vto null) —
  // nunca toca uno que ya tenga un valor propio, aunque sea distinto.
  const bareCandidates = await db
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

  let filledWorkItemId: string | null = null;
  const bareMatches = bareCandidates.filter((row) => qualifies(row.client, row.product));
  if (bareMatches.length === 1) {
    const target = bareMatches[0]!;
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
    if (row) {
      filledWorkItemId = target.id;
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
    }
  }

  // Sección 11: detección adicional, solo informativa — un WorkItem que ya
  // tiene lote/VTO propio nunca se toca, pero si difiere de una asignación
  // que lo referencia inequívocamente, vale la pena dejarlo señalado en el
  // historial para revisión humana. Nunca bloquea, nunca sobreescribe.
  let flaggedInconsistencyWorkItemId: string | null = null;
  if (!filledWorkItemId) {
    const nonBareCandidates = await db
      .select({
        id: workItems.id,
        client: workItems.client,
        product: workItems.product,
        planningWeekId: workItems.planningWeekId,
        packagingLote: workItems.packagingLote,
        packagingVto: workItems.packagingVto,
      })
      .from(workItems)
      .where(
        and(
          ne(workItems.sector, "ELABORACION"),
          isNull(workItems.deletedAt),
          or(isNotNull(workItems.packagingLote), isNotNull(workItems.packagingVto))
        )
      );

    const nonBareMatches = nonBareCandidates.filter((row) => qualifies(row.client, row.product));
    if (nonBareMatches.length === 1) {
      const target = nonBareMatches[0]!;
      const currentLote = target.packagingLote?.trim() || null;
      const currentVto = target.packagingVto?.trim() || null;
      const loteDiffers = Boolean(currentLote && currentLote !== lote);
      const vtoDiffers = Boolean(currentVto && currentVto !== vto);
      if (loteDiffers || vtoDiffers) {
        flaggedInconsistencyWorkItemId = target.id;
        await db.insert(operationalEvents).values({
          workItemId: target.id,
          planningWeekId: target.planningWeekId,
          type: "LOTE_VTO_POSIBLE_INCONSISTENCIA",
          fromStatus: JSON.stringify({ lote: currentLote, vto: currentVto }),
          toStatus: JSON.stringify({ lote, vto }),
          actorEmail: record.updatedBy?.trim() || "asignacion-lotes-sync",
          actorSector,
          note:
            `Asignación de Lotes (id=${record.id}) tiene lote=${lote}/vto=${vto} para este cliente+producto, ` +
            `pero el WorkItem ya tiene lote=${currentLote ?? "—"}/vto=${currentVto ?? "—"} propio. ` +
            `No se modificó nada — requiere revisión manual.`,
        });
      }
    }
  }

  return { filledWorkItemId, flaggedInconsistencyWorkItemId };
}
