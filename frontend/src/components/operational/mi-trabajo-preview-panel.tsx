"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Chip } from "@/components/ui/chip";
import type { WorkItemsPreviewResponse } from "@/types/operational/work-items-preview.types";
import { SECTOR_LABELS } from "@/types/operational/sector";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Checklist({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item} className="text-sm text-[var(--foreground)]">
              · {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** F8.1 — validation panels for functional preview on /mi-trabajo. */
export function MiTrabajoPreviewPanel({ preview }: { preview: WorkItemsPreviewResponse }) {
  const { profile, sourceBreakdown, dependencies, gaps, globalStats, productionOverview } =
    preview;

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info" title="Preview F8.1 — validación funcional">
        Recorré sectores con el selector o los accesos rápidos. Este panel responde las 9
        preguntas de validación antes de F8.2.{" "}
        {process.env.NODE_ENV === "development" && (
          <Link href="/debug/work-items" className="font-medium text-[var(--color-action)] hover:underline">
            Abrir diagnóstico técnico →
          </Link>
        )}
      </Alert>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold">1. ¿Qué ve {profile.greeting} al entrar?</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{profile.mission}</p>
        <p className="mt-2 text-sm">
          WorkItems visibles: <strong>{preview.counts.total}</strong> · Origen principal F8.1:{" "}
          <strong>SEMANAS 2026</strong>
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Para hacer hoy" value={preview.counts.hoy} />
        <StatCard label="Esta semana" value={preview.counts.semana} />
        <StatCard label="Pendientes" value={preview.counts.pendientes} />
        <StatCard label="Bloqueados" value={preview.counts.bloqueados} />
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold">5–6. Fuentes de datos</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-[var(--border-subtle)] p-3">
            <p className="text-xs font-medium">SEMANAS 2026</p>
            <p className="mt-1 text-2xl font-semibold">{sourceBreakdown.semanas_2026}</p>
            <Chip variant="outline" size="sm" className="mt-2">
              mapper F8.1 ✓
            </Chip>
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] p-3">
            <p className="text-xs font-medium">PEDIDOS 2026</p>
            <p className="mt-1 text-2xl font-semibold">{sourceBreakdown.pedidos_2026}</p>
            <Chip variant="outline" size="sm" className="mt-2">
              F8.2 pendiente
            </Chip>
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] p-3">
            <p className="text-xs font-medium">ASIGNACION DE LOTES 2026</p>
            <p className="mt-1 text-2xl font-semibold">{sourceBreakdown.asignacion_lotes_2026}</p>
            <Chip variant="outline" size="sm" className="mt-2">
              F8.2 pendiente
            </Chip>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {profile.expectedSources.map((src) => (
            <div
              key={src.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--background)] px-3 py-2 text-sm"
            >
              <span>{src.label}</span>
              <div className="flex items-center gap-2">
                <Chip variant="outline" size="sm">
                  {src.indexed ? "indexado" : "no indexado"}
                </Chip>
                <Chip variant="outline" size="sm">
                  {src.workItemCount} WI
                </Chip>
                <Chip variant="outline" size="sm">
                  {src.mapperStatus === "f8_1" ? "F8.1" : "F8.2"}
                </Chip>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <Checklist
            title="7. Acciones permitidas"
            items={profile.allowedActions}
            emptyLabel="Sin acciones documentadas."
          />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <Checklist
            title="7. Acciones no permitidas"
            items={profile.deniedActions}
            emptyLabel="Sin restricciones documentadas."
          />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold">8. Dependencias entre sectores</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{dependencies.chainNote}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatCard label="con dependsOn" value={dependencies.withDependsOn} />
          <StatCard label="con blockedBy" value={dependencies.withBlockedBy} />
          <StatCard label="con unblocks" value={dependencies.withUnblocks} />
        </div>
        {dependencies.items.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm">
            {dependencies.items.slice(0, 5).map((item) => (
              <li key={item.workItemId} className="rounded-md bg-[var(--background)] px-3 py-2">
                {item.product ?? item.workItemId}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Ningún WorkItem tiene dependencias pobladas — esperado en F8.1.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold">9. Datos todavía sin mapear (campos null)</h2>
        {gaps.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {preview.counts.total === 0
              ? "Sin WorkItems para analizar en este sector."
              : "Todos los campos clave están presentes."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--muted-foreground)]">
                  <th className="py-2 pr-4">Campo</th>
                  <th className="py-2 pr-4">Faltante</th>
                  <th className="py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {gaps.slice(0, 10).map((gap) => (
                  <tr key={gap.field} className="border-b border-[var(--border-subtle)]">
                    <td className="py-2 pr-4">{gap.field}</td>
                    <td className="py-2 pr-4">{gap.missingCount}</td>
                    <td className="py-2">{gap.totalCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {preview.sector === "PRODUCCION" && productionOverview && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold">Producción — carga por sector (orquestador)</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(globalStats.bySector ?? {})
              .filter(([, count]) => (count ?? 0) > 0)
              .map(([sectorId, count]) => (
                <div
                  key={sectorId}
                  className="flex items-center justify-between rounded-md bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <span>{SECTOR_LABELS[sectorId as keyof typeof SECTOR_LABELS] ?? sectorId}</span>
                  <strong>{count}</strong>
                </div>
              ))}
          </div>
          {productionOverview.priorities && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">
                Prioridades globales
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(productionOverview.priorities).map(([priority, count]) => (
                  <Chip key={priority} variant="outline" size="sm">
                    {priority}: {count}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {preview.mapperWarnings.length > 0 && (
        <Alert variant="attention" title="Mapper warnings">
          <ul className="mt-1 space-y-1 text-sm">
            {preview.mapperWarnings.slice(0, 5).map((warning) => (
              <li key={warning}>· {warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      <section className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
        <p>
          Total global SEMANAS: <strong>{globalStats.totalAllSectors}</strong> WorkItems ·{" "}
          {Object.entries(globalStats.byOriginStage ?? {})
            .map(([stage, count]) => `${stage}: ${count}`)
            .join(" · ") || "sin stages"}
        </p>
      </section>
    </div>
  );
}
