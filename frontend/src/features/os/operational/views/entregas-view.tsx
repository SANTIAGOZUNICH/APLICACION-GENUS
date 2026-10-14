"use client";

/**
 * Entregas — calendario MENSUAL de entregas programadas a clientes (estilo Google Calendar).
 * En cada fecha aparece SOLO el nombre del cliente (una sola vez aunque tenga varios productos o entregas ese día);
 * al tocarlo se abre la tarjeta flotante con todo el detalle. Producción/Dirección crean, modifican, reprograman y
 * cancelan; Depósito y Envasado consultan (Envasado ve solo los productos de su sector: el recorte lo hace el servidor).
 * Programar una entrega no mueve stock ni toca trabajos por sí sola.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { EntregaFormDialog } from "../components/entrega-form-dialog";
import { EntregaDetailDialog } from "../components/entrega-detail-dialog";
import { gridRange, longDateLabel, monthGrid, monthLabel, shiftMonth, WEEKDAYS_ES } from "@/lib/entregas/calendar";
import { entregasApi } from "@/lib/entregas/entregas-client";
import { groupDeliveriesByClient } from "@/lib/entregas/rules";
import { canManageEntregas, canViewEntregas, type ScheduledDelivery } from "@/lib/entregas/types";
import { friendlySaveError } from "@/lib/ui/friendly-error";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Cuántos clientes se listan dentro de la celda en escritorio antes del «+N más». */
const CELL_VISIBLE = 4;

export function EntregasView() {
  const { sectorId } = usePreviewSession();
  const canManage = canManageEntregas(sectorId);
  const allowed = canViewEntregas(sectorId);
  const today = todayIso();
  const [{ year, month }, setYm] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [deliveries, setDeliveries] = useState<ScheduledDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [open, setOpen] = useState<{ client: string; date: string } | null>(null);
  const [form, setForm] = useState<{ initial: ScheduledDelivery | null } | null>(null);

  const range = useMemo(() => gridRange(year, month), [year, month]);
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);

  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      setDeliveries(await entregasApi.list(range.from, range.to));
      setError(null);
    } catch (e) {
      setError(friendlySaveError(e, "No se pudieron cargar las entregas."));
    } finally {
      setLoading(false);
    }
  }, [allowed, range.from, range.to]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledDelivery[]>();
    for (const d of deliveries) map.set(d.deliveryDate, [...(map.get(d.deliveryDate) ?? []), d]);
    return map;
  }, [deliveries]);

  // La tarjeta abierta se refresca sola con los datos nuevos (tras reprogramar, vincular, etc.).
  const openDeliveries = open ? (byDate.get(open.date) ?? []).filter((d) => d.client.trim().toLowerCase() === open.client.trim().toLowerCase()) : [];
  const clientNames = useMemo(() => deliveries.map((d) => d.client), [deliveries]);

  if (!allowed) {
    return (
      <TwinShell title="Entregas">
        <p className="text-sm text-[var(--os-text-muted)]">Entregas está disponible para Producción, Dirección, Depósito y Envasado.</p>
      </TwinShell>
    );
  }

  const openClient = (client: string, date: string) => setOpen({ client, date });
  const selectedClients = groupDeliveriesByClient(byDate.get(selectedDay) ?? []);

  return (
    <TwinShell title="Entregas">
      <div className="space-y-4" data-testid="entregas-view">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-xl font-semibold capitalize tracking-tight" data-testid="entregas-month">{monthLabel(year, month)}</h2>
          <Button type="button" size="sm" variant="secondary" onClick={() => setYm((v) => shiftMonth(v.year, v.month, -1))} aria-label="Mes anterior" data-testid="entregas-prev">
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setYm({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
              setSelectedDay(today);
            }}
            data-testid="entregas-today"
          >
            Hoy
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setYm((v) => shiftMonth(v.year, v.month, 1))} aria-label="Mes siguiente" data-testid="entregas-next">
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          {canManage && (
            <Button type="button" className="ml-auto" onClick={() => setForm({ initial: null })} data-testid="entregas-new">
              <Plus className="mr-1 size-4" aria-hidden="true" /> Nueva entrega
            </Button>
          )}
        </header>

        {error && (
          <p role="alert" className="rounded border border-[var(--genus-error)]/30 bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]" data-testid="entregas-error">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)]" role="grid" aria-label={`Calendario de entregas, ${monthLabel(year, month)}`} aria-busy={loading}>
          <div className="grid grid-cols-7 border-b border-[var(--os-border)] bg-[var(--os-bg)] text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]" role="row">
            {WEEKDAYS_ES.map((d) => (
              <div key={d} className="px-1 py-2" role="columnheader">{d}</div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]!.iso} className="grid grid-cols-7 border-b border-[var(--os-border)] last:border-b-0" role="row">
              {week.map((day) => {
                const groups = groupDeliveriesByClient(byDate.get(day.iso) ?? []);
                const isToday = day.iso === today;
                const isSelected = day.iso === selectedDay;
                return (
                  <div
                    key={day.iso}
                    role="gridcell"
                    tabIndex={0}
                    onClick={() => setSelectedDay(day.iso)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDay(day.iso);
                      }
                    }}
                    aria-selected={isSelected}
                    aria-label={`${longDateLabel(day.iso)}${groups.length ? `, ${groups.length} cliente(s)` : ""}`}
                    className={`min-h-[3.75rem] border-r border-[var(--os-border)] p-1 last:border-r-0 sm:min-h-[7.5rem] sm:p-1.5 ${day.inMonth ? "" : "bg-[var(--os-bg)]/60 opacity-60"} ${isSelected ? "outline outline-2 -outline-offset-2 outline-[var(--os-teal)]" : ""}`}
                    data-testid="entregas-day"
                    data-date={day.iso}
                    data-today={isToday ? "1" : undefined}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-[var(--os-teal)] text-[#04201e]" : "text-[var(--os-text)]"}`} data-testid={isToday ? "entregas-today-mark" : undefined}>
                        {day.day}
                      </span>
                      {groups.length > 0 && (
                        <span className="rounded-full bg-[var(--os-teal)]/20 px-1.5 text-[10px] font-bold text-[var(--os-teal)] sm:hidden" data-testid="entregas-day-count">
                          {groups.length}
                        </span>
                      )}
                    </div>
                    {/* Escritorio/tablet: SOLO el nombre del cliente (una vez por cliente y día). */}
                    <div className="hidden flex-col gap-1 sm:flex">
                      {groups.slice(0, CELL_VISIBLE).map((g) => (
                        <ClientChip key={g.client} name={g.client} cancelled={g.deliveries.every((d) => d.state === "cancelada")} onOpen={() => openClient(g.client, day.iso)} />
                      ))}
                      {groups.length > CELL_VISIBLE && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedDay(day.iso); }} className="text-left text-[11px] font-semibold text-[var(--os-teal)] hover:underline" data-testid="entregas-more">
                          +{groups.length - CELL_VISIBLE} más
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Día seleccionado: lista completa (en celular es la forma de ver y tocar los clientes). */}
        <section className="space-y-2 rounded-[var(--os-radius)] border border-[var(--os-border)] p-3" aria-live="polite" data-testid="entregas-agenda">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold capitalize">{longDateLabel(selectedDay)}</h3>
            {canManage && (
              <Button type="button" size="sm" variant="secondary" onClick={() => setForm({ initial: null })} data-testid="entregas-new-on-day">
                <Plus className="mr-1 size-3.5" aria-hidden="true" /> Entrega este día
              </Button>
            )}
          </div>
          {selectedClients.length === 0 ? (
            <p className="text-sm text-[var(--os-text-muted)]" data-testid="entregas-agenda-empty">{loading ? "Cargando…" : "Sin entregas programadas."}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedClients.map((g) => (
                <ClientChip key={g.client} name={g.client} cancelled={g.deliveries.every((d) => d.state === "cancelada")} onOpen={() => openClient(g.client, selectedDay)} large />
              ))}
            </div>
          )}
        </section>
      </div>

      {open && openDeliveries.length > 0 && (
        <EntregaDetailDialog
          open
          onOpenChange={(v) => !v && setOpen(null)}
          client={open.client}
          date={open.date}
          deliveries={openDeliveries}
          canManage={canManage}
          canApplyToWork={sectorId === "PRODUCCION"}
          onEdit={(d) => setForm({ initial: d })}
          onChanged={reload}
        />
      )}
      {open && openDeliveries.length === 0 && !loading && <ClosedNotice onClose={() => setOpen(null)} />}
      {form && (
        <EntregaFormDialog
          open
          onOpenChange={(v) => !v && setForm(null)}
          initial={form.initial}
          defaultDate={selectedDay}
          clients={clientNames}
          onSaved={async (saved) => {
            // Salta al mes y día de la entrega guardada para que se vea de inmediato.
            setYm({ year: Number(saved.deliveryDate.slice(0, 4)), month: Number(saved.deliveryDate.slice(5, 7)) });
            setSelectedDay(saved.deliveryDate);
            await reload();
          }}
        />
      )}
    </TwinShell>
  );
}

function ClientChip({ name, cancelled, onOpen, large }: { name: string; cancelled: boolean; onOpen: () => void; large?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={cancelled ? `${name} (cancelada)` : name}
      className={`max-w-full truncate rounded-md border px-1.5 py-0.5 text-left font-semibold transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--os-teal)] ${large ? "px-3 py-1.5 text-sm" : "text-[11px]"} ${cancelled ? "border-rose-400/40 bg-rose-400/10 text-rose-200 line-through" : "border-[var(--os-teal)]/50 bg-[var(--os-teal)]/15 text-[var(--os-text)]"}`}
      data-testid="entregas-client"
      data-client={name}
    >
      {name}
    </button>
  );
}

/** Si la entrega abierta ya no está en el día (p. ej. se reprogramó), se avisa y se cierra. */
function ClosedNotice({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 0);
    return () => clearTimeout(t);
  }, [onClose]);
  return null;
}
