"use client";

import { useMemo } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import {
  formatWorkItemDelivery,
  formatWorkItemPresentation,
} from "@/design-preview/lib/work-items-day-view";
import { TwinShell } from "@/design-preview/components/twin-shell";
import { usePreviewContext, usePreviewSession } from "@/design-preview/lib/preview-context";
import { useSectorWorkItems } from "@/design-preview/hooks/use-sector-work-items";
import { startOfDay } from "@/design-preview/lib/calendar";

import { resolveWorkItemStatusDisplay } from "@/design-system/work-item-status";
function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-base text-[var(--os-text)]">{value ?? "—"}</p>
    </div>
  );
}

function WorkDetailContent({ work }: { work: WorkItem }) {
  const { openOa, openOe, openClient, markWorkDone, getEffectiveStatus, completingIds } =
    usePreviewContext();
  const today = useMemo(() => startOfDay(new Date()), []);
  const status = getEffectiveStatus(work);
  const statusMeta = resolveWorkItemStatusDisplay(status);
  const isCompleting = completingIds.has(work.id);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-4">
        <div className="flex items-center gap-2">
          <span className={`size-2.5 rounded-full ${statusMeta.dotClassName}`} />
          <span className="text-sm font-medium text-[var(--os-text-muted)]">{statusMeta.label}</span>
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
          {work.client ?? "Trabajo"}
        </h2>
        <p className="text-xl text-[var(--os-text-muted)]">{work.product}</p>
      </header>

      <div className="grid gap-6 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-8 sm:grid-cols-2">
        <DetailField label="Presentación" value={formatWorkItemPresentation(work)} />
        <DetailField label="Entrega" value={formatWorkItemDelivery(work, today)} />
        <DetailField label="Línea" value={work.line} />
        <DetailField label="Sector" value={work.sector.replace(/_/g, " ")} />
        {work.oeRef && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              OE
            </p>
            <button
              type="button"
              onClick={() => openOe(work.oeRef!, work.id)}
              className="mt-1 font-mono text-base font-medium text-[var(--os-teal)] hover:underline"
            >
              {work.oeRef}
            </button>
          </div>
        )}
        {work.oaRef && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              OA
            </p>
            <button
              type="button"
              onClick={() => openOa(work.oaRef!, work.id)}
              className="mt-1 font-mono text-base font-medium text-[var(--os-teal)] hover:underline"
            >
              {work.oaRef}
            </button>
          </div>
        )}
        {work.client && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Cliente
            </p>
            <button
              type="button"
              onClick={() => openClient(work.client!)}
              className="mt-1 text-base font-medium text-[var(--os-teal)] hover:underline"
            >
              {work.client}
            </button>
          </div>
        )}
      </div>

      {work.blockedBy?.length ? (
        <div className="rounded-[var(--os-radius-sm)] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          Este trabajo depende de: {work.blockedBy.join(", ")}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 border-t border-[var(--os-border-subtle)] pt-6">
        {work.oaRef ? (
          <button
            type="button"
            onClick={() => openOa(work.oaRef!, work.id)}
            className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Abrir OA
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openOa("OA-SIM", work.id)}
            className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Crear OA
          </button>
        )}
        {work.oeRef && (
          <button
            type="button"
            onClick={() => openOe(work.oeRef!, work.id)}
            className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-5 py-2.5 text-sm font-medium text-[var(--os-text)] transition-colors hover:border-[var(--os-teal)]"
          >
            Ver OE
          </button>
        )}
        {status !== "completo" && status !== "bloqueado" && (
          <label
            className={`flex cursor-pointer items-center gap-2.5 rounded-[var(--os-radius-sm)] border px-4 py-2.5 text-sm transition-all ${
              isCompleting
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-[var(--os-border)] text-[var(--os-text)] hover:border-[var(--os-teal)]"
            }`}
          >
            <input
              type="checkbox"
              checked={isCompleting}
              onChange={() => markWorkDone(work)}
              className="size-4 rounded border-[var(--os-border)] accent-[var(--os-teal)]"
            />
            {isCompleting ? "Guardando…" : "Trabajo terminado"}
          </label>
        )}
      </div>
    </div>
  );
}

export function WorkDetailView() {
  const { currentNav, goBack, applyEffectiveStatus } = usePreviewContext();
  const { sectorId, ownerPerson } = usePreviewSession();
  const { data, loading } = useSectorWorkItems(sectorId, { ownerPerson });
  const workItemId = currentNav.workItemId;

  const work = useMemo(() => {
    const items = applyEffectiveStatus(data?.workItems ?? []);
    return items.find((item) => item.id === workItemId) ?? null;
  }, [data?.workItems, workItemId, applyEffectiveStatus]);

  return (
    <TwinShell showBack onBack={goBack} syncTime={data?.scannedAt ? new Date(data.scannedAt) : undefined}>
      {loading && (
        <div className="os-skeleton h-48 rounded-[var(--os-radius)] border border-[var(--os-border)]" />
      )}
      {!loading && !work && (
        <p className="text-sm text-[var(--os-text-muted)]">Trabajo no encontrado.</p>
      )}
      {!loading && work && <WorkDetailContent work={work} />}
    </TwinShell>
  );
}

export function OaDetailView() {
  const { currentNav, goBack, applyEffectiveStatus, openWorkItem, markWorkDone, getEffectiveStatus } =
    usePreviewContext();
  const { sectorId, ownerPerson } = usePreviewSession();
  const { data } = useSectorWorkItems(sectorId, { ownerPerson });
  const oaRef = currentNav.oaRef ?? "—";

  const work = useMemo(() => {
    const items = applyEffectiveStatus(data?.workItems ?? []);
    if (currentNav.workItemId) {
      return items.find((item) => item.id === currentNav.workItemId) ?? null;
    }
    return items.find((item) => item.oaRef === oaRef) ?? items[0] ?? null;
  }, [data?.workItems, currentNav.workItemId, oaRef, applyEffectiveStatus]);

  const status = work ? getEffectiveStatus(work) : "pendiente";

  return (
    <TwinShell
      title="Orden de Acondicionamiento"
      showBack
      onBack={goBack}
      syncTime={data?.scannedAt ? new Date(data.scannedAt) : undefined}
    >
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-mono text-3xl font-semibold tracking-tight text-[var(--os-teal)]">
            {oaRef}
          </p>
          <p className="mt-2 text-lg text-[var(--os-text-muted)]">
            {work?.client} · {work?.product}
          </p>
        </header>

        <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-8 space-y-4">
          <DetailField label="Estado" value={resolveWorkItemStatusDisplay(status).label} />
          <DetailField label="Cantidad" value={work ? formatWorkItemPresentation(work) : "—"} />
          <DetailField label="Línea" value={work?.line} />
          <DetailField label="Pedido" value={work?.pedidoRef} />
        </div>

        <div className="flex flex-wrap gap-3">
          {work && (
            <button
              type="button"
              onClick={() => openWorkItem(work.id)}
              className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-5 py-2.5 text-sm font-medium hover:border-[var(--os-teal)]"
            >
              Ver trabajo completo
            </button>
          )}
          {work && status !== "completo" && (
            <button
              type="button"
              onClick={() => markWorkDone(work)}
              className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Marcar terminado
            </button>
          )}
        </div>
      </div>
    </TwinShell>
  );
}

export function OeDetailView() {
  const { currentNav, goBack, applyEffectiveStatus, openWorkItem } = usePreviewContext();
  const { sectorId, ownerPerson } = usePreviewSession();
  const { data } = useSectorWorkItems(sectorId, { ownerPerson });
  const oeRef = currentNav.oeRef ?? "—";

  const work = useMemo(() => {
    const items = applyEffectiveStatus(data?.workItems ?? []);
    if (currentNav.workItemId) {
      return items.find((item) => item.id === currentNav.workItemId) ?? null;
    }
    return items.find((item) => item.oeRef === oeRef) ?? null;
  }, [data?.workItems, currentNav.workItemId, oeRef, applyEffectiveStatus]);

  return (
    <TwinShell
      title="Orden de Elaboración"
      showBack
      onBack={goBack}
      syncTime={data?.scannedAt ? new Date(data.scannedAt) : undefined}
    >
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-mono text-3xl font-semibold tracking-tight text-[var(--os-teal)]">
            {oeRef}
          </p>
          <p className="mt-2 text-lg text-[var(--os-text-muted)]">
            {work?.client} · {work?.product}
          </p>
        </header>

        <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-8 space-y-4">
          <DetailField label="Cantidad" value={work ? formatWorkItemPresentation(work) : "—"} />
          <DetailField label="Lote" value={work?.loteRef} />
          <DetailField label="Estado elaboración" value={work?.status.replace(/_/g, " ")} />
          <DetailField label="Notas" value={work?.notes} />
        </div>

        {work && (
          <button
            type="button"
            onClick={() => openWorkItem(work.id)}
            className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-5 py-2.5 text-sm font-medium hover:border-[var(--os-teal)]"
          >
            Ver trabajo completo
          </button>
        )}
      </div>
    </TwinShell>
  );
}

export function ClientDetailView() {
  const { currentNav, goBack, applyEffectiveStatus, openWorkItem } = usePreviewContext();
  const { sectorId, ownerPerson } = usePreviewSession();
  const { data } = useSectorWorkItems(sectorId, { ownerPerson });
  const clientName = currentNav.clientName ?? "";

  const clientWorks = useMemo(() => {
    const items = applyEffectiveStatus(data?.workItems ?? []);
    return items.filter(
      (item) => item.client?.toLowerCase() === clientName.toLowerCase()
    );
  }, [data?.workItems, clientName, applyEffectiveStatus]);

  return (
    <TwinShell
      title="Cliente"
      showBack
      onBack={goBack}
      syncTime={data?.scannedAt ? new Date(data.scannedAt) : undefined}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <h2 className="text-3xl font-semibold tracking-tight">{clientName}</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {clientWorks.length} trabajo(s) en tu sector
        </p>
        <ul className="space-y-3">
          {clientWorks.map((work) => (
            <li key={work.id}>
              <button
                type="button"
                onClick={() => openWorkItem(work.id)}
                className="flex w-full flex-col rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-5 py-4 text-left transition-colors hover:border-[var(--os-teal)]"
              >
                <span className="font-medium">{work.product}</span>
                <span className="mt-1 text-sm text-[var(--os-text-muted)]">
                  {formatWorkItemPresentation(work)} · {work.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </TwinShell>
  );
}
