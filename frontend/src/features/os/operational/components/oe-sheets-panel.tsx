"use client";

/**
 * Hojas de elaboración (tambores / ollas) dentro de UNA OE: pestañas horizontales + resumen general. Cada hoja usa la
 * MISMA fórmula de la OE (copiada al crearla), con sus propios kg, MP reales, lotes, responsable e incidencias.
 */
import { useMemo, useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { buildSheetsPrintHtml } from "@/lib/orders/oe-sheets-print";
import {
  MAX_SHEETS,
  SHEET_KIND_LABEL,
  SHEET_STATUS_LABEL,
  createSheet,
  recomputeSheet,
  sheetHasRealData,
  sheetLabel,
  summarizeSheets,
} from "@/lib/orders/oe-sheets";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { OeContent, OeSheet, OeSheetKind, OeSheetStatus } from "@/lib/orders/types";
import { OeMaterialsTable } from "./oe-materials-table";

const fmt = (n: number | null | undefined) => (n == null ? "—" : String(Number(n.toFixed(4))).replace(".", ","));
const STATUS_TONE: Record<OeSheetStatus, string> = {
  pendiente: "border-slate-400/50 text-slate-300",
  en_elaboracion: "border-sky-400/60 text-sky-300",
  elaborado: "border-emerald-400/60 text-emerald-300",
  observado: "border-amber-400/70 text-amber-300",
  aprobado: "border-teal-300/70 text-teal-200",
};

function printHtml(html: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

export function OeSheetsPanel({
  content,
  onChange,
  opsLocked,
  session,
  actorEmail,
}: {
  content: OeContent;
  onChange: (next: OeContent) => void;
  opsLocked: boolean;
  session: OrdersClientSession | null;
  actorEmail?: string;
}) {
  const sheets = useMemo(() => content.sheets ?? [], [content.sheets]);
  const [tab, setTab] = useState<string>("resumen");
  const active = sheets.find((s) => s.id === tab) ?? null;
  const summary = useMemo(() => summarizeSheets(content), [content]);

  const setSheets = (next: OeSheet[]) => onChange({ ...content, sheets: next });
  const patchSheet = (id: string, p: Partial<OeSheet>) =>
    setSheets(sheets.map((s) => (s.id === id ? recomputeSheet(content, { ...s, ...p }) : s)));

  const add = (kind: OeSheetKind = "tambor") => {
    if (sheets.length >= MAX_SHEETS) return;
    const sheet = createSheet(content, { kind, kg: null, by: actorEmail ?? "" });
    setSheets([...sheets, sheet]);
    setTab(sheet.id);
  };
  const remove = (s: OeSheet) => {
    setSheets(sheets.filter((x) => x.id !== s.id));
    setTab("resumen");
  };

  const input = "w-full rounded border border-[var(--os-border)] bg-transparent px-2 py-1.5 text-sm";
  return (
    <div data-testid="oe-sheets-panel">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--os-border)] pb-1" role="tablist" data-testid="oe-sheets-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "resumen"}
          onClick={() => setTab("resumen")}
          className={`shrink-0 rounded-t px-3 py-2 text-sm ${tab === "resumen" ? "bg-[var(--os-teal-soft)] font-semibold" : "text-[var(--os-text-muted)]"}`}
          data-testid="oe-sheet-tab-resumen"
        >
          Resumen general
        </button>
        {sheets.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={tab === s.id}
            onClick={() => setTab(s.id)}
            className={`shrink-0 rounded-t px-3 py-2 text-left text-sm ${tab === s.id ? "bg-[var(--os-teal-soft)] font-semibold" : "text-[var(--os-text-muted)]"}`}
            data-testid="oe-sheet-tab"
          >
            <span className="block">{sheetLabel(s)}</span>
            <span className="block text-[11px] font-normal">
              {fmt(s.kgPlanificados)} kg · {SHEET_STATUS_LABEL[s.status]}
            </span>
          </button>
        ))}
        {!opsLocked ? (
          <button
            type="button"
            onClick={() => add()}
            disabled={sheets.length >= MAX_SHEETS}
            className="shrink-0 rounded border border-[var(--os-teal)] px-3 py-2 text-sm font-semibold text-[var(--os-teal)]"
            data-testid="oe-sheet-add"
          >
            + Nueva hoja
          </button>
        ) : null}
      </div>

      {tab === "resumen" || !active ? (
        <div className="mt-3 space-y-3 text-sm" data-testid="oe-sheets-summary">
          <div className="grid gap-2 sm:grid-cols-3">
            <p>OE: <b>{content.header.code || "—"}</b></p>
            <p>Cliente: <b>{content.header.client || "—"}</b></p>
            <p>Producto: <b>{content.header.productName || "—"}</b></p>
            <p>Solicitado: <b data-testid="sum-requested">{fmt(summary.requestedKg)} kg</b></p>
            <p>Planificado entre hojas: <b data-testid="sum-planned">{fmt(summary.plannedKg)} kg</b></p>
            <p>Realmente elaborado: <b data-testid="sum-elaborated">{fmt(summary.elaboratedKg)} kg</b></p>
            <p>Pendiente: <b data-testid="sum-pending">{fmt(summary.pendingKg)} kg</b></p>
            <p>Hojas (tambores/ollas): <b>{summary.count}</b></p>
          </div>
          {summary.exceedsKg > 0 ? (
            <p className="rounded border border-amber-400/60 bg-amber-400/10 px-2 py-1 text-amber-200" role="alert" data-testid="sum-exceeds">
              Atención: lo planificado ({fmt(summary.plannedKg)} kg) supera la cantidad autorizada de la OE ({fmt(summary.requestedKg)} kg) por {fmt(summary.exceedsKg)} kg.
            </p>
          ) : null}
          {sheets.length === 0 ? (
            <p className="text-[var(--os-text-muted)]">Todavía no hay hojas. Con «+ Nueva hoja» repartís la OE en tambores u ollas (misma fórmula, kg propios, lotes propios).</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <thead>
                    <tr className="text-left"><th className="p-1">Hoja</th><th className="p-1">Plan. kg</th><th className="p-1">Elab. kg</th><th className="p-1">Estado</th><th className="p-1">Responsable</th><th className="w-1/3 p-1">Incidencias</th></tr>
                  </thead>
                  <tbody>
                    {sheets.map((s) => (
                      <tr key={s.id} className="border-t align-top" data-testid="sum-sheet-row">
                        <td className="p-1">{sheetLabel(s)}</td>
                        <td className="p-1 font-mono">{fmt(s.kgPlanificados)}</td>
                        <td className="p-1 font-mono">{fmt(s.kgElaborados)}</td>
                        <td className="p-1">{SHEET_STATUS_LABEL[s.status]}</td>
                        <td className="p-1 break-words">{s.operario || "—"}</td>
                        <td className="whitespace-pre-wrap break-words p-1">{s.incidencias || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h4 className="font-medium">Materias primas consolidadas</h4>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs" data-testid="sum-consolidated">
                  <thead>
                    <tr className="text-left"><th className="w-1/3 p-1">Materia prima</th><th className="p-1">Código MP</th><th className="p-1">Kg teórico</th><th className="p-1">Kg real</th><th className="p-1">Lotes</th></tr>
                  </thead>
                  <tbody>
                    {summary.consolidated.map((e) => (
                      <tr key={`${e.codigoMp}|${e.materiaPrima}`} className="border-t align-top">
                        <td className="whitespace-normal break-words p-1">{e.materiaPrima}</td>
                        <td className="p-1 font-mono">{e.codigoMp}</td>
                        <td className="p-1 font-mono">{fmt(e.kgTeorico)}</td>
                        <td className="p-1 font-mono">{fmt(e.kgReal)}</td>
                        <td className="p-1">{e.lots.map((l) => `${l.lote}: ${fmt(l.kg)} kg`).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={() => printHtml(buildSheetsPrintHtml(content, "summary"))} data-testid="oe-print-summary">Imprimir resumen</button>
                <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={() => printHtml(buildSheetsPrintHtml(content, "all"))} data-testid="oe-print-all">Imprimir todas las hojas</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3" data-testid="oe-sheet-editor">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <label className="text-xs">Tipo
              <select disabled={opsLocked} value={active.kind} onChange={(e) => patchSheet(active.id, { kind: e.target.value as OeSheetKind })} className={input} data-testid="sheet-kind">
                {Object.entries(SHEET_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="text-xs">N.º / identificación
              <input disabled={opsLocked} value={active.number} onChange={(e) => patchSheet(active.id, { number: e.target.value })} className={input} data-testid="sheet-number" />
            </label>
            <label className="text-xs">Nombre (opcional)
              <input disabled={opsLocked} value={active.name} onChange={(e) => patchSheet(active.id, { name: e.target.value })} className={input} data-testid="sheet-name" />
            </label>
            <label className="text-xs">Estado
              <select disabled={opsLocked} value={active.status} onChange={(e) => patchSheet(active.id, { status: e.target.value as OeSheetStatus })} className={`${input} ${STATUS_TONE[active.status]}`} data-testid="sheet-status">
                {Object.entries(SHEET_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="text-xs">Kg planificados
              <DecimalInput disabled={opsLocked} value={active.kgPlanificados} onValue={(n) => patchSheet(active.id, { kgPlanificados: n })} className={`${input} font-mono`} data-testid="sheet-kg-plan" />
            </label>
            <label className="text-xs">Kg realmente elaborados
              <DecimalInput disabled={opsLocked} value={active.kgElaborados} onValue={(n) => patchSheet(active.id, { kgElaborados: n })} className={`${input} font-mono`} data-testid="sheet-kg-elab" />
            </label>
            <label className="text-xs">Responsable
              <input disabled={opsLocked} value={active.operario} onChange={(e) => patchSheet(active.id, { operario: e.target.value })} className={input} data-testid="sheet-operario" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">Inicio
                <input disabled={opsLocked} type="datetime-local" value={active.inicioAt} onChange={(e) => patchSheet(active.id, { inicioAt: e.target.value })} className={input} />
              </label>
              <label className="text-xs">Fin
                <input disabled={opsLocked} type="datetime-local" value={active.finAt} onChange={(e) => patchSheet(active.id, { finAt: e.target.value })} className={input} />
              </label>
            </div>
          </div>
          <OeMaterialsTable
            content={{ ...content, materials: active.materials }}
            onChange={(next) => patchSheet(active.id, { materials: next.materials })}
            formulaLocked
            opsLocked={opsLocked}
            canEditCodigoMp={!opsLocked}
            session={session}
            actorEmail={actorEmail}
            onRemoveMaterial={() => undefined}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">Incidencias / desviaciones
              <textarea disabled={opsLocked} value={active.incidencias} onChange={(e) => patchSheet(active.id, { incidencias: e.target.value })} rows={2} className={input} data-testid="sheet-incidencias" />
            </label>
            <label className="text-xs">Observaciones
              <textarea disabled={opsLocked} value={active.observaciones} onChange={(e) => patchSheet(active.id, { observaciones: e.target.value })} rows={2} className={input} />
            </label>
          </div>
          <details className="text-xs text-[var(--os-text-muted)]">
            <summary className="cursor-pointer">Historial de la hoja ({active.history.length})</summary>
            <ul className="mt-1 list-disc pl-5">
              {active.history.map((h, i) => <li key={i}>{h.at.slice(0, 16).replace("T", " ")} · {h.by} — {h.text}</li>)}
            </ul>
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={() => printHtml(buildSheetsPrintHtml(content, { sheetId: active.id }))} data-testid="oe-print-sheet">Imprimir esta hoja</button>
            {!opsLocked && !sheetHasRealData(active) ? (
              <button type="button" className="rounded border border-rose-500/60 px-3 py-1.5 text-xs text-rose-300" onClick={() => remove(active)} data-testid="oe-sheet-remove">Quitar hoja (sin datos)</button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
