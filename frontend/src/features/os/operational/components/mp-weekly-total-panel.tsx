"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canWriteMpControl } from "@/lib/mp-control/types";
import type { InventoryMpHit } from "@/lib/mp-control/weekly-availability-service";
import type { TotalRow } from "@/lib/mp-control/weekly-total";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { fmtKg } from "@/lib/mp-control/availability-tone";
import type { WeeklyTotalData } from "@/lib/mp-control/weekly-availability-service";
import { mondayOf } from "./mp-weekly-attention";

const shift = (iso: string, days: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const REFRESH_MS = 30_000;

type SortKey = "faltante" | "necesario" | "nombre";
const NOTE_DEBOUNCE_MS = 700;

/**
 * CONTROL SEMANAL TOTAL: kg necesarios de cada materia prima para TODAS las OE de Elaboración de la semana (o las SIN FECHA),
 * consolidados por materia prima de inventario, contra el stock real. Vista de planificación: no genera movimientos de stock.
 */
export function MpWeeklyTotalPanel() {
  const { email, sectorId } = usePreviewSession();
  const headers = useMemo<HeadersInit>(() => ({ [ACTOR_EMAIL_HEADER]: email ?? "", [ACTOR_SECTOR_HEADER]: sectorId }), [email, sectorId]);
  const [week, setWeek] = useState(() => mondayOf());
  const [sinFecha, setSinFecha] = useState(false);
  const [data, setData] = useState<WeeklyTotalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [sort, setSort] = useState<SortKey>("faltante");
  const [open, setOpen] = useState<string | null>(null);
  const canWrite = canWriteMpControl(sectorId);
  const jsonHeaders = useMemo<HeadersInit>(() => ({ ...(headers as Record<string, string>), "Content-Type": "application/json" }), [headers]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Observaciones: lo que se está escribiendo (aún no confirmado por el servidor) tiene prioridad sobre lo que llega de la base.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteState, setNoteState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Reemplazo manual
  const [replaceFor, setReplaceFor] = useState<TotalRow | null>(null);
  const [hitQuery, setHitQuery] = useState("");
  const [hits, setHits] = useState<InventoryMpHit[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  const [chosen, setChosen] = useState<InventoryMpHit | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const param = sinFecha ? "sin-fecha" : week;
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/v1/mp-control/weekly-total?week=${encodeURIComponent(param)}`, { credentials: "include", headers, cache: "no-store" });
        const body = (await res.json()) as WeeklyTotalData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "No se pudo calcular el control semanal total.");
        setData(body);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [param, headers]
  );

  // Actualización automática: al abrir/cambiar de semana, cada 30 s y al volver a la pestaña (OE, fórmulas y planificación cambian).
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(true), REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const saveNote = useCallback(
    async (row: TotalRow, text: string) => {
      setNoteState((m) => ({ ...m, [row.key]: "saving" }));
      try {
        const res = await fetch("/api/v1/mp-control/weekly-total/note", { method: "PUT", credentials: "include", headers: jsonHeaders, body: JSON.stringify({ week: param, rowKey: row.key, label: row.materiaPrima, observacion: text }) });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar la observación.");
        // Lo guardado pasa a ser el dato de la fila; el borrador se descarta solo si nadie siguió escribiendo.
        setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.key === row.key ? { ...r, observacion: text } : r)) } : d));
        setDrafts((m) => {
          if (m[row.key] !== text) return m;
          const { [row.key]: _gone, ...rest } = m;
          void _gone;
          return rest;
        });
        setNoteState((m) => ({ ...m, [row.key]: "saved" }));
      } catch (e) {
        setNoteState((m) => ({ ...m, [row.key]: "error" }));
        setError(e instanceof Error ? e.message : "No se pudo guardar la observación.");
      }
    },
    [jsonHeaders, param]
  );
  const onNoteChange = (row: TotalRow, text: string) => {
    setDrafts((m) => ({ ...m, [row.key]: text }));
    setNoteState((m) => ({ ...m, [row.key]: "saving" }));
    clearTimeout(timers.current[row.key]);
    timers.current[row.key] = setTimeout(() => void saveNote(row, text), NOTE_DEBOUNCE_MS);
  };
  const flushNote = (row: TotalRow) => {
    const t = timers.current[row.key];
    if (t === undefined) return;
    clearTimeout(t);
    delete timers.current[row.key];
    const text = drafts[row.key];
    if (text !== undefined) void saveNote(row, text);
  };

  const excludeRows = async (list: TotalRow[]) => {
    if (list.length === 0) return;
    const res = await fetch("/api/v1/mp-control/weekly-total/exclude", { method: "POST", credentials: "include", headers: jsonHeaders, body: JSON.stringify({ week: param, rows: list.map((r) => ({ rowKey: r.key, label: r.materiaPrima })) }) });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo quitar del control.");
      return;
    }
    setSelected(new Set());
    setNotice(`${list.length} materia${list.length === 1 ? "" : "s"} prima${list.length === 1 ? "" : "s"} quitada${list.length === 1 ? "" : "s"} del control (se pueden restaurar en «Ver excluidas»). No se borró nada del inventario, de las OE ni de las fórmulas.`);
    await load(true);
  };
  const restoreRows = async (keys: string[]) => {
    const res = await fetch("/api/v1/mp-control/weekly-total/exclude", { method: "POST", credentials: "include", headers: jsonHeaders, body: JSON.stringify({ week: param, restore: true, rowKeys: keys }) });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo restaurar.");
      return;
    }
    setNotice(`${keys.length} restaurada${keys.length === 1 ? "" : "s"}.`);
    await load(true);
  };

  // Buscador libre de TODO el inventario (no solo lo que sugiere la identificación automática).
  useEffect(() => {
    if (!replaceFor) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setHitsLoading(true);
      try {
        const res = await fetch(`/api/v1/mp-control/weekly-total/inventory?q=${encodeURIComponent(hitQuery)}`, { credentials: "include", headers, cache: "no-store" });
        const body = (await res.json()) as { items?: InventoryMpHit[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "No se pudo buscar en el inventario.");
        if (!cancelled) setHits(body.items ?? []);
      } catch (e) {
        if (!cancelled) setReplaceError(e instanceof Error ? e.message : "Error al buscar.");
      } finally {
        if (!cancelled) setHitsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [replaceFor, hitQuery, headers]);
  const openReplace = (row: TotalRow) => {
    setReplaceFor(row);
    setHitQuery("");
    setHits([]);
    setChosen(null);
    setReplaceError(null);
  };
  const confirmReplace = async () => {
    if (!replaceFor || !chosen || replaceBusy) return;
    setReplaceBusy(true);
    setReplaceError(null);
    try {
      const res = await fetch("/api/v1/mp-control/weekly-total/replace", { method: "POST", credentials: "include", headers: jsonHeaders, body: JSON.stringify({ sourceKey: replaceFor.key, sourceLabel: replaceFor.materiaPrima, targetCode: chosen.codigo }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo aplicar el reemplazo.");
      setNotice(`«${replaceFor.materiaPrima}» ahora se identifica con ${chosen.materiaPrima} (${chosen.codigo}).`);
      setReplaceFor(null);
      await load(true);
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : "No se pudo aplicar el reemplazo.");
    } finally {
      setReplaceBusy(false);
    }
  };
  const undoReplacement = async (sourceKey: string) => {
    const res = await fetch("/api/v1/mp-control/weekly-total/replace", { method: "POST", credentials: "include", headers: jsonHeaders, body: JSON.stringify({ sourceKey, remove: true }) });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo deshacer el reemplazo.");
      return;
    }
    setNotice("Reemplazo deshecho: la materia prima vuelve a identificarse automáticamente.");
    await load(true);
  };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (data?.rows ?? []).filter((r) => (!soloFaltantes || r.faltante > 0) && (!term || `${r.codigo} ${r.materiaPrima}`.toLowerCase().includes(term)));
    return [...list].sort((a, b) =>
      sort === "nombre" ? a.materiaPrima.localeCompare(b.materiaPrima, "es") : sort === "necesario" ? b.necesario - a.necesario || b.faltante - a.faltante : b.faltante - a.faltante || b.necesario - a.necesario
    );
  }, [data, q, soloFaltantes, sort]);
  const visibleKeys = useMemo(() => rows.map((r) => r.key), [rows]);
  const allVisibleSelected = rows.length > 0 && visibleKeys.every((k) => selected.has(k));
  const selectedRows = rows.filter((r) => selected.has(r.key));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visibleKeys));
  const toggleOne = (k: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  async function exportExcel() {
    const res = await fetch(`/api/v1/mp-control/weekly-total?week=${encodeURIComponent(param)}&format=xlsx`, { credentials: "include", headers });
    if (!res.ok) {
      setError("No se pudo exportar a Excel.");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `control-semanal-total-${sinFecha ? "sin-fecha" : (data?.weekStart ?? week)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-3" data-testid="mp-total">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={sinFecha} onClick={() => setWeek((w) => shift(w, -7))} data-testid="mp-total-prev">‹ Semana anterior</Button>
        <input type="date" aria-label="Semana" className="rounded border px-2 py-1.5 text-sm" value={week} disabled={sinFecha} onChange={(e) => e.target.value && setWeek(mondayOf(new Date(`${e.target.value}T12:00:00`)))} data-testid="mp-total-week" />
        <Button type="button" variant="secondary" disabled={sinFecha} onClick={() => setWeek((w) => shift(w, 7))} data-testid="mp-total-next">Semana siguiente ›</Button>
        <Button type="button" variant="secondary" disabled={sinFecha} onClick={() => setWeek(mondayOf())}>Hoy</Button>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={sinFecha} onChange={(e) => setSinFecha(e.target.checked)} data-testid="mp-total-sin-fecha" /> Sin fecha
        </label>
        <input className="min-w-[14rem] rounded border px-3 py-1.5 text-sm" placeholder="Buscar materia prima o código…" aria-label="Buscar materia prima" value={q} onChange={(e) => setQ(e.target.value)} data-testid="mp-total-search" />
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={soloFaltantes} onChange={(e) => setSoloFaltantes(e.target.checked)} data-testid="mp-total-solo-faltantes" /> Solo faltantes
        </label>
        <select className="rounded border px-2 py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar" data-testid="mp-total-sort">
          <option value="faltante">Mayor faltante</option>
          <option value="necesario">Mayor cantidad necesaria</option>
          <option value="nombre">Materia prima A-Z</option>
        </select>
        <Button type="button" variant="secondary" onClick={() => setShowExcluded((v) => !v)} data-testid="mp-total-ver-excluidas">
          Ver excluidas{data?.excluidas?.length ? ` (${data.excluidas.length})` : ""}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void exportExcel()} data-testid="mp-total-export">Exportar a Excel</Button>
      </div>
      {notice ? <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900" role="status" data-testid="mp-total-notice">{notice}</p> : null}
      {canWrite && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded border px-3 py-1.5 text-sm" data-testid="mp-total-selection-bar">
          <span data-testid="mp-total-selected-count">{selected.size} seleccionada{selected.size === 1 ? "" : "s"}</span>
          <Button type="button" variant="destructive" size="sm" onClick={() => void excludeRows(selectedRows)} data-testid="mp-total-delete-selected">Eliminar seleccionadas</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set())} data-testid="mp-total-deselect-all">Deseleccionar todas</Button>
        </div>
      ) : null}
      {showExcluded ? (
        <div className="rounded border px-3 py-2 text-sm" data-testid="mp-total-excluidas">
          <div className="mb-1 flex items-center justify-between">
            <strong>Materias primas excluidas de este control</strong>
            {canWrite && data?.excluidas?.length ? <Button type="button" variant="secondary" size="sm" onClick={() => void restoreRows(data.excluidas.map((e) => e.key))} data-testid="mp-total-restore-all">Restaurar todas</Button> : null}
          </div>
          {data?.excluidas?.length ? (
            <ul className="space-y-1">
              {data.excluidas.map((e) => (
                <li key={e.key} className="flex items-center justify-between gap-2" data-testid="mp-total-excluida">
                  <span>{e.materiaPrima}{e.codigo ? <span className="ml-2 font-mono text-xs text-[var(--os-text-muted)]">{e.codigo}</span> : null}{e.necesario ? <span className="ml-2 text-xs">· {fmtKg(e.necesario)}</span> : null}</span>
                  {canWrite ? <Button type="button" variant="secondary" size="sm" onClick={() => void restoreRows([e.key])} data-testid="mp-total-restore">Restaurar</Button> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--os-text-muted)]">No hay materias primas excluidas.</p>
          )}
        </div>
      ) : null}

      <p className="text-xs text-[var(--os-text-muted)]">
        {sinFecha ? "OE y trabajos de Elaboración SIN fecha asignada (no se ubican en ninguna semana)." : data?.weekStart ? `Semana ${fmtDay(data.weekStart)} – ${fmtDay(data.weekEnd!)} (fechas de planificación de Elaboración).` : "Calculando…"}{" "}
        Necesario = necesidad pendiente (teórica − consumo ya registrado). Vista de planificación: no mueve stock.
        {data ? ` Actualizado ${new Date(data.generatedAt).toLocaleTimeString("es-AR")}.` : ""}
      </p>
      {error ? <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">{error}</p> : null}
      {loading && !data ? <p className="text-sm text-[var(--os-text-muted)]">Calculando…</p> : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-3 text-sm" data-testid="mp-total-resumen">
            <span><strong>{data.summary.total}</strong> materias primas</span>
            <span><strong>{data.summary.oeCount}</strong> OE</span>
            <span>Necesario <strong>{fmtKg(data.summary.necesarioKg)}</strong></span>
            <span className={data.summary.conFaltante ? "font-semibold text-rose-700" : ""}>{data.summary.conFaltante} con faltante · {fmtKg(data.summary.faltanteKg)}</span>
            {data.summary.sinIdentificar ? <span className="text-amber-800">{data.summary.sinIdentificar} sin identificar en inventario</span> : null}
          </div>
          {data.incompletas.length ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900" role="status">
              {data.incompletas.length} producción(es) sin cantidad/fórmula confiable no se suman: {data.incompletas.slice(0, 4).map((i) => `${i.label} (${i.reason})`).join(" · ")}
            </p>
          ) : null}
          {data.omitted.length ? (
            <details className="text-xs text-[var(--os-text-muted)]">
              <summary>{data.omitted.length} trabajo(s) que no suman (cancelados, finalizados o repetidos)</summary>
              <ul className="mt-1 list-disc pl-5">{data.omitted.map((o) => <li key={o.id}>{o.label}{o.oeNumber ? ` · ${o.oeNumber}` : ""}: {o.note}</li>)}</ul>
            </details>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs text-[var(--os-text-muted)]">
                <tr>
                  {canWrite ? (
                    <th className="w-8 p-2">
                      <input type="checkbox" aria-label="Seleccionar todas las visibles" checked={allVisibleSelected} onChange={toggleAll} data-testid="mp-total-select-all" />
                    </th>
                  ) : null}
                  <th className="p-2">Código</th>
                  <th className="p-2">Materia prima</th>
                  <th className="p-2 text-right" title="% × kg del lote de cada OE">Teórica</th>
                  <th className="p-2 text-right" title="Ya descontado del inventario por las OE (libro mayor)">Consumo registrado</th>
                  <th className="p-2 text-right">Total necesario</th>
                  <th className="p-2 text-right">Stock disponible</th>
                  <th className="p-2 text-right">Faltante</th>
                  <th className="p-2 text-right">OE</th>
                  <th className="min-w-[14rem] p-2">Observaciones</th>
                  {canWrite ? <th className="p-2">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={canWrite ? 11 : 9} className="p-3 text-[var(--os-text-muted)]">{sinFecha ? "No hay OE de Elaboración sin fecha." : "No hay materias primas para esta semana."}</td></tr>
                ) : null}
                {rows.map((r) => (
                  <Fragment key={r.key}>
                    <tr className={`cursor-pointer border-t ${r.faltante > 0 ? "bg-rose-500/10" : ""}`} onClick={() => setOpen(open === r.key ? null : r.key)} data-testid="mp-total-row" data-row-key={r.key} data-codigo={r.codigo} data-faltante={r.faltante > 0 ? "1" : "0"} aria-expanded={open === r.key}>
                      {canWrite ? (
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Seleccionar ${r.materiaPrima}`} checked={selected.has(r.key)} onChange={() => toggleOne(r.key)} data-testid="mp-total-select" />
                        </td>
                      ) : null}
                      <td className="p-2 font-mono text-xs">{r.codigo || "—"}</td>
                      <td className="p-2 font-medium" data-testid="mp-total-nombre">{open === r.key ? "▾ " : "▸ "}{r.materiaPrima}{r.identificada ? "" : <span className="ml-2 rounded bg-amber-100 px-1.5 text-[11px] text-amber-900">{r.estado === "MP AMBIGUA" ? "ambigua" : "sin identificar"}</span>}{r.reemplazos.length > 0 ? <span className="ml-2 rounded bg-sky-100 px-1.5 text-[11px] text-sky-900" data-testid="mp-total-reemplazo-badge" title={r.reemplazos.map((x) => `${x.sourceName} (${fmtKg(x.kg)})`).join(", ")}>reemplazo manual</span> : null}</td>
                      <td className="p-2 text-right tabular-nums text-[var(--os-text-muted)]">{fmtKg(r.teorico)}</td>
                      <td className="p-2 text-right tabular-nums text-[var(--os-text-muted)]">{fmtKg(r.consumido)}</td>
                      <td className="p-2 text-right font-semibold tabular-nums" data-testid="mp-total-necesario">{fmtKg(r.necesario)}</td>
                      <td className="p-2 text-right tabular-nums" title={r.stockFisico !== r.stockDisponible ? `Físico ${fmtKg(r.stockFisico)} (parte bloqueada, vencida o reservada)` : undefined}>{fmtKg(r.stockDisponible)}</td>
                      <td className={`p-2 text-right font-semibold tabular-nums ${r.faltante > 0 ? "text-rose-700" : ""}`} data-testid="mp-total-faltante">{fmtKg(r.faltante)}</td>
                      <td className="p-2 text-right tabular-nums">{r.oeCount}</td>
                      <td className="p-2" onClick={(e) => e.stopPropagation()}>
                        {canWrite ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              className="w-full min-w-[12rem] rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-[var(--os-border)] focus:border-[var(--os-teal)] focus:bg-[var(--os-surface)] focus:outline-none"
                              placeholder="Escribir observación…"
                              aria-label={`Observaciones de ${r.materiaPrima}`}
                              value={drafts[r.key] ?? r.observacion}
                              onChange={(e) => onNoteChange(r, e.target.value)}
                              onBlur={() => flushNote(r)}
                              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
                              maxLength={2000}
                              data-testid="mp-total-obs"
                            />
                            <span className="w-14 shrink-0 text-[11px] text-[var(--os-text-muted)]" aria-live="polite" data-testid="mp-total-obs-state">
                              {noteState[r.key] === "saving" ? "guardando…" : noteState[r.key] === "saved" ? "✓ guardado" : noteState[r.key] === "error" ? "error" : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs" data-testid="mp-total-obs-ro">{r.observacion || "—"}</span>
                        )}
                      </td>
                      {canWrite ? (
                        <td className="whitespace-nowrap p-2" onClick={(e) => e.stopPropagation()}>
                          <Button type="button" variant="secondary" size="sm" onClick={() => openReplace(r)} data-testid="mp-total-buscar-coincidencia">Buscar coincidencia</Button>{" "}
                          <Button type="button" variant="secondary" size="sm" onClick={() => void excludeRows([r])} data-testid="mp-total-delete-one" aria-label={`Eliminar ${r.materiaPrima} del control`}>Eliminar</Button>
                        </td>
                      ) : null}
                    </tr>
                    {open === r.key ? (
                      <tr className="bg-[var(--os-surface)]">
                        <td colSpan={canWrite ? 11 : 9} className="p-2">
                          {r.notas.length ? <p className="mb-1 text-xs text-amber-800">{r.notas.join(" ")}</p> : null}
                          {r.reemplazos.length > 0 ? (
                            <ul className="mb-1 space-y-0.5 text-xs" data-testid="mp-total-reemplazos">
                              {r.reemplazos.map((x) => (
                                <li key={x.sourceKey}>
                                  MP original: <strong>{x.sourceName}</strong> ({fmtKg(x.kg)}) → {r.materiaPrima} ({r.codigo}).{" "}
                                  {canWrite ? <button type="button" className="underline" onClick={() => void undoReplacement(x.sourceKey)} data-testid="mp-total-deshacer-reemplazo">Deshacer reemplazo</button> : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <table className="w-full text-xs" data-testid="mp-total-detalle">
                            <thead className="text-[var(--os-text-muted)]">
                              <tr><th className="p-1 text-left">OE</th><th className="p-1 text-left">Cliente</th><th className="p-1 text-left">Producto</th><th className="p-1 text-left">Fecha</th><th className="p-1 text-right">Lote (kg)</th><th className="p-1 text-right">Teórico</th><th className="p-1 text-right">Consumido</th><th className="p-1 text-right">Kg necesarios</th></tr>
                            </thead>
                            <tbody>
                              {r.needs.map((n, i) => (
                                <tr key={`${n.productionId}-${i}`} className="border-t">
                                  <td className="p-1">{n.oeNumber || "(sin OE: fórmula)"}{n.origen ? <span className="ml-1 text-[var(--os-text-muted)]">(MP original: {n.origen})</span> : null}</td><td className="p-1">{n.client}</td><td className="p-1">{n.product}</td><td className="p-1">{n.days}</td>
                                  <td className="p-1 text-right tabular-nums">{n.lotKg != null ? fmtKg(n.lotKg) : "—"}</td>
                                  <td className="p-1 text-right tabular-nums">{n.incompleta ? "sin dato" : fmtKg(n.teorico)}</td>
                                  <td className="p-1 text-right tabular-nums">{fmtKg(n.consumido)}</td>
                                  <td className="p-1 text-right font-medium tabular-nums">{fmtKg(n.pendiente)}</td>
                                </tr>
                              ))}
                              <tr className="border-t font-semibold"><td className="p-1" colSpan={5}>TOTAL consolidado</td><td className="p-1 text-right tabular-nums">{fmtKg(r.teorico)}</td><td className="p-1 text-right tabular-nums">{fmtKg(r.consumido)}</td><td className="p-1 text-right tabular-nums">{fmtKg(r.necesario)}</td></tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <Dialog open={Boolean(replaceFor)} onOpenChange={(o) => !o && !replaceBusy && setReplaceFor(null)}>
        <DialogContent data-testid="mp-total-replace-dialog">
          <DialogHeader>
            <DialogTitle>Buscar coincidencia</DialogTitle>
            <DialogDescription>
              {replaceFor ? <>Buscá en TODO el inventario la materia prima que corresponde a <strong>{replaceFor.materiaPrima}</strong> ({fmtKg(replaceFor.necesario)} necesarios). Se mantienen los kg y el stock/faltante pasan a ser los de la MP elegida.</> : null}
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Escribí el nombre o el código de cualquier materia prima…"
            aria-label="Buscar materia prima del inventario"
            value={hitQuery}
            onChange={(e) => setHitQuery(e.target.value)}
            data-testid="mp-total-replace-search"
          />
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm" data-testid="mp-total-hits">
            {hitsLoading && hits.length === 0 ? <li className="text-[var(--os-text-muted)]">Buscando…</li> : null}
            {!hitsLoading && hits.length === 0 ? <li className="text-[var(--os-text-muted)]">Ninguna materia prima del inventario coincide con «{hitQuery}».</li> : null}
            {hits.map((h) => (
              <li key={h.codigo}>
                <button
                  type="button"
                  onClick={() => setChosen(h)}
                  className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left hover:bg-[var(--os-teal-soft)]/40 ${chosen?.codigo === h.codigo ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)]/60" : ""}`}
                  data-testid="mp-total-hit"
                  data-codigo={h.codigo}
                  aria-pressed={chosen?.codigo === h.codigo}
                >
                  <span><strong>{h.materiaPrima}</strong> <span className="font-mono text-xs text-[var(--os-text-muted)]">{h.codigo}</span></span>
                  <span className="text-xs tabular-nums text-[var(--os-text-muted)]">stock {fmtKg(h.stockKg)}</span>
                </button>
              </li>
            ))}
          </ul>
          {chosen && replaceFor ? (
            <p className="rounded bg-[var(--os-teal-soft)]/40 px-2 py-1 text-xs" data-testid="mp-total-replace-summary">
              «{replaceFor.materiaPrima}» ({fmtKg(replaceFor.necesario)}) pasará a <strong>{chosen.materiaPrima}</strong> ({chosen.codigo}), con stock {fmtKg(chosen.stockKg)}.
            </p>
          ) : null}
          {replaceError ? <p className="text-sm text-rose-700" role="alert" data-testid="mp-total-replace-error">{replaceError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setReplaceFor(null)} disabled={replaceBusy}>Cancelar</Button>
            <Button type="button" variant="primary" onClick={() => void confirmReplace()} disabled={!chosen || replaceBusy} data-testid="mp-total-replace-confirm">
              {replaceBusy ? "Aplicando…" : "Confirmar reemplazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
