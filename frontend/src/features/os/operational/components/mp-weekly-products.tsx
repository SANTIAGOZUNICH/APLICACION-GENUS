"use client";

/**
 * Control semanal POR PRODUCTO: una sección desplegable por producto con su fórmula completa y cada MP coloreada según
 * disponibilidad (verde suficiente · amarillo faltante parcial · rojo sin stock · gris sin datos). El texto del estado
 * siempre acompaña al color. El stock es compartido: se asigna a los productos por orden de elaboración.
 */
import { Fragment } from "react";
import { OVERALL_LABEL, type ProductLine, type ProductOverall, type ProductSection } from "@/lib/mp-control/product-breakdown";
import { TONE_BADGE, TONE_CELL, TONE_LABEL, fmtKg, fmtSigned, valueClass, type Tone } from "@/lib/mp-control/availability-tone";
import type { WeeklyRow } from "@/lib/mp-control/weekly-availability-service";
import { GestionSelect, NoteCell } from "./mp-weekly-shared";

const OVERALL_TONE: Record<ProductOverall, Tone> = { CUBIERTA: "ok", CON_FALTANTES: "partial", SIN_STOCK: "none", DATOS_INCOMPLETOS: "unknown" };

/** Texto del estado de una línea (más específico que el semáforo). */
function lineStateText(l: ProductLine): string {
  if (l.rowEstado === "MP NO IDENTIFICADA") return "NO IDENTIFICADA";
  if (l.tone === "unknown") return "SIN DATOS";
  if (l.tone === "none" && l.rowEstado === "SIN STOCK UTILIZABLE") return "SIN STOCK UTILIZABLE";
  return TONE_LABEL[l.tone];
}

export function ProductSections({
  sections, rowsByKey, open, setOpen, canEdit, selectMode, selected, onToggleSelect, onRemove, onSaveNote, onSaveGestion,
}: {
  sections: ProductSection[];
  rowsByKey: Map<string, WeeklyRow>;
  open: Record<string, boolean>;
  setOpen: (id: string, value: boolean) => void;
  canEdit: boolean;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (key: string) => void;
  onRemove: (key: string) => void;
  onSaveNote: (row: WeeklyRow, text: string) => Promise<void>;
  onSaveGestion: (row: WeeklyRow, gestion: string) => Promise<void>;
}) {
  if (sections.length === 0) return <p className="p-4 text-center text-sm text-[var(--os-text-muted)]" data-testid="mpp-empty">No hay productos con ese filtro.</p>;
  return (
    <div className="space-y-3" data-testid="mpp-sections">
      {sections.map((s) => {
        const isOpen = open[s.id] ?? s.overall !== "CUBIERTA";
        const tone = OVERALL_TONE[s.overall];
        return (
          <section key={s.id} className={`overflow-hidden rounded-xl border ${tone === "ok" ? "border-emerald-400/40" : tone === "partial" ? "border-amber-400/50" : tone === "none" ? "border-rose-500/50" : "border-slate-400/40"}`} data-testid="mpp-section" data-overall={s.overall} data-product={s.product}>
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(s.id, !isOpen)} className="flex min-h-16 w-full flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--os-surface)] px-4 py-3 text-left" data-testid="mpp-header">
              <span className="text-xl" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-base font-bold uppercase leading-tight sm:text-lg" data-testid="mpp-title">{s.client} — {s.product}</span>
                <span className="mt-1 block text-xs text-[var(--os-text-muted)]">
                  Producción planificada: <b className="text-[var(--os-text)]" data-testid="mpp-total">{s.totalKg != null ? `${fmtKg(s.totalKg)} kg` : "—"}</b>
                  {" · "}OE: <b className="text-[var(--os-text)]" data-testid="mpp-oes">{s.oes.map((o) => o.oeNumber ?? "sin OE").filter((v, i, a) => a.indexOf(v) === i).join(", ")}</b>
                  {" · "}Fecha{s.days.includes("·") || s.days.includes("→") ? "s" : ""}: <span data-testid="mpp-days">{s.days || "—"}</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="mpp-counts">
                <span className={`rounded border px-2 py-1 ${TONE_BADGE.ok}`}>Suficientes: <b data-testid="mpp-count-ok">{s.counts.ok}</b></span>
                <span className={`rounded border px-2 py-1 ${TONE_BADGE.partial}`}>Faltantes: <b data-testid="mpp-count-partial">{s.counts.partial}</b></span>
                <span className={`rounded border px-2 py-1 ${TONE_BADGE.none}`}>Sin stock: <b data-testid="mpp-count-none">{s.counts.none}</b></span>
                {s.counts.unknown > 0 ? <span className={`rounded border px-2 py-1 ${TONE_BADGE.unknown}`}>Sin datos: <b data-testid="mpp-count-unknown">{s.counts.unknown}</b></span> : null}
                <span className={`rounded border px-2.5 py-1 text-sm font-bold ${TONE_BADGE[tone]}`} data-testid="mpp-overall">{OVERALL_LABEL[s.overall]}</span>
              </span>
            </button>
            {isOpen ? (
              <div className="border-t border-[var(--os-border)] bg-black/10 p-3" data-testid="mpp-body">
                {s.oes.length > 1 || s.oes.some((o) => o.note) ? (
                  <ul className="mb-2 space-y-0.5 text-xs" data-testid="mpp-oe-list">
                    {s.oes.map((o) => (
                      <li key={o.workId}>
                        <b>{o.oeNumber ? `OE ${o.oeNumber}` : "Sin OE"}</b> · {o.kg != null ? `${fmtKg(o.kg)} kg` : "no se suma"} · {o.days || "—"}{o.note ? <span className="text-amber-300"> — {o.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {s.versionNote ? <p className="mb-2 rounded border border-amber-400/50 bg-amber-400/10 px-2 py-1 text-xs text-amber-200" data-testid="mpp-version-note">{s.versionNote}</p> : null}
                {s.notes.map((n, i) => <p key={i} className="mb-1 text-xs text-slate-300">⚠ {n}</p>)}
                <p className="mb-2 text-[11px] text-[var(--os-text-muted)]">Stock <b>compartido</b> entre productos: se asigna por orden de fecha de elaboración. «Diferencia» es lo que le queda disponible a ESTE producto menos lo que necesita; «Saldo proyectado» es el de la MP tras TODA la semana.</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[56rem] table-fixed text-xs" data-testid="mpp-table">
                    <thead>
                      <tr className="text-left text-[var(--os-text-muted)]">
                        {selectMode ? <th className="w-[44px] p-1" /> : null}
                        <th className="w-[19%] p-1">Materia prima</th>
                        <th className="w-[5%] p-1 text-right">%</th>
                        <th className="w-[8%] p-1 text-right">Necesaria kg</th>
                        <th className="w-[7%] p-1 text-right">Físico</th>
                        <th className="w-[9%] p-1 text-right">Utilizable</th>
                        <th className="w-[7%] p-1 text-right">Reservado</th>
                        <th className="w-[9%] p-1 text-right">Diferencia</th>
                        <th className="w-[9%] p-1 text-right">Saldo proy.</th>
                        <th className="w-[12%] p-1">Estado</th>
                        <th className="w-[15%] p-1">Gestión / observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.map((l) => {
                        const row = rowsByKey.get(l.rowKey);
                        return (
                          <Fragment key={l.rowKey + l.materiaPrima}>
                            <tr className={`border-t border-[var(--os-border)] align-top ${l.excluded ? "opacity-50" : ""}`} data-testid="mpp-line" data-tone={l.tone} data-estado={lineStateText(l)}>
                              {selectMode ? (
                                <td className="p-1">{row && !l.excluded ? <input type="checkbox" aria-label={`Seleccionar ${l.materiaPrima}`} className="size-6" checked={selected.has(l.rowKey)} onChange={() => onToggleSelect(l.rowKey)} data-testid="mpw-check" /> : null}</td>
                              ) : null}
                              <td className="break-words p-1 font-medium">
                                {l.materiaPrima}
                                <span className="block font-mono text-[10px] font-normal text-[var(--os-text-muted)]">{l.codigo || "sin código"}</span>
                                {l.excluded ? <span className="block text-[10px] text-slate-300">Quitada del control de la semana</span> : null}
                              </td>
                              <td className="p-1 text-right font-mono">{l.pct != null ? fmtKg(l.pct) : "—"}</td>
                              <td className="p-1 text-right font-mono font-semibold" data-testid="mpp-need">{fmtKg(l.needKg)}</td>
                              <td className="p-1 text-right font-mono text-[var(--os-text-muted)]">{l.tone === "unknown" && l.rowEstado === "MP NO IDENTIFICADA" ? "—" : fmtKg(l.stockFisico)}</td>
                              <td className={`p-1 text-right font-mono ${TONE_CELL[l.tone]} ${valueClass(l.tone)}`} data-testid="mpp-util">
                                {l.tone === "unknown" && l.rowEstado === "MP NO IDENTIFICADA" ? "—" : fmtKg(l.stockUtilizable)}
                                <span className={`mt-0.5 block text-[10px] font-sans ${l.shared ? "text-sky-300" : "text-[var(--os-text-muted)]"}`} data-testid="mpp-shared" title={l.sharedWith.join(" · ")}>{l.shared ? `COMPARTIDO con ${l.sharedWith.length} producto${l.sharedWith.length > 1 ? "s" : ""}` : "exclusivo"}</span>
                              </td>
                              <td className="p-1 text-right font-mono text-[var(--os-text-muted)]">{fmtKg(l.reservado)}</td>
                              <td className={`p-1 text-right font-mono ${TONE_CELL[l.tone]} ${valueClass(l.tone, l.diferencia)}`} data-testid="mpp-dif">
                                {fmtSigned(l.diferencia)}
                                {l.diferencia != null && l.diferencia < 0 ? <span className="block text-[10px] font-sans">faltan {fmtKg(-l.diferencia)} kg</span> : null}
                              </td>
                              <td className={`p-1 text-right font-mono ${TONE_CELL[l.saldoTone]} ${valueClass(l.saldoTone, l.saldoProyectado)}`} data-testid="mpp-saldo">{fmtSigned(l.saldoProyectado)}</td>
                              <td className="p-1">
                                <span className={`inline-block rounded border px-2 py-1 font-bold ${TONE_BADGE[l.tone]}`} data-testid="mpp-estado">{lineStateText(l)}</span>
                                {l.note ? <span className="mt-1 block text-[10px] text-[var(--os-text-muted)]">{l.note}</span> : null}
                                {l.shared && l.sharedWith.length ? <span className="mt-1 block text-[10px] text-sky-300">También la usan: {l.sharedWith.join(" · ")}</span> : null}
                              </td>
                              <td className="p-1">
                                {row ? (
                                  <div className="space-y-1">
                                    <GestionSelect row={row} canEdit={canEdit} onSave={onSaveGestion as never} />
                                    <NoteCell row={row} canEdit={canEdit} onSave={onSaveNote as never} />
                                    {canEdit && !selectMode && !l.excluded ? <button type="button" className="min-h-10 rounded border border-rose-500/50 px-3 text-[11px] text-rose-300" onClick={() => onRemove(l.rowKey)} data-testid="mpp-line-remove">Quitar del control</button> : null}
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                      {s.lines.length === 0 ? <tr><td colSpan={11} className="p-3 text-center text-[var(--os-text-muted)]">Sin fórmula disponible para este producto.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
