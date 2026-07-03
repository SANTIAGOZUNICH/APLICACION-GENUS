"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import {
  formatOperationalDifference,
  plannedQuantityLabel,
} from "../lib/operational-progress";
import { ActionButton, StatusChip } from "./operational-ui";

interface WorkItemProgressTableProps {
  items: WorkItem[];
  variant: "envasado" | "elaboracion";
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  onSaveProgress: (
    itemId: string,
    payload: { finishedQty: string; observation: string }
  ) => void;
  onMarkFinished: (
    item: WorkItem,
    payload: { finishedQty: string; observation: string }
  ) => void;
  emptyMessage?: string;
}

interface RowDraft {
  finishedQty: string;
  observation: string;
}

/** Tabla operativa con avance editable — Envasado / Elaboración. */
export function WorkItemProgressTable({
  items,
  variant,
  getFinishedQty,
  getObservation,
  onSaveProgress,
  onMarkFinished,
  emptyMessage = "Sin registros.",
}: WorkItemProgressTableProps) {
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (!next[item.id]) {
          next[item.id] = {
            finishedQty: getFinishedQty(item.id),
            observation: getObservation(item.id),
          };
        }
      }
      return next;
    });
  }, [items, getFinishedQty, getObservation]);

  const updateDraft = useCallback((itemId: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        finishedQty: prev[itemId]?.finishedQty ?? "",
        observation: prev[itemId]?.observation ?? "",
        ...patch,
      },
    }));
  }, []);

  if (items.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--os-border)] bg-[var(--os-bg)]">
            {variant === "envasado" && (
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                Línea
              </th>
            )}
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Cliente
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Producto
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Planificada
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              {variant === "envasado" ? "Terminada" : "Real terminada"}
            </th>
            {variant === "envasado" && (
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                Diferencia
              </th>
            )}
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Plazo
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              {variant === "envasado" ? "OA" : "OE"}
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Estado
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Observación
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const draft = drafts[item.id] ?? { finishedQty: "", observation: "" };
            const planned = plannedQuantityLabel(item.quantity, item.unit);
            const diff = formatOperationalDifference(item.quantity, draft.finishedQty);
            const ref = variant === "envasado" ? item.oaRef : item.oeRef;
            const isDone = item.status === "completo";

            return (
              <tr
                key={item.id}
                className="border-b border-[var(--os-border-subtle)] last:border-b-0 hover:bg-[var(--os-bg)]/60"
              >
                {variant === "envasado" && (
                  <td className="px-3 py-2.5 align-top font-medium">
                    {displayField(item.line)}
                  </td>
                )}
                <td className="px-3 py-2.5 align-top">{displayField(item.client)}</td>
                <td className="px-3 py-2.5 align-top font-medium">
                  {displayField(item.product)}
                </td>
                <td className="px-3 py-2.5 align-top tabular-nums">{planned}</td>
                <td className="px-3 py-2.5 align-top">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.finishedQty}
                    onChange={(e) => updateDraft(item.id, { finishedQty: e.target.value })}
                    placeholder="0"
                    disabled={isDone}
                    className="w-24 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1 text-sm tabular-nums disabled:opacity-50"
                  />
                </td>
                {variant === "envasado" && (
                  <td
                    className={`px-3 py-2.5 align-top tabular-nums font-medium ${
                      diff.startsWith("+")
                        ? "text-emerald-700"
                        : diff.startsWith("-")
                          ? "text-rose-700"
                          : ""
                    }`}
                  >
                    {diff}
                  </td>
                )}
                <td className="px-3 py-2.5 align-top">
                  {displayField(item.dayLabel ?? item.deliveryDate)}
                </td>
                <td className="px-3 py-2.5 align-top font-mono text-xs">
                  {displayField(ref)}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <StatusChip status={item.status} />
                </td>
                <td className="px-3 py-2.5 align-top">
                  <input
                    type="text"
                    value={draft.observation}
                    onChange={(e) => updateDraft(item.id, { observation: e.target.value })}
                    placeholder="Observación…"
                    disabled={isDone}
                    className="min-w-[140px] rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1 text-sm disabled:opacity-50"
                  />
                </td>
                <td className="px-3 py-2.5 align-top">
                  {isDone ? (
                    <span className="text-xs text-[var(--os-text-muted)]">Notificado a Calidad</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        label="Guardar avance"
                        variant="neutral"
                        onClick={() =>
                          onSaveProgress(item.id, {
                            finishedQty: draft.finishedQty,
                            observation: draft.observation,
                          })
                        }
                      />
                      <ActionButton
                        label="Marcar terminado"
                        variant="approve"
                        onClick={() =>
                          onMarkFinished(item, {
                            finishedQty: draft.finishedQty || item.quantity || "",
                            observation: draft.observation,
                          })
                        }
                      />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
