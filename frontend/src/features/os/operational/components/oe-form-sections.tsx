"use client";

import { DecimalInput } from "@/components/ui/decimal-input";
import type { OeContent } from "@/lib/orders/types";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { FormulaAutoloadStatus } from "../lib/oe-formula-autoload";
import { statusMessage } from "../lib/oe-formula-autoload";
import { OeMaterialsTable } from "./oe-materials-table";
import { OeSheetsPanel } from "./oe-sheets-panel";
import {
  FormulaClientProductPickers,
  type SelectedFormulaOption,
} from "./formula-client-product-pickers";

export type OeFieldMode = {
  /** CALIDAD / PRODUCCION / MP */
  canEditFormula: boolean;
  /** ELABORACION (y managers con edit) */
  canEditOperational: boolean;
  actorEmail?: string;
};

interface OeFormSectionsProps {
  content: OeContent;
  /** Abre secciones plegadas (p. ej. al volver a completar los datos que faltan para entregar). */
  forceOpen?: { procedimiento?: boolean; control?: boolean };
  /** @deprecated prefer fieldMode */
  readOnly?: boolean;
  fieldMode?: OeFieldMode;
  onChange: (next: OeContent) => void;
  onAddMaterial: () => void;
  onRemoveMaterial: (id: string) => void;
  /** Estado de resolución automática de fórmula maestra. */
  formulaStatus?: FormulaAutoloadStatus;
  formulaStatusDetail?: string;
  session?: OrdersClientSession | null;
  selectedProductId?: string | null;
  didYouMean?: SelectedFormulaOption | null;
  onAcceptDidYouMean?: () => void;
  onClientTextChange?: (client: string) => void;
  onProductTextChange?: (product: string) => void;
  onClientSelected?: (client: string) => void;
  onProductSelected?: (option: SelectedFormulaOption) => void;
  onCommitProductText?: (client: string, product: string) => void;
  /** orderId u otra clave estable para hidratar Cliente/Producto una sola vez. */
  hydrateKey?: string;
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
  const cls = `rounded border border-[var(--os-border)] px-2 py-1.5 text-sm disabled:opacity-70 ${
    lockedLook ? "bg-[var(--os-bg-muted,#eef1f4)] text-[var(--os-text-muted)]" : "bg-[var(--os-surface)]"
  }`;
  if (type === "number") {
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--os-text-muted)]">{label}</span>
        <DecimalInput
          value={value === "" || value == null ? null : Number(value)}
          disabled={readOnly}
          onValue={(n) => onChange(n == null ? "" : String(n))}
          className={cls}
        />
      </label>
    );
  }
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
  formulaStatus = "idle",
  formulaStatusDetail,
  session = null,
  selectedProductId = null,
  didYouMean = null,
  onAcceptDidYouMean,
  onClientTextChange,
  onProductTextChange,
  onClientSelected,
  onProductSelected,
  onCommitProductText,
  hydrateKey,
  forceOpen,
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

  const usePickers =
    !!session &&
    !!onClientTextChange &&
    !!onProductTextChange &&
    !!onClientSelected &&
    !!onProductSelected &&
    !!onCommitProductText;

  const bannerMsg = statusMessage(formulaStatus, formulaStatusDetail);

  return (
    <div className="space-y-4" data-testid="oe-form-sections">
      {formulaStatus !== "idle" && bannerMsg ? (
        <p
          className={`rounded border px-2 py-1.5 text-xs ${
            formulaStatus === "error" || formulaStatus === "conflict"
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : formulaStatus === "found"
                ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                : "border-[var(--os-border)] bg-[var(--os-bg-muted,#f5f7fa)] text-[var(--os-text-muted)]"
          }`}
          data-testid="oe-formula-status"
          data-status={formulaStatus}
          role="status"
        >
          {bannerMsg}
        </p>
      ) : null}
      <details open className="rounded border border-[var(--os-border)] p-3 overflow-visible">
        <summary className="cursor-pointer font-medium">Encabezado OE</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 overflow-visible">
          {usePickers ? (
            <div className="sm:col-span-3 overflow-visible">
              <FormulaClientProductPickers
                session={session!}
                client={h.client}
                product={h.productName}
                hydrateKey={hydrateKey}
                readOnly={formulaLocked && opsLocked}
                suggestionsEnabled={mode.canEditFormula}
                selectedProductId={selectedProductId}
                didYouMean={didYouMean}
                onAcceptDidYouMean={onAcceptDidYouMean}
                onClientTextChange={onClientTextChange!}
                onProductTextChange={onProductTextChange!}
                onClientSelected={onClientSelected!}
                onProductSelected={onProductSelected!}
                onCommitProductText={onCommitProductText!}
                onClearClient={() => onClientTextChange!("")}
                onClearProduct={() => onProductTextChange!("")}
              />
            </div>
          ) : (
            <>
              <Field
                label="Producto"
                value={h.productName}
                readOnly={formulaLocked && opsLocked}
                lockedLook={formulaLocked}
                onChange={(v) => setHeader({ productName: v })}
              />
              <Field
                label="Cliente"
                value={h.client}
                readOnly={opsLocked && formulaLocked}
                onChange={(v) => setHeader({ client: v })}
              />
            </>
          )}
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

      <details id="oe-sec-materiales" open className="rounded border border-[var(--os-border)] p-3">
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
            Fórmula teórica en solo lectura. Elaboración completa CÓDIGO MP (si falta) y KG REAL UTILIZADO; LOTE MP es opcional
            (sin lote se descuenta por código). Se descuenta del stock solo lo realmente utilizado.
          </p>
        )}
        <OeMaterialsTable
          content={content}
          onChange={onChange}
          formulaLocked={formulaLocked}
          opsLocked={opsLocked}
          canEditCodigoMp={!opsLocked || !formulaLocked}
          session={session}
          actorEmail={mode.actorEmail}
          onRemoveMaterial={onRemoveMaterial}
        />
        <div
          className="mt-2 grid gap-1 text-xs text-[var(--os-text-muted)] sm:grid-cols-4"
          data-testid="oe-ajuste-summary"
        >
          <span>Total teórico: {content.totals.kgSum ?? "—"} kg</span>
          <span>Diferencia total: {content.totals.ajusteSum ?? "—"} kg</span>
          <span>Total real utilizado: {content.totals.kgRealSum ?? "—"} kg</span>
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

      <details id="oe-sec-hojas" open className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">Hojas de elaboración (tambores / ollas)</summary>
        <p className="mt-1 text-[11px] text-[var(--os-text-muted)]">
          Repartí la OE en varias preparaciones sin crear órdenes nuevas: misma fórmula, kg propios y lotes propios por
          tambor. El stock se descuenta una sola vez, al entregar la OE, con los kg reales de las hojas.
        </p>
        <OeSheetsPanel content={content} onChange={onChange} opsLocked={opsLocked} session={session} actorEmail={mode.actorEmail} />
      </details>

      <details id="oe-sec-procedimiento" open={forceOpen?.procedimiento || undefined} className="rounded border border-[var(--os-border)] p-3">
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

      <details id="oe-sec-control" open={forceOpen?.control || undefined} className="rounded border border-[var(--os-border)] p-3">
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
