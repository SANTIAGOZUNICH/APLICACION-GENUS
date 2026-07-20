"use client";

import type { OaContent } from "@/lib/orders/types";
import { OA_ETIQUETADO_LEGAL_TEXT } from "@/lib/orders/types";

interface OaFormSectionsProps {
  content: OaContent;
  readOnly: boolean;
  codificadoOnly?: boolean;
  onChange: (next: OaContent) => void;
  onAddMaterial: () => void;
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  type = "text",
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string) => void;
  readOnly: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--os-text-muted)]">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1.5 text-sm disabled:opacity-70"
      />
    </label>
  );
}

export function OaFormSections({
  content,
  readOnly,
  codificadoOnly = false,
  onChange,
  onAddMaterial,
}: OaFormSectionsProps) {
  const structureLocked = readOnly || codificadoOnly;
  const h = content.header;

  return (
    <div className="space-y-4">
      <details open={!codificadoOnly} className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">ORDEN DE ACONDICIONAMIENTO — Encabezado</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label="Producto" value={h.productName} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, productName: v } })} />
          <Field label="Cliente" value={h.client} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, client: v } })} />
          <Field label="Lote" value={h.lot} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, lot: v } })} />
          <Field label="Análisis" value={h.analisis} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, analisis: v } })} />
          <Field label="Código de producto" value={h.productCode} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, productCode: v } })} />
          <Field label="VTO" value={h.vto} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, vto: v } })} />
          <Field label="Aprobó" value={h.aprobo} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, aprobo: v } })} />
          <Field label="Fecha de emisión" value={h.fechaEmision} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, fechaEmision: v } })} />
        </div>
      </details>

      {!codificadoOnly && (
        <>
          <details open className="rounded border border-[var(--os-border)] p-3">
            <summary className="cursor-pointer font-medium">Análisis de granel / Materiales</summary>
            <Field
              label="Resultado granel"
              value={content.analisisGranel.resultado}
              readOnly={structureLocked}
              onChange={(v) =>
                onChange({
                  ...content,
                  analisisGranel: { ...content.analisisGranel, resultado: v },
                })
              }
            />
            <p className="mt-1 text-xs text-[var(--os-text-muted)]">Firma granel: vacía (física).</p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-[var(--os-bg-muted,#f3f3f3)] text-left">
                    {["Nº", "Código", "Nombre", "Recibidos", "Desechados", "Usados", "Fecha", "Responsable"].map(
                      (x) => (
                        <th key={x} className="p-2">
                          {x}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {content.materials.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="p-1">{m.nro}</td>
                      {(
                        [
                          "codigo",
                          "nombreInsumo",
                          "recibidos",
                          "desechados",
                          "usados",
                          "fecha",
                          "responsable",
                        ] as const
                      ).map((key) => (
                        <td key={key} className="p-1">
                          <input
                            disabled={structureLocked}
                            value={m[key]}
                            onChange={(e) =>
                              onChange({
                                ...content,
                                materials: content.materials.map((x) =>
                                  x.id === m.id ? { ...x, [key]: e.target.value } : x
                                ),
                              })
                            }
                            className="w-full rounded border px-1 py-1"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!structureLocked && (
              <button
                type="button"
                className="mt-2 text-sm text-[var(--os-teal)]"
                onClick={onAddMaterial}
              >
                + Agregar material
              </button>
            )}
          </details>

          <details className="rounded border border-[var(--os-border)] p-3">
            <summary className="cursor-pointer font-medium">Envasado / Rendimientos</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field
                label="Fecha inicio"
                value={content.envasado.fechaInicio}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({ ...content, envasado: { ...content.envasado, fechaInicio: v } })
                }
              />
              <Field
                label="Fecha terminación"
                value={content.envasado.fechaTerminacion}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({
                    ...content,
                    envasado: { ...content.envasado, fechaTerminacion: v },
                  })
                }
              />
              <Field
                label="Operarios"
                value={content.envasado.operarios}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({ ...content, envasado: { ...content.envasado, operarios: v } })
                }
              />
              <Field
                label="Producción teórica (u)"
                type="number"
                value={content.rendimientos.produccionTeoricaUnidades}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({
                    ...content,
                    rendimientos: {
                      ...content.rendimientos,
                      produccionTeoricaUnidades: v === "" ? null : Number(v),
                    },
                  })
                }
              />
              <Field
                label="Cantidad unidades"
                type="number"
                value={content.rendimientos.cantidadUnidades}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({
                    ...content,
                    rendimientos: {
                      ...content.rendimientos,
                      cantidadUnidades: v === "" ? null : Number(v),
                    },
                  })
                }
              />
              <Field
                label="Rendimiento A %"
                value={content.rendimientos.rendimientoA}
                readOnly
                onChange={() => {}}
              />
            </div>
            <p className="mt-2 text-xs">Rango teórico: {content.rendimientos.rangoTeorico}</p>
            <label className="mt-2 block text-xs">
              Observaciones
              <textarea
                disabled={structureLocked}
                value={content.observaciones}
                onChange={(e) => onChange({ ...content, observaciones: e.target.value })}
                className="mt-1 min-h-20 w-full rounded border px-2 py-1 text-sm"
              />
            </label>
          </details>
        </>
      )}

      <details open className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">
          Controles en proceso — Etiquetado / Codificado
        </summary>
        <p className="mt-2 rounded bg-[var(--os-bg-muted,#f5f5f5)] p-2 text-xs">
          {OA_ETIQUETADO_LEGAL_TEXT}
        </p>
        <p className="mt-1 text-[10px] text-[var(--os-text-muted)]">
          Texto legal bloqueado — no editable desde una orden común.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field
            label="Notas codificado"
            value={content.etiquetadoCodificado.notas}
            readOnly={readOnly && !codificadoOnly}
            onChange={(v) =>
              onChange({
                ...content,
                etiquetadoCodificado: { ...content.etiquetadoCodificado, notas: v },
              })
            }
          />
          <Field
            label="Fecha responsable"
            value={content.etiquetadoCodificado.fechaResponsable}
            readOnly={readOnly && !codificadoOnly}
            onChange={(v) =>
              onChange({
                ...content,
                etiquetadoCodificado: {
                  ...content.etiquetadoCodificado,
                  fechaResponsable: v,
                },
              })
            }
          />
        </div>
      </details>

      {!codificadoOnly && (
        <details className="rounded border border-[var(--os-border)] p-3">
          <summary className="cursor-pointer font-medium">Análisis producto terminado</summary>
          <Field
            label="Resultado"
            value={content.analisisProductoTerminado.resultado}
            readOnly={structureLocked}
            onChange={(v) =>
              onChange({
                ...content,
                analisisProductoTerminado: { resultado: v },
              })
            }
          />
          <p className="mt-2 text-xs text-[var(--os-text-muted)]">
            Autorizaciones Producción / Control Calidad / Dirección Técnica: espacios vacíos para
            firma física.
          </p>
        </details>
      )}
    </div>
  );
}
