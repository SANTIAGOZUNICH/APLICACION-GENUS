"use client";

import type { OeContent } from "@/lib/orders/types";
import { computeKgRealUtilizado } from "@/lib/orders/content";

export type OeFieldMode = {
  /** CALIDAD / PRODUCCION / MP */
  canEditFormula: boolean;
  /** ELABORACION (y managers con edit) */
  canEditOperational: boolean;
  actorEmail?: string;
};

interface OeFormSectionsProps {
  content: OeContent;
  /** @deprecated prefer fieldMode */
  readOnly?: boolean;
  fieldMode?: OeFieldMode;
  onChange: (next: OeContent) => void;
  onAddMaterial: () => void;
  onRemoveMaterial: (id: string) => void;
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  type = "text",
  lockedLook,
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string) => void;
  readOnly: boolean;
  type?: string;
  lockedLook?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--os-text-muted)]">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded border border-[var(--os-border)] px-2 py-1.5 text-sm disabled:opacity-70 ${
          lockedLook ? "bg-[var(--os-bg-muted,#eef1f4)] text-[var(--os-text-muted)]" : "bg-[var(--os-surface)]"
        }`}
      />
    </label>
  );
}

export function OeFormSections({
  content,
  readOnly = false,
  fieldMode,
  onChange,
  onAddMaterial,
  onRemoveMaterial,
}: OeFormSectionsProps) {
  const mode: OeFieldMode = fieldMode ?? {
    canEditFormula: !readOnly,
    canEditOperational: !readOnly,
  };
  const formulaLocked = !mode.canEditFormula;
  const opsLocked = !mode.canEditOperational;
  const h = content.header;
  const setHeader = (patch: Partial<OeContent["header"]>) =>
    onChange({ ...content, header: { ...h, ...patch } });

  const patchMaterial = (
    id: string,
    patch: Partial<OeContent["materials"][number]>
  ) => {
    onChange({
      ...content,
      materials: content.materials.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, ...patch };
        if ("ajuste" in patch && mode.actorEmail) {
          next.ajusteAt = new Date().toISOString();
          next.ajusteBy = mode.actorEmail;
        }
        return next;
      }),
    });
  };

  return (
    <div className="space-y-4" data-testid="oe-form-sections">
      <details open className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">Encabezado OE</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field
            label="Producto"
            value={h.productName}
            readOnly={formulaLocked && opsLocked}
            lockedLook={formulaLocked}
            onChange={(v) => setHeader({ productName: v })}
          />
          <Field
            label="Código"
            value={h.code}
            readOnly={formulaLocked}
            lockedLook={formulaLocked}
            onChange={(v) => setHeader({ code: v })}
          />
          <Field
            label="Fecha"
            value={h.date}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) => setHeader({ date: v })}
          />
          <Field
            label="Cantidad Kg"
            value={h.quantityKg}
            type="number"
            readOnly={formulaLocked}
            lockedLook={formulaLocked}
            onChange={(v) => setHeader({ quantityKg: v === "" ? null : Number(v) })}
          />
          <Field
            label="N° de Lote"
            value={h.lot}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) => setHeader({ lot: v })}
          />
          <Field
            label="Vigencia"
            value={h.vigencia}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) => setHeader({ vigencia: v })}
          />
          <Field
            label="Cliente"
            value={h.client}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) => setHeader({ client: v })}
          />
          <Field
            label="Envase cúbica"
            value={h.envaseCubica}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) => setHeader({ envaseCubica: v })}
          />
          <Field
            label="Equipo calefactor N°"
            value={h.equipoCalefactor}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) => setHeader({ equipoCalefactor: v })}
          />
        </div>
      </details>

      <details open className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">Materias primas</summary>
        <p className="mt-1 text-[11px] text-[var(--os-text-muted)]">
          Kg a pesar = cantidad teórica. Ajuste (+/- kg) = corrección de elaboración. Kg real = Kg a
          pesar + Ajuste. La columna legal del PDF se titula «AJUSTE».
        </p>
        {formulaLocked && (
          <p
            className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950"
            data-testid="oe-formula-locked-banner"
          >
            Fórmula teórica en solo lectura. Elaboración puede completar Ajuste (+/- kg), motivo y
            Lote N.º.
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs" data-testid="oe-materials-table">
            <thead>
              <tr className="bg-[var(--os-bg-muted,#f3f3f3)] text-left">
                <th className="p-2">Materia prima</th>
                <th className="p-2">Código</th>
                <th className="p-2">Fórmula %</th>
                <th className="p-2">kg a pesar</th>
                <th className="p-2">Ajuste (+/- kg)</th>
                <th className="p-2">Kg real</th>
                <th className="p-2">Motivo ajuste</th>
                <th className="p-2">Lote N.º</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {content.materials.map((m) => {
                const ajuste = m.ajuste ?? null;
                const kgReal = computeKgRealUtilizado(m.kgAPesar, ajuste);
                const adjusted = ajuste != null && ajuste !== 0;
                return (
                  <tr
                    key={m.id}
                    className={`border-t ${adjusted ? "bg-amber-50/80" : ""}`}
                    data-testid={adjusted ? "oe-row-adjusted" : "oe-row"}
                  >
                    <td className="p-1">
                      <input
                        disabled={formulaLocked}
                        value={m.materiaPrima}
                        onChange={(e) => patchMaterial(m.id, { materiaPrima: e.target.value })}
                        className={`w-full rounded border px-1 py-1 ${formulaLocked ? "bg-[var(--os-bg-muted,#eef1f4)]" : ""}`}
                        data-testid="oe-cell-materia"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        disabled={formulaLocked}
                        value={m.codigo}
                        onChange={(e) => patchMaterial(m.id, { codigo: e.target.value })}
                        className={`w-full rounded border px-1 py-1 ${formulaLocked ? "bg-[var(--os-bg-muted,#eef1f4)]" : ""}`}
                        data-testid="oe-cell-codigo"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        step="any"
                        disabled={formulaLocked}
                        value={m.formulaPct ?? ""}
                        onChange={(e) =>
                          patchMaterial(m.id, {
                            formulaPct: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className={`w-full rounded border px-1 py-1 ${formulaLocked ? "bg-[var(--os-bg-muted,#eef1f4)]" : ""}`}
                        data-testid="oe-cell-formula"
                      />
                    </td>
                    <td className="p-1 font-mono" data-testid="oe-cell-kg">
                      {m.kgAPesar ?? "—"}
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        step="any"
                        disabled={opsLocked}
                        value={m.ajuste ?? ""}
                        onChange={(e) =>
                          patchMaterial(m.id, {
                            ajuste: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="w-full rounded border px-1 py-1"
                        data-testid="oe-cell-ajuste"
                        title="Ajuste (+/- kg)"
                      />
                    </td>
                    <td className="p-1 font-mono" data-testid="oe-cell-kg-real">
                      {kgReal ?? "—"}
                    </td>
                    <td className="p-1">
                      <input
                        disabled={opsLocked}
                        value={m.ajusteMotivo}
                        onChange={(e) => patchMaterial(m.id, { ajusteMotivo: e.target.value })}
                        className="w-full rounded border px-1 py-1"
                        data-testid="oe-cell-ajuste-motivo"
                        placeholder={adjusted ? "Obligatorio" : ""}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        disabled={opsLocked}
                        value={m.lote}
                        onChange={(e) => patchMaterial(m.id, { lote: e.target.value })}
                        className="w-full rounded border px-1 py-1"
                        data-testid="oe-cell-lote"
                      />
                    </td>
                    <td className="p-1">
                      {!formulaLocked && (
                        <button
                          type="button"
                          className="text-rose-700"
                          onClick={() => onRemoveMaterial(m.id)}
                        >
                          Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div
          className="mt-2 grid gap-1 text-xs text-[var(--os-text-muted)] sm:grid-cols-4"
          data-testid="oe-ajuste-summary"
        >
          <span>Total teórico: {content.totals.kgSum ?? "—"} kg</span>
          <span>Total ajustes: {content.totals.ajusteSum ?? "—"} kg</span>
          <span>Total real: {content.totals.kgRealSum ?? "—"} kg</span>
          <span>Diferencia: {content.totals.diferenciaPct ?? "—"}%</span>
        </div>
        {!formulaLocked && (
          <button
            type="button"
            className="mt-2 text-sm text-[var(--os-teal)]"
            onClick={onAddMaterial}
            data-testid="oe-add-material"
          >
            + Agregar materia prima
          </button>
        )}
        <p className="mt-2 text-xs text-[var(--os-text-muted)]">
          Firma pesada: espacio en blanco para firma física (no digital).
        </p>
      </details>

      <details className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">PROCEDIMIENTO DE ELABORACIÓN</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {content.procedureSteps.map((s, idx) => (
            <li key={s.id}>
              <input
                disabled={formulaLocked}
                value={s.text}
                onChange={(e) =>
                  onChange({
                    ...content,
                    procedureSteps: content.procedureSteps.map((x, i) =>
                      i === idx ? { ...x, text: e.target.value } : x
                    ),
                  })
                }
                className={`w-full rounded border px-2 py-1 ${formulaLocked ? "bg-[var(--os-bg-muted,#eef1f4)]" : ""}`}
              />
            </li>
          ))}
        </ol>
      </details>

      <details className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">Control de proceso / calidad</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field
            label="Fecha control"
            value={content.processControl.date}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, date: v } })
            }
          />
          <Field
            label="Aspecto (resultado)"
            value={content.processControl.aspecto}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, aspecto: v } })
            }
          />
          <Field
            label="Espec. aspecto"
            value={content.processControl.aspectoSpec}
            readOnly={formulaLocked}
            lockedLook={formulaLocked}
            onChange={(v) =>
              onChange({
                ...content,
                processControl: { ...content.processControl, aspectoSpec: v },
              })
            }
          />
          <Field
            label="Color"
            value={content.processControl.color}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, color: v } })
            }
          />
          <Field
            label="Olor"
            value={content.processControl.olor}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, olor: v } })
            }
          />
          <Field
            label="pH"
            value={content.processControl.ph}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, ph: v } })
            }
          />
          <Field
            label="Viscosidad"
            value={content.processControl.viscosidad}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({
                ...content,
                processControl: { ...content.processControl, viscosidad: v },
              })
            }
          />
          <Field
            label="Cantidad real"
            type="number"
            value={content.processControl.cantidadReal}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({
                ...content,
                processControl: {
                  ...content.processControl,
                  cantidadReal: v === "" ? null : Number(v),
                },
              })
            }
          />
          <Field
            label="Cantidad obtenida"
            type="number"
            value={content.processControl.cantidadObtenida}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({
                ...content,
                processControl: {
                  ...content.processControl,
                  cantidadObtenida: v === "" ? null : Number(v),
                },
              })
            }
          />
          <Field
            label="Fecha finalización"
            value={content.processControl.fechaFin}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({
                ...content,
                processControl: { ...content.processControl, fechaFin: v },
              })
            }
          />
          <Field
            label="Resultado análisis granel"
            value={content.qualityControl.resultado}
            readOnly={opsLocked && formulaLocked}
            onChange={(v) =>
              onChange({
                ...content,
                qualityControl: { ...content.qualityControl, resultado: v },
              })
            }
          />
        </div>
        <p className="mt-3 text-xs text-[var(--os-text-muted)]">
          Firmas Producción / Control de Calidad / Dirección Técnica: vacías para firma física.
        </p>
      </details>
    </div>
  );
}
