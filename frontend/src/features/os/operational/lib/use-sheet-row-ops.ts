"use client";

/**
 * Filas como en Excel para las planillas de Materias Primas y Depósito: insertar una fila en blanco en cualquier lugar,
 * mover filas (orden manual persistente) y eliminar filas de la vista (archivo lógico: el historial se conserva).
 * Sin motivos ni confirmaciones; la auditoría (usuario, fecha, antes/después) la hace el servidor.
 */
import { useMemo } from "react";
import type { GenusGridRowDelete, GenusGridRowOps } from "@/components/data-grid/genus-grid";
import {
  bulkDeleteInventory,
  insertSheetRow,
  moveSheetRowApi,
  type SheetRowResource,
} from "@/features/os/operational/adapters/inventory-client";

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** `enabled` = el orden visible es el de la hoja (si no, subir/bajar no tendría sentido). */
export function useSheetRowOps(resource: SheetRowResource, reload: () => Promise<void> | void, enabled: boolean, canWrite: boolean): GenusGridRowOps | undefined {
  return useMemo(
    () =>
      canWrite
        ? {
            enabled,
            onInsert: async (beforeId) => {
              try {
                await insertSheetRow(resource, beforeId);
                await reload();
                return { ok: true };
              } catch (e) {
                return { ok: false, message: errText(e, "No se pudo insertar la fila.") };
              }
            },
            onMove: async (id, beforeId) => {
              try {
                await moveSheetRowApi(resource, id, beforeId);
                await reload();
                return { ok: true };
              } catch (e) {
                return { ok: false, message: errText(e, "No se pudo mover la fila.") };
              }
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource, enabled, canWrite]
  );
}

/** Eliminar filas de la vista en Depósito ME: anula/archiva (revierte el stock con auditoría; nada se borra del historial). */
export function useMeRowDelete(resource: "me_ingresos" | "me_salidas" | "me_inventario", reload: () => Promise<void> | void, canWrite: boolean): GenusGridRowDelete | undefined {
  return useMemo(
    () =>
      canWrite
        ? {
            check: () => null,
            onDelete: async (ids) => {
              try {
                const res = await bulkDeleteInventory(resource, { ids });
                await reload();
                const n = res.deleted.length;
                return {
                  ok: n > 0,
                  message: `${n} fila${n === 1 ? "" : "s"} eliminada${n === 1 ? "" : "s"} (queda${n === 1 ? "" : "n"} en el historial; el stock se recalcula)${res.failed.length ? ` · ${res.failed.length} con error: ${res.failed[0]!.message}` : ""}.`,
                };
              } catch (e) {
                await reload();
                return { ok: false, message: errText(e, "No se pudo eliminar.") };
              }
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource, canWrite]
  );
}
