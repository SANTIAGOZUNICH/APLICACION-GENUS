"use client";

import type { OeContent } from "@/lib/orders/types";

interface OeFormSectionsProps {
  content: OeContent;
  readOnly: boolean;
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

export function OeFormSections({
  content,
  readOnly,
  onChange,
  onAddMaterial,
  onRemoveMaterial,
}: OeFormSectionsProps) {
  const h = content.header;
  const setHeader = (patch: Partial<OeContent["header"]>) =>
    onChange({ ...content, header: { ...h, ...patch } });

  return (
    <div className="space-y-4">
      <details open className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">Encabezado OE</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label="Producto" value={h.productName} readOnly={readOnly} onChange={(v) => setHeader({ productName: v })} />
          <Field label="Código" value={h.code} readOnly={readOnly} onChange={(v) => setHeader({ code: v })} />
          <Field label="Fecha" value={h.date} readOnly={readOnly} onChange={(v) => setHeader({ date: v })} />
          <Field
            label="Cantidad Kg"
            value={h.quantityKg}
            type="number"
            readOnly={readOnly}
            onChange={(v) => setHeader({ quantityKg: v === "" ? null : Number(v) })}
          />
          <Field label="N° de Lote" value={h.lot} readOnly={readOnly} onChange={(v) => setHeader({ lot: v })} />
          <Field label="Vigencia" value={h.vigencia} readOnly={readOnly} onChange={(v) => setHeader({ vigencia: v })} />
          <Field label="Cliente" value={h.client} readOnly={readOnly} onChange={(v) => setHeader({ client: v })} />
          <Field label="Envase cúbica" value={h.envaseCubica} readOnly={readOnly} onChange={(v) => setHeader({ envaseCubica: v })} />
          <Field label="Equipo calefactor N°" value={h.equipoCalefactor} readOnly={readOnly} onChange={(v) => setHeader({ equipoCalefactor: v })} />
        </div>
      </details>

      <details open className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">Materias primas</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-[var(--os-bg-muted,#f3f3f3)] text-left">
                <th className="p-2">Materia prima</th>
                <th className="p-2">Código</th>
                <th className="p-2">Fórmula %</th>
                <th className="p-2">kg a pesar</th>
                <th className="p-2">Ajuste</th>
                <th className="p-2">Lote N.º</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {content.materials.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="p-1">
                    <input
                      disabled={readOnly}
                      value={m.materiaPrima}
                      onChange={(e) =>
                        onChange({
                          ...content,
                          materials: content.materials.map((x) =>
                            x.id === m.id ? { ...x, materiaPrima: e.target.value } : x
                          ),
                        })
                      }
                      className="w-full rounded border px-1 py-1"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      disabled={readOnly}
                      value={m.codigo}
                      onChange={(e) =>
                        onChange({
                          ...content,
                          materials: content.materials.map((x) =>
                            x.id === m.id ? { ...x, codigo: e.target.value } : x
                          ),
                        })
                      }
                      className="w-full rounded border px-1 py-1"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      disabled={readOnly}
                      value={m.formulaPct ?? ""}
                      onChange={(e) =>
                        onChange({
                          ...content,
                          materials: content.materials.map((x) =>
                            x.id === m.id
                              ? {
                                  ...x,
                                  formulaPct:
                                    e.target.value === "" ? null : Number(e.target.value),
                                }
                              : x
                          ),
                        })
                      }
                      className="w-full rounded border px-1 py-1"
                    />
                  </td>
                  <td className="p-1">{m.kgAPesar ?? "—"}</td>
                  <td className="p-1">
                    <input
                      disabled={readOnly}
                      value={m.ajuste}
                      onChange={(e) =>
                        onChange({
                          ...content,
                          materials: content.materials.map((x) =>
                            x.id === m.id ? { ...x, ajuste: e.target.value } : x
                          ),
                        })
                      }
                      className="w-full rounded border px-1 py-1"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      disabled={readOnly}
                      value={m.lote}
                      onChange={(e) =>
                        onChange({
                          ...content,
                          materials: content.materials.map((x) =>
                            x.id === m.id ? { ...x, lote: e.target.value } : x
                          ),
                        })
                      }
                      className="w-full rounded border px-1 py-1"
                    />
                  </td>
                  <td className="p-1">
                    {!readOnly && (
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
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[var(--os-text-muted)]">
          Totales: fórmula {content.totals.formulaPctSum ?? "—"}% · kg {content.totals.kgSum ?? "—"}
        </p>
        {!readOnly && (
          <button type="button" className="mt-2 text-sm text-[var(--os-teal)]" onClick={onAddMaterial}>
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
                disabled={readOnly}
                value={s.text}
                onChange={(e) =>
                  onChange({
                    ...content,
                    procedureSteps: content.procedureSteps.map((x, i) =>
                      i === idx ? { ...x, text: e.target.value } : x
                    ),
                  })
                }
                className="w-full rounded border px-2 py-1"
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
            readOnly={readOnly}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, date: v } })
            }
          />
          <Field
            label="Aspecto"
            value={content.processControl.aspecto}
            readOnly={readOnly}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, aspecto: v } })
            }
          />
          <Field
            label="Color"
            value={content.processControl.color}
            readOnly={readOnly}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, color: v } })
            }
          />
          <Field
            label="Olor"
            value={content.processControl.olor}
            readOnly={readOnly}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, olor: v } })
            }
          />
          <Field
            label="pH"
            value={content.processControl.ph}
            readOnly={readOnly}
            onChange={(v) =>
              onChange({ ...content, processControl: { ...content.processControl, ph: v } })
            }
          />
          <Field
            label="Viscosidad"
            value={content.processControl.viscosidad}
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
