"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { WorkItem } from "@/types/operational/work-item";
import { groupWorkItemsByDay } from "@/lib/operational/work-item-filters";
import type { SectorId } from "@/types/operational/sector";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { AssignWorkDialog } from "../components/assign-work-dialog";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { personNamesMatch } from "@/lib/operational/display-fields";
import {
  archiveFromViewApi,
  excludeArchivedFromView,
  fetchWorkViewArchivesApi,
  onlyArchivedFromView,
  restoreToViewApi,
} from "@/lib/work-view-archive";
import { WorkItemProgressTable } from "../components/work-item-progress-table";
import { WorkItemDrawer } from "../components/work-item-drawer";
import { SyncStatusBar, OperationalTabs } from "../components/operational-ui";
import { OperationalDayNav } from "../components/operational-day-nav";
import { OperationalWeekBoard, parseWeekBoardDropId, shortDayLabel, WeekBoardDndContext } from "../components/operational-week-board";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalCalendar } from "../hooks/use-operational-calendar";
import { nativeDayEmptyMessage, nativeEmptyPlanMessage } from "../lib/native-empty-copy";
import { ELABORACION_RAMAS, SECTOR_PERSONNEL } from "../lib/sector-personnel";
import { LINE_TAB_LABELS, resolveLineBucket, type LineBucket } from "../lib/line-buckets";
import { mergeManualWorkItems } from "../adapters/manual-work-items-repository";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { useOperationalStore } from "../store/operational-store-context";
import { sortByDeliveryDateNearest } from "../lib/delivery-date";
import { upsertGranelFromEnvasadoApi } from "@/lib/graneles/graneles-client";
import { formatBulkRemainderKg, hasRegistrableBulkRemainder } from "../lib/bulk-remainder";
import { canSendToCodificado } from "../lib/codificado-flow";
import {
  WORK_TRANSFER,
} from "../lib/work-transfer-labels";
import { isEnvasadoWorkPending } from "../lib/envasado-pending";
import { postCodificadoHandoff } from "../adapters/codificado-handoff-client";
import { postCircuitDelivery, postSendToEnvasado } from "../adapters/circuit-client";
import type { DeliverWorkPayload } from "../components/deliver-work-dialog";
import type { SendToEnvasadoPayload } from "../components/send-to-envasado-dialog";
import { MoveConfirmDialog, usePendingMove } from "../components/move-confirm";

/** Sensor de drag & drop — umbral de distancia para no interferir con el click normal de "seleccionar día". */
function useWeekBoardDndSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
}

interface EnvasadoOperationalViewProps {
  sectorId: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";
}

type EnvasadoListTab = "activos" | "archivados";

function useOptionalLineToggle(sectorId: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM") {
  const storageKey = `genus_os_${sectorId.toLowerCase()}_linea_opcional_enabled`;
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? true : raw === "true";
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);

  return { enabled, toggle };
}

/** Vista operativa envasado — pestañas por línea, filtrado por día (Hoy). */
export function EnvasadoOperationalView({ sectorId }: EnvasadoOperationalViewProps) {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus, showToast } = usePreviewContext();
  const calendar = useOperationalCalendar();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    sendToCodificado,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();
  const { email, sectorId: actorSectorId } = usePreviewSession();
  const { enabled: optionalLineEnabled, toggle: toggleOptionalLine } =
    useOptionalLineToggle(sectorId);
  /** Solo Producción/Dirección asignan trabajo desde acá — Envasado ve el mismo componente sin el botón. */
  const canAssignWork = actorSectorId === "PRODUCCION" || actorSectorId === "DIRECCION";

  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [listTab, setListTab] = useState<EnvasadoListTab>("activos");
  const [archivedIds, setArchivedIds] = useState<string[]>([]);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [topTab, setTopTab] = useState<"semanas" | "pendientes">("semanas");
  /** null = cerrado. {} = botón general (sin preselección). {line,plannedDate} = botón "+" de una celda. */
  const [assignSlot, setAssignSlot] = useState<{ line?: string; plannedDate?: string } | null>(null);

  const availableLines: LineBucket[] = useMemo(() => {
    const base: LineBucket[] = sectorId === "ENVASADO_MASIVO" ? ["1", "2", "3"] : ["1"];
    return optionalLineEnabled ? [...base, sectorId === "ENVASADO_MASIVO" ? "opcional" : "2"] : base;
  }, [sectorId, optionalLineEnabled]);

  const [activeLine, setActiveLine] = useState<LineBucket>("1");

  const planOptions =
    calendar.viewMode === "week"
      ? { weekStart: calendar.weekStart }
      : { date: calendar.selectedDate };

  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected, refresh } =
    useOperationalPlan(sectorId, planOptions);

  // Pendientes: fuente Neon sin recorte por día/semana (mismo patrón que
  // Codificado en codificado-operational-view.tsx) — necesita ver TODO lo
  // activo del sector, no solo lo que cae en el rango que esté mirando en
  // Semanas.
  const {
    data: dataPendientes,
    loading: loadingPendientes,
    refresh: refreshPendientes,
  } = useOperationalPlan(sectorId, {});

  const session = useMemo(
    () => ({ email: workspace.context.email, sector: sectorId }),
    [workspace.context.email, sectorId]
  );
  /** Sesión REAL del actor (su sector, no el de la vista): Producción opera vistas de Envasado. */
  const actorSession = useMemo(
    () => ({ email: workspace.context.email, sector: actorSectorId }),
    [workspace.context.email, actorSectorId]
  );

  const refreshArchives = useCallback(async () => {
    try {
      const result = await fetchWorkViewArchivesApi(session, sectorId);
      setArchivedIds(result.workItemIds);
    } catch {
      // Sin persistencia / schema pendiente: bandeja sin preferencias de archivo.
      setArchivedIds([]);
    }
  }, [session, sectorId]);

  useEffect(() => {
    void refreshArchives();
  }, [refreshArchives]);

  const workItems = useMemo(() => {
    const base = applyEffectiveStatus(mergeManualWorkItems(sectorId, data?.workItems ?? []));
    return sortByDeliveryDateNearest(applyProgressToWorkItems(base));
  }, [data?.workItems, sectorId, applyEffectiveStatus, applyProgressToWorkItems]);

  const pendientesItems = useMemo(() => {
    const base = applyEffectiveStatus(
      mergeManualWorkItems(sectorId, dataPendientes?.workItems ?? [])
    );
    return sortByDeliveryDateNearest(applyProgressToWorkItems(base)).filter(
      isEnvasadoWorkPending
    );
  }, [dataPendientes?.workItems, sectorId, applyEffectiveStatus, applyProgressToWorkItems]);

  const itemsForActiveLine = useMemo(
    () => workItems.filter((item) => (resolveLineBucket(item.line) ?? "1") === activeLine),
    [workItems, activeLine]
  );

  const visibleItems = useMemo(() => {
    const sorted = sortByDeliveryDateNearest(itemsForActiveLine);
    if (listTab === "archivados") {
      return onlyArchivedFromView(sorted, archivedIds);
    }
    return excludeArchivedFromView(sorted, archivedIds);
  }, [itemsForActiveLine, listTab, archivedIds]);

  const archivedCountForLine = useMemo(
    () => onlyArchivedFromView(itemsForActiveLine, archivedIds).length,
    [itemsForActiveLine, archivedIds]
  );

  // Vista Semana: misma selección que Día (mismos trabajos, sin archivados) agrupada por línea y por día.
  const weekLineItems = useMemo(() => {
    const map = new Map<LineBucket, WorkItem[]>();
    for (const bucket of availableLines) {
      map.set(
        bucket,
        excludeArchivedFromView(
          sortByDeliveryDateNearest(workItems.filter((item) => (resolveLineBucket(item.line) ?? "1") === bucket)),
          archivedIds
        )
      );
    }
    return map;
  }, [availableLines, workItems, archivedIds]);
  const weekDayCounts = useMemo(() => {
    const all = [...weekLineItems.values()].flat();
    return new Map([...groupWorkItemsByDay(all, calendar.weekDays)].map(([day, list]) => [day, list.length]));
  }, [weekLineItems, calendar.weekDays]);
  /** Celular: día visible de la semana (hoy si cae en la semana; si no, el lunes). */
  const [mobileDayState, setMobileDayState] = useState<string | null>(null);
  const mobileDay =
    mobileDayState && calendar.weekDays.includes(mobileDayState)
      ? mobileDayState
      : calendar.weekDays.includes(calendar.today)
        ? calendar.today
        : (calendar.weekDays[0] ?? calendar.today);

  const handleSave = useCallback(
    async (itemId: string, payload: { finishedQty: string; observation: string }) => {
      try {
        await saveWorkProgress(itemId, {
          ...payload,
          updatedBy: workspace.context.displayName,
          sector: sectorId,
        });
        showToast("Avance guardado.");
      } catch (err) {
        showToast(
          err instanceof Error
            ? `No se guardó: ${err.message} — reintentá.`
            : "No se pudo guardar en el servidor. Reintentá.",
          "info"
        );
      }
    },
    [saveWorkProgress, workspace.context.displayName, sectorId, showToast]
  );

  /**
   * Envasado → ENTREGAR: registra directamente la entrega final (sin aprobación). El cierre (cantidad, cajas, muestras,
   * observaciones, sobrante) viaja en la MISMA transacción que la entrega; la clave de idempotencia la fija el diálogo.
   * Errores: se relanzan para que el diálogo los muestre y conserve lo tipeado.
   */
  const handleDeliver = useCallback(
    async (
      item: WorkItem,
      payload: DeliverWorkPayload & {
        completion: {
          finishedQty: string;
          observation: string;
          packagingLote: string | null;
          packagingVto: string | null;
          packagingTotalUnits: number | null;
          packingGroups: Array<{ cajas: number; unidadesPorCaja: number }>;
          sampleUnits: number | null;
          packingMismatchObservation: string | null;
        };
      }
    ) => {
      // El sobrante se registra en Depósito ANTES de entregar, para enlazar su id al work item en la misma llamada.
      let bulkId: string | null = null;
      if (hasRegistrableBulkRemainder(payload.bulkRemainderKg)) {
        try {
          const granel = await upsertGranelFromEnvasadoApi(session, {
            workItemId: item.id,
            originSector: sectorId,
            product: item.product ?? "",
            client: item.client ?? "",
            bulkLot: item.loteRef || item.packagingLote || "Sin lote",
            kg: payload.bulkRemainderKg,
            reportedBy: workspace.context.displayName,
            observation: payload.bulkRemainderObservation ?? undefined,
          });
          bulkId = granel.record.id;
          if (granel.created) {
            pushNotification({
              kind: "trabajo_asignado",
              title: "Sobrante de granel",
              message: `Ingresaron ${formatBulkRemainderKg(payload.bulkRemainderKg)} kg de sobrante de ${item.product ?? "producto"} — ${item.client ?? "Cliente"}`,
              sectors: ["DEPOSITO"],
            });
          }
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : "No se pudo registrar el sobrante de granel.",
            "info"
          );
        }
      }
      const result = await postCircuitDelivery(actorSession, {
        workItemId: item.id,
        actorSectorId: actorSectorId,
        deliverQuantity: payload.deliverQuantity,
        idempotencyKey: payload.idempotencyKey,
        actualDeliveredAt: payload.actualDeliveredAt,
        remito: payload.remito,
        receivedBy: payload.receivedBy,
        observations: payload.observations,
        deliveryPackingGroups: payload.deliveryPackingGroups ?? null,
        plannedDeliveryDate: item.deliveryDate ?? null,
        sourceSector: sectorId,
        completion: {
          ...payload.completion,
          bulkRemainderKg: payload.bulkRemainderKg ?? null,
          bulkRemainderObservation: payload.bulkRemainderObservation ?? null,
          bulkRemainderId: bulkId,
        },
      });
      showToast(
        result.complete
          ? "Entrega registrada."
          : `Entrega parcial registrada. Saldo pendiente: ${result.pending ?? "—"}.`
      );
      await refresh();
      await refreshPendientes();
    },
    [session, actorSession, sectorId, actorSectorId, workspace.context.displayName, showToast, refresh, refreshPendientes]
  );

  const handleSendToCodificado = useCallback(
    async (
      item: WorkItem,
      payload: {
        totalUnits: number;
        observation: string;
        bulkRemainderKg?: number | null;
        bulkRemainderObservation?: string | null;
      }
    ) => {
      const gate = canSendToCodificado(item.status);
      if (!gate.ok) {
        showToast(gate.error, "info");
        return { already: true };
      }
      let bulkId: string | null = null;
      if (hasRegistrableBulkRemainder(payload.bulkRemainderKg)) {
        try {
          const granel = await upsertGranelFromEnvasadoApi(session, {
            workItemId: item.id,
            originSector: sectorId,
            product: item.product ?? "",
            client: item.client ?? "",
            bulkLot: item.loteRef || item.packagingLote || "Sin lote",
            kg: payload.bulkRemainderKg,
            reportedBy: workspace.context.displayName,
            observation: payload.bulkRemainderObservation ?? undefined,
          });
          bulkId = granel.record.id;
          if (granel.created) {
            pushNotification({
              kind: "trabajo_asignado",
              title: "Sobrante de granel",
              message: `Ingresaron ${formatBulkRemainderKg(payload.bulkRemainderKg)} kg de sobrante de ${item.product ?? "producto"} — ${item.client ?? "Cliente"}`,
              sectors: ["DEPOSITO"],
            });
          }
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : "No se pudo registrar el sobrante de granel.",
            "info"
          );
        }
      }

      try {
        const server = await postCodificadoHandoff(actorSession, item.id, {
          action: item.codificadoCancelledAt || item.viaCodificado ? "resend" : "send",
          totalUnits: payload.totalUnits,
          observation: payload.observation,
          packagingLote: item.packagingLote,
          packagingVto: item.packagingVto,
          packingGroups: item.packingGroups,
          sampleUnits: item.sampleUnits,
          bulkRemainderKg: payload.bulkRemainderKg,
          bulkRemainderObservation: payload.bulkRemainderObservation,
          bulkRemainderId: bulkId,
          expectedVersion: item.nativeVersion ?? null,
          idempotencyKey:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `send-${item.id}-${Date.now()}`,
        });

        // Espejo local solo tras confirmación Neon (UX / offline-friendly overlay).
        const result = sendToCodificado(server.workItem, {
          totalUnits: payload.totalUnits,
          observation: payload.observation,
          updatedBy: workspace.context.displayName || email || "Envasado",
          bulkRemainderKg: payload.bulkRemainderKg,
          bulkRemainderObservation: payload.bulkRemainderObservation,
          bulkRemainderId: bulkId,
        });

        if (server.replayed || result.already) {
          showToast(WORK_TRANSFER.alreadyInCodificado, "info");
          await refresh();
          await refreshPendientes();
          return { already: true };
        }
        pushNotification({
          kind: "trabajo_asignado",
          title: "Trabajo en Codificado",
          message: `${item.product ?? "Producto"} · ${item.client ?? ""} — ${payload.totalUnits} un. desde ${workspace.sectorLabel}`,
          sectors: ["CODIFICADO"],
        });
        const rev = server.workItem.codificadoRevision ?? 1;
        showToast(
          rev > 1
            ? `Reenviado a Codificado (rev. ${rev}).`
            : "Trabajo enviado a Codificado."
        );
        setSelectedItem(server.workItem);
        await refresh();
        await refreshPendientes();
        return { already: false };
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "No se pudo enviar a Codificado.",
          "info"
        );
        return { already: true };
      }
    },
    [
      sendToCodificado,
      workspace.context.displayName,
      workspace.sectorLabel,
      showToast,
      sectorId,
      email,
      session,
      actorSession,
      refresh,
      refreshPendientes,
    ]
  );

  const handleCancelCodificado = useCallback(
    async (item: WorkItem, payload: { reason?: string }) => {
      try {
        await postCodificadoHandoff(actorSession, item.id, {
          action: "cancel",
          reason: payload.reason,
          expectedVersion: item.nativeVersion ?? null,
          idempotencyKey:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `cancel-${item.id}-${Date.now()}`,
        });
        showToast("Envío a Codificado cancelado. Podés editar y reenviar.");
        setSelectedItem(null);
        setDrawerOpen(false);
        await refresh();
        await refreshPendientes();
        return { ok: true };
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "No se pudo cancelar el envío.",
          "info"
        );
        return { ok: false };
      }
    },
    [actorSession, showToast, refresh, refreshPendientes]
  );

  const handleArchiveFromView = useCallback(
    async (item: WorkItem) => {
      setArchiveBusyId(item.id);
      try {
        await archiveFromViewApi(session, sectorId, item.id);
        setArchivedIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
        showToast("Quitado de tu vista. El registro operativo se conserva.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "No se pudo archivar de la vista.");
      } finally {
        setArchiveBusyId(null);
      }
    },
    [session, sectorId, showToast]
  );

  const handleRestoreToView = useCallback(
    async (item: WorkItem) => {
      setArchiveBusyId(item.id);
      try {
        await restoreToViewApi(session, sectorId, item.id);
        setArchivedIds((prev) => prev.filter((id) => id !== item.id));
        showToast("Restaurado a tu vista.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "No se pudo restaurar a la vista.");
      } finally {
        setArchiveBusyId(null);
      }
    },
    [session, sectorId, showToast]
  );

  const lineTabs = availableLines.map((bucket) => ({
    id: bucket,
    label: LINE_TAB_LABELS[bucket],
  }));

  const dndSensors = useWeekBoardDndSensors();
  const move = usePendingMove({
    actorSectorId: actorSectorId as SectorId,
    updatedBy: workspace.context.displayName,
    onSaved: () => {
      showToast("Planificación actualizada.");
      void refresh();
      void refreshPendientes();
    },
    onError: (m) => showToast(m, "info"),
  });

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !canAssignWork) return;
      const target = parseWeekBoardDropId(String(over.id));
      if (!target) return;
      const itemId = String(active.id);
      const item = workItems.find((w) => w.id === itemId);
      if (!item) return;
      const newLine = LINE_TAB_LABELS[target.zone as LineBucket] ?? null;
      const sameDay = item.plannedDate === target.day;
      const sameLine = (resolveLineBucket(item.line) ?? "1") === target.zone;
      if (sameDay && sameLine) return;
      // No se guarda al soltar: CONFIRMAR / CANCELAR (sin motivo).
      move.request({ item, plannedDate: target.day, line: newLine, lineLabel: sameLine ? undefined : newLine ?? undefined });
    },
    [canAssignWork, workItems, move]
  );

  const listTabs = [
    { id: "activos", label: "Activos" },
    { id: "archivados", label: "Archivados", count: archivedCountForLine },
  ];

  return (
    <TwinShell title={workspace.sectorLabel}>
      <header className="mb-4 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Hola, {workspace.context.displayName}
        </h2>
        <p className="text-base font-medium text-[var(--os-text)]">{calendar.heading}</p>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · {workspace.context.jobTitle}
        </p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.source === "native" ? null : data?.message}
          onRefresh={refresh}
        />
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <OperationalTabs
          tabs={[
            { id: "semanas", label: "Semanas" },
            { id: "pendientes", label: "Pendientes", count: pendientesItems.length },
          ]}
          activeId={topTab}
          onChange={(id) => setTopTab(id as "semanas" | "pendientes")}
        />
        {canAssignWork ? (
          <Button
            type="button"
            variant="primary"
            onClick={() => setAssignSlot({})}
            data-testid="open-assign-work-dialog"
          >
            + Asignar trabajo
          </Button>
        ) : null}
      </div>

      {assignSlot ? (
        <AssignWorkDialog
          sector={sectorId}
          initialLine={assignSlot.line}
          initialPlannedDate={assignSlot.plannedDate}
          onClose={() => setAssignSlot(null)}
          onAssigned={() => {
            void refresh();
            void refreshPendientes();
          }}
        />
      ) : null}

      {topTab === "pendientes" ? (
        <div className="space-y-4">
          {loadingPendientes && !dataPendientes && (
            <div className="os-skeleton h-48 rounded-[var(--os-radius)]" />
          )}
          <WorkItemProgressTable
            items={pendientesItems}
            variant="envasado"
            showPackagingColumns
            onItemsChanged={async () => {
              await refresh();
              await refreshPendientes();
            }}
            getFinishedQty={getFinishedQty}
            getObservation={getObservation}
            onSelectItem={(item) => {
              setSelectedItem(item);
              setDrawerOpen(true);
            }}
            emptyMessage="No hay trabajos pendientes en este sector."
          />
        </div>
      ) : (
        <>
          <OperationalDayNav
            selectedDate={calendar.selectedDate}
            today={calendar.today}
            viewMode={calendar.viewMode}
            onPrev={calendar.goPrevDay}
            onNext={calendar.goNextDay}
            onPrevWeek={calendar.goPrevWeek}
            onNextWeek={calendar.goNextWeek}
            onToday={calendar.goToday}
            onTodayWeek={calendar.goToCurrentWeek}
            onViewMode={calendar.setViewMode}
          />

          {error && (
            <div className="mb-4 rounded border border-[var(--genus-error)]/25 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]">
              {error}
            </div>
          )}

          {loading && !data && <div className="os-skeleton h-48 rounded-[var(--os-radius)]" />}

          {!loading && calendar.viewMode === "week" && (
            <WeekBoardDndContext sensors={dndSensors} items={workItems} onDragEnd={(e) => void handleDragEnd(e)}>
              {canAssignWork && (
                <p className="mb-2 text-xs text-[var(--os-text-muted)]" data-testid="dnd-hint">
                  Arrastrá una tarjeta a otro día o línea para replanificarla.
                </p>
              )}
              {/* Totales por día (todas las líneas). Escritorio: alineados con las 5 columnas. Celular: selector de día. */}
              <div className="mb-2 hidden gap-2 lg:grid lg:grid-cols-5" data-testid="week-day-totals">
                {calendar.weekDays.map((day) => (
                  <button
                    type="button"
                    key={day}
                    onClick={() => calendar.selectDay(day)}
                    title={`Ver ${shortDayLabel(day)} en vista Día`}
                    className={`flex items-center justify-between rounded-md px-2 py-1 text-xs font-semibold hover:ring-1 hover:ring-[var(--os-teal)]/50 ${day === calendar.today ? "bg-[var(--os-teal)]/15 text-[var(--os-teal)]" : "bg-[var(--os-surface)] text-[var(--os-text)]"}`}
                    data-testid="week-day-total"
                    data-day={day}
                    data-count={weekDayCounts.get(day) ?? 0}
                  >
                    <span>{shortDayLabel(day)}</span>
                    <span className="tabular-nums text-[var(--os-text-muted)]">
                      {weekDayCounts.get(day) ?? 0} trabajo{(weekDayCounts.get(day) ?? 0) === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mb-2 flex gap-1 overflow-x-auto md:hidden" role="tablist" aria-label="Día" data-testid="week-day-picker">
                {calendar.weekDays.map((day) => (
                  <button
                    key={day}
                    type="button"
                    role="tab"
                    aria-selected={day === mobileDay}
                    onClick={() => setMobileDayState(day)}
                    className={`flex min-w-[4.25rem] flex-col items-center rounded-lg border px-2 py-1 text-[11px] font-semibold ${day === mobileDay ? "border-[var(--os-teal)] bg-[var(--os-teal)]/15 text-[var(--os-teal)]" : "border-[var(--os-border)] text-[var(--os-text-muted)]"}`}
                    data-testid="week-day-pick"
                    data-day={day}
                  >
                    <span>{shortDayLabel(day)}</span>
                    <span className="tabular-nums">{weekDayCounts.get(day) ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {availableLines.map((bucket) => {
                  const lineItems = weekLineItems.get(bucket) ?? [];
                  return (
                    <section
                      key={bucket}
                      className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-2 pb-2 pt-1.5"
                      data-testid="week-line"
                      data-line={bucket}
                    >
                      <h4 className="mb-1 flex items-center gap-2 px-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--os-text)]">
                        {LINE_TAB_LABELS[bucket]}
                        <span className="rounded-full bg-[var(--os-bg)] px-2 py-0.5 text-[11px] font-normal normal-case text-[var(--os-text-muted)]">
                          {lineItems.length} trabajo{lineItems.length === 1 ? "" : "s"}
                        </span>
                      </h4>
                      <OperationalWeekBoard
                        layout="columns"
                        mobileDay={mobileDay}
                        onRequestDate={canAssignWork ? (item, plannedDate) => move.request({ item, plannedDate }) : undefined}
                        dayHeadersInParent
                        weekDays={calendar.weekDays}
                        today={calendar.today}
                        selectedDate={calendar.selectedDate}
                        items={lineItems}
                        onSelectDay={calendar.selectDay}
                        hideHeader
                        cards={{
                          variant: "envasado",
                          listMode: "active",
                          getFinishedQty,
                          getObservation,
                          onSelectItem: (item) => {
                            setSelectedItem(item);
                            setDrawerOpen(true);
                          },
                          onArchiveFromView: handleArchiveFromView,
                          onRestoreToView: handleRestoreToView,
                          archiveBusyId,
                        }}
                        draggable={canAssignWork}
                        dropZoneId={bucket}
                        canCreate={canAssignWork}
                        onCreateSlot={(day, zone) =>
                          setAssignSlot({ line: LINE_TAB_LABELS[zone as LineBucket], plannedDate: day })
                        }
                        onEditItem={actorSectorId === "PRODUCCION" ? (item) => { setSelectedItem(item); setDrawerOpen(true); } : undefined}
                      />
                    </section>
                  );
                })}
              </div>
            </WeekBoardDndContext>
          )}

          {!loading && calendar.viewMode === "day" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <OperationalTabs
                  tabs={lineTabs}
                  activeId={activeLine}
                  onChange={(id) => setActiveLine(id as LineBucket)}
                />
                <label className="flex items-center gap-2 text-xs text-[var(--os-text-muted)]">
                  <input
                    type="checkbox"
                    checked={optionalLineEnabled}
                    onChange={toggleOptionalLine}
                    className="size-4 accent-[var(--os-teal)]"
                  />
                  Línea opcional activa
                </label>
              </div>

              <OperationalTabs
                tabs={listTabs}
                activeId={listTab}
                onChange={(id) => setListTab(id as EnvasadoListTab)}
              />

              <WorkItemProgressTable
                items={visibleItems}
                variant="envasado"
                listMode={listTab === "archivados" ? "archived" : "active"}
                onItemsChanged={async () => {
                  await refresh();
                }}
                getFinishedQty={getFinishedQty}
                getObservation={getObservation}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  setDrawerOpen(true);
                }}
                onArchiveFromView={handleArchiveFromView}
                onRestoreToView={handleRestoreToView}
                archiveBusyId={archiveBusyId}
                emptyMessage={
                  listTab === "archivados"
                    ? "No hay trabajos archivados de tu vista en esta línea."
                    : data?.source === "native"
                      ? nativeEmptyPlanMessage({
                          date: calendar.selectedDate,
                          sector: sectorId,
                        })
                      : (data?.message ?? "No hay trabajos planificados para este día.")
                }
              />
            </div>
          )}
        </>
      )}

      <MoveConfirmDialog pending={move.pending} busy={move.busy} onConfirm={() => void move.confirm()} onCancel={move.cancel} />
      <WorkItemDrawer
        item={selectedItem}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        variant="envasado"
        responsibleLabel="Línea"
        getFinishedQty={getFinishedQty}
        getObservation={getObservation}
        onPlanningChanged={async () => {
          await refresh();
          await refreshPendientes();
        }}
        onSaveProgress={handleSave}
        onDeliver={handleDeliver}
        onSendToCodificado={handleSendToCodificado}
        onCancelCodificado={handleCancelCodificado}
      />
    </TwinShell>
  );
}

/** Elaboración — sector único con ramas Cristian / Nicolás separadas. */
export function ElaboracionOperationalView() {
  const { applyEffectiveStatus, showToast } = usePreviewContext();
  const { sectorId: actorSectorId } = usePreviewSession();
  const calendar = useOperationalCalendar();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();
  const { email: actorEmail } = usePreviewSession();
  const canAssignWork = actorSectorId === "PRODUCCION" || actorSectorId === "DIRECCION";

  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** null = cerrado. {} = botón general. {plannedDate} = botón "+" de un día (Elaboración no tiene línea). */
  const [assignSlot, setAssignSlot] = useState<{ plannedDate?: string } | null>(null);

  const planOptions =
    calendar.viewMode === "week"
      ? { weekStart: calendar.weekStart }
      : { date: calendar.selectedDate };

  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected, refresh } =
    useOperationalPlan("ELABORACION", planOptions);

  const workItems = useMemo(() => {
    const base = applyEffectiveStatus(mergeManualWorkItems("ELABORACION", data?.workItems ?? []));
    return sortByDeliveryDateNearest(applyProgressToWorkItems(base));
  }, [data?.workItems, applyEffectiveStatus, applyProgressToWorkItems]);

  const ramas = useMemo(
    () =>
      ELABORACION_RAMAS.map((rama) => ({
        rama,
        items: workItems.filter((item) =>
          personNamesMatch(item.ownerPerson, rama)
        ),
      })),
    [workItems]
  );

  const handleSave = useCallback(
    async (itemId: string, payload: { finishedQty: string; observation: string }) => {
      const item = workItems.find((w) => w.id === itemId);
      const rama = item?.ownerPerson?.trim() || "Elaboración";
      try {
        await saveWorkProgress(itemId, {
          ...payload,
          updatedBy: rama,
          sector: "ELABORACION",
        });
        showToast("Avance guardado.");
      } catch (err) {
        showToast(
          err instanceof Error
            ? `No se guardó: ${err.message} — reintentá.`
            : "No se pudo guardar en el servidor. Reintentá.",
          "info"
        );
      }
    },
    [saveWorkProgress, workItems, showToast]
  );

  /**
   * Elaboración → Envasado Masivo/Premium, directo (sin Calidad ni aprobación). El servidor crea o enlaza el trabajo de
   * Envasado, deja el evento y avisa a Producción; acá solo se refresca. Los errores se relanzan al diálogo.
   */
  const handleSendToEnvasado = useCallback(
    async (item: WorkItem, payload: SendToEnvasadoPayload) => {
      const result = await postSendToEnvasado({ email: actorEmail, sector: actorSectorId }, item.id, {
        destination: payload.destination,
        line: payload.line,
        producedQuantity: payload.producedQuantity || null,
        unitsToPackage: payload.unitsToPackage || null,
        observation: payload.observation || null,
        idempotencyKey: payload.idempotencyKey,
      });
      showToast(
        result.linked
          ? `Enviado a ${result.destinationSector === "ENVASADO_MASIVO" ? "Envasado Masivo" : "Envasado Premium"} (se enlazó el trabajo existente).`
          : `Enviado a ${result.destinationSector === "ENVASADO_MASIVO" ? "Envasado Masivo" : "Envasado Premium"}.`
      );
      await refresh();
    },
    [actorEmail, actorSectorId, showToast, refresh]
  );

  const dndSensors = useWeekBoardDndSensors();
  const moveEl = usePendingMove({
    actorSectorId: actorSectorId as SectorId,
    updatedBy: "Producción",
    onSaved: () => {
      showToast("Planificación actualizada.");
      void refresh();
    },
    onError: (m) => showToast(m, "info"),
  });

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !canAssignWork) return;
      const target = parseWeekBoardDropId(String(over.id));
      if (!target) return;
      const itemId = String(active.id);
      const item = workItems.find((w) => w.id === itemId);
      if (!item || item.plannedDate === target.day) return;
      // No se guarda al soltar: CONFIRMAR / CANCELAR (sin motivo).
      moveEl.request({ item, plannedDate: target.day });
    },
    [canAssignWork, workItems, moveEl]
  );

  return (
    <TwinShell title="Elaboración">
      <header className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">Elaboración</h2>
          {canAssignWork ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => setAssignSlot({})}
              data-testid="open-assign-work-dialog"
            >
              + Asignar trabajo
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-[var(--os-text-muted)]">
          Encargado:{" "}
          <span className="font-medium text-[var(--os-text)]">
            {SECTOR_PERSONNEL.ELABORACION_ENCARGADO}
          </span>
        </p>
        <p className="text-base font-medium text-[var(--os-text)]">{calendar.heading}</p>
        {assignSlot ? (
          <AssignWorkDialog
            sector="ELABORACION"
            initialPlannedDate={assignSlot.plannedDate}
            onClose={() => setAssignSlot(null)}
            onAssigned={() => void refresh()}
          />
        ) : null}
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.source === "native" ? null : data?.message}
          onRefresh={refresh}
        />
      </header>

      <OperationalDayNav
        selectedDate={calendar.selectedDate}
        today={calendar.today}
        viewMode={calendar.viewMode}
        onPrev={calendar.goPrevDay}
        onNext={calendar.goNextDay}
        onPrevWeek={calendar.goPrevWeek}
        onNextWeek={calendar.goNextWeek}
        onToday={calendar.goToday}
        onViewMode={calendar.setViewMode}
      />

      {error && (
        <div className="mb-4 rounded border border-[var(--genus-error)]/25 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]">
          {error}
        </div>
      )}

      {loading && !data && <div className="os-skeleton h-40 rounded-[var(--os-radius)]" />}

      {!loading && calendar.viewMode === "week" && (
        <WeekBoardDndContext sensors={dndSensors} items={workItems} onDragEnd={(e) => void handleDragEnd(e)}>
          {canAssignWork && (
            <p className="mb-3 text-xs text-[var(--os-text-muted)]" data-testid="dnd-hint">
              Arrastrá una tarjeta a otro día para replanificarla.
            </p>
          )}
          <OperationalWeekBoard
            weekDays={calendar.weekDays}
            today={calendar.today}
            selectedDate={calendar.selectedDate}
            items={workItems}
            onSelectDay={calendar.selectDay}
            cards={{
              variant: "elaboracion",
              listMode: "active",
              getFinishedQty,
              getObservation,
              onSelectItem: (item) => {
                setSelectedItem(item);
                setDrawerOpen(true);
              },
            }}
            draggable={canAssignWork}
            dropZoneId="elaboracion"
            canCreate={canAssignWork}
            onCreateSlot={(day) => setAssignSlot({ plannedDate: day })}
            onEditItem={actorSectorId === "PRODUCCION" ? (item) => { setSelectedItem(item); setDrawerOpen(true); } : undefined}
          />
        </WeekBoardDndContext>
      )}

      {!loading && calendar.viewMode === "day" && (
        <div className="space-y-10">
          {ramas.map(({ rama, items }) => (
            <section key={rama}>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                {rama}
              </h3>
              <WorkItemProgressTable
                items={items}
                variant="elaboracion"
                onItemsChanged={async () => {
                  await refresh();
                }}
                getFinishedQty={getFinishedQty}
                getObservation={getObservation}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  setDrawerOpen(true);
                }}
                emptyMessage={
                  data?.source === "native"
                    ? nativeDayEmptyMessage(rama)
                    : `No hay trabajos para ${rama} en este día.`
                }
              />
            </section>
          ))}
        </div>
      )}

      <WorkItemDrawer
        item={selectedItem}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        variant="elaboracion"
        responsibleLabel="Responsable"
        getFinishedQty={getFinishedQty}
        getObservation={getObservation}
        onPlanningChanged={async () => {
          await refresh();
        }}
        onSaveProgress={handleSave}
        onSendToEnvasado={handleSendToEnvasado}
      />
      <MoveConfirmDialog pending={moveEl.pending} busy={moveEl.busy} onConfirm={() => void moveEl.confirm()} onCancel={moveEl.cancel} />
    </TwinShell>
  );
}
