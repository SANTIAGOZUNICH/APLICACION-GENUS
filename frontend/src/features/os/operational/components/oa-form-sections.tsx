"use client";

import type { OaContent } from "@/lib/orders/types";
import { OA_ETIQUETADO_LEGAL_TEXT } from "@/lib/orders/types";
import {
  emptyOaCarga,
  emptyOaMaterial,
  emptyOaOperario,
  emptyOaPesoFila,
  rendimientoDentroDeRango,
} from "@/lib/orders/content";

interface OaFormSectionsProps {
  content: OaContent;
  readOnly: boolean;
  codificadoOnly?: boolean;
  onChange: (next: OaContent) => void;
  onAddMaterial: () => void;
  onRemoveMaterial?: (id: string) => void;
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
  onRemoveMaterial,
}: OaFormSectionsProps) {
  const structureLocked = readOnly || codificadoOnly;
  const h = content.header;
  const enRango = rendimientoDentroDeRango(content.rendimientos.rendimientoA);

  return (
    <div className="space-y-4" data-testid="oa-form-sections">
      <details open={!codificadoOnly} className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">
          ORDEN DE ACONDICIONAMIENTO — Encabezado
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label="PRODUCTO" value={h.productName} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, productName: v } })} />
          <Field label="CLIENTE" value={h.client} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, client: v } })} />
          <Field label="LOTE" value={h.lot} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, lot: v } })} />
          <Field label="ANÁLISIS" value={h.analisis} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, analisis: v } })} />
          <Field label="CÓDIGO PRODUCTO" value={h.productCode} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, productCode: v } })} />
          <Field label="VTO." value={h.vto} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, vto: v } })} />
          <Field label="APROBÓ" value={h.aprobo} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, aprobo: v } })} />
          <Field label="FECHA DE EMISIÓN" value={h.fechaEmision} readOnly={structureLocked} onChange={(v) => onChange({ ...content, header: { ...h, fechaEmision: v } })} />
        </div>
      </details>

      {!codificadoOnly && (
        <>
          <details open className="rounded border border-[var(--os-border)] p-3">
            <summary className="cursor-pointer font-medium">ANÁLISIS DE GRANEL</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Field
                label="RESULTADO"
                value={content.analisisGranel.resultado}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({
                    ...content,
                    analisisGranel: {
                      ...content.analisisGranel,
                      resultado: v,
                      aprobado: /aprob/i.test(v) ? true : content.analisisGranel.aprobado,
                    },
                  })
                }
              />
              <label className="flex items-end gap-2 text-xs">
                <input
                  type="checkbox"
                  disabled={structureLocked}
                  checked={content.analisisGranel.aprobado === true}
                  onChange={(e) =>
                    onChange({
                      ...content,
                      analisisGranel: {
                        ...content.analisisGranel,
                        aprobado: e.target.checked,
                        resultado: e.target.checked
                          ? content.analisisGranel.resultado || "APROBADO"
                          : content.analisisGranel.resultado,
                      },
                    })
                  }
                />
                APROBADO
              </label>
            </div>
            <p className="mt-2 text-xs text-[var(--os-text-muted)]">FIRMA: vacía (física post-impresión).</p>
          </details>

          <details open className="rounded border border-[var(--os-border)] p-3">
            <summary className="cursor-pointer font-medium">
              SUMINISTRO DE MATERIALES DE ACONDICIONAMIENTO
            </summary>
            <div className="mt-2 max-w-xs">
              <Field
                label="FECHA"
                value={content.materialsFecha}
                readOnly={structureLocked}
                onChange={(v) => onChange({ ...content, materialsFecha: v })}
              />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs" data-testid="oa-materials-table">
                <thead>
                  <tr className="bg-[var(--os-bg-muted,#f3f3f3)] text-left">
                    {["N.º", "Código", "Nombre del insumo", "Recibidos", "Desechados", "Usados", "Fecha", "Responsable", ""].map(
                      (x) => (
                        <th key={x || "x"} className="p-2">
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
                      <td className="p-1">
                        {!structureLocked && onRemoveMaterial && content.materials.length > 1 && (
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
            {!structureLocked && (
              <button
                type="button"
                className="mt-2 text-sm text-[var(--os-teal)]"
                onClick={onAddMaterial}
                data-testid="oa-add-material"
              >
                + Agregar material
              </button>
            )}
          </details>

          <details open className="rounded border border-[var(--os-border)] p-3">
            <summary className="cursor-pointer font-medium">ENVASADO</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Field
                label="FECHA DE INICIO"
                value={content.envasado.fechaInicio}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({ ...content, envasado: { ...content.envasado, fechaInicio: v } })
                }
              />
              <Field
                label="FECHA DE TERMINACIÓN"
                value={content.envasado.fechaTerminacion}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({
                    ...content,
                    envasado: { ...content.envasado, fechaTerminacion: v },
                  })
                }
              />
            </div>
            <h4 className="mt-3 text-xs font-semibold">OPERARIOS INTERVINIENTES</h4>
            <ul className="mt-2 space-y-2">
              {(content.envasado.operariosList ?? []).map((op) => (
                <li key={op.id} className="grid gap-2 sm:grid-cols-3">
                  <Field
                    label="Nombre"
                    value={op.nombre}
                    readOnly={structureLocked}
                    onChange={(v) =>
                      onChange({
                        ...content,
                        envasado: {
                          ...content.envasado,
                          operariosList: content.envasado.operariosList.map((x) =>
                            x.id === op.id ? { ...x, nombre: v } : x
                          ),
                        },
                      })
                    }
                  />
                  <Field
                    label="Sector"
                    value={op.sector}
                    readOnly={structureLocked}
                    onChange={(v) =>
                      onChange({
                        ...content,
                        envasado: {
                          ...content.envasado,
                          operariosList: content.envasado.operariosList.map((x) =>
                            x.id === op.id ? { ...x, sector: v } : x
                          ),
                        },
                      })
                    }
                  />
                  {!structureLocked && (
                    <button
                      type="button"
                      className="self-end text-xs text-rose-700"
                      onClick={() =>
                        onChange({
                          ...content,
                          envasado: {
                            ...content.envasado,
                            operariosList: content.envasado.operariosList.filter(
                              (x) => x.id !== op.id
                            ),
                          },
                        })
                      }
                    >
                      Quitar
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!structureLocked && (
              <button
                type="button"
                className="mt-2 text-sm text-[var(--os-teal)]"
                onClick={() =>
                  onChange({
                    ...content,
                    envasado: {
                      ...content.envasado,
                      operariosList: [
                        ...(content.envasado.operariosList ?? []),
                        emptyOaOperario(),
                      ],
                    },
                  })
                }
              >
                + Agregar operario
              </button>
            )}
          </details>

          <details open className="rounded border border-[var(--os-border)] p-3">
            <summary className="cursor-pointer font-medium">RENDIMIENTOS</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field
                label="PRODUCCIÓN TEÓRICA (unidades)"
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
                label="CONTENIDO TEÓRICO"
                value={content.rendimientos.contenidoTeorico}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({
                    ...content,
                    rendimientos: { ...content.rendimientos, contenidoTeorico: v },
                  })
                }
              />
              <Field
                label="Unidades desechadas"
                type="number"
                value={content.rendimientos.unidadesDesechadas}
                readOnly={structureLocked}
                onChange={(v) =>
                  onChange({
                    ...content,
                    rendimientos: {
                      ...content.rendimientos,
                      unidadesDesechadas: v === "" ? null : Number(v),
                    },
                  })
                }
              />
            </div>
            <h4 className="mt-3 text-xs font-semibold">Cargas parciales — Fecha / Cant. Unidades</h4>
            <table className="mt-2 min-w-full text-xs" data-testid="oa-cargas-table">
              <thead>
                <tr className="bg-[var(--os-bg-muted,#f3f3f3)] text-left">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Cantidad de unidades</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {(content.rendimientos.cargasParciales ?? []).map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-1">
                      <input
                        disabled={structureLocked}
                        value={c.fecha}
                        onChange={(e) =>
                          onChange({
                            ...content,
                            rendimientos: {
                              ...content.rendimientos,
                              cargasParciales: content.rendimientos.cargasParciales.map((x) =>
                                x.id === c.id ? { ...x, fecha: e.target.value } : x
                              ),
                            },
                          })
                        }
                        className="w-full rounded border px-1 py-1"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        disabled={structureLocked}
                        value={c.cantidadUnidades ?? ""}
                        onChange={(e) =>
                          onChange({
                            ...content,
                            rendimientos: {
                              ...content.rendimientos,
                              cargasParciales: content.rendimientos.cargasParciales.map((x) =>
                                x.id === c.id
                                  ? {
                                      ...x,
                                      cantidadUnidades:
                                        e.target.value === "" ? null : Number(e.target.value),
                                    }
                                  : x
                              ),
                            },
                          })
                        }
                        className="w-full rounded border px-1 py-1"
                      />
                    </td>
                    <td className="p-1">
                      {!structureLocked && (
                        <button
                          type="button"
                          className="text-rose-700"
                          onClick={() =>
                            onChange({
                              ...content,
                              rendimientos: {
                                ...content.rendimientos,
                                cargasParciales: content.rendimientos.cargasParciales.filter(
                                  (x) => x.id !== c.id
                                ),
                              },
                            })
                          }
                        >
                          Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!structureLocked && (
              <button
                type="button"
                className="mt-2 text-sm text-[var(--os-teal)]"
                onClick={() =>
                  onChange({
                    ...content,
                    rendimientos: {
                      ...content.rendimientos,
                      cargasParciales: [
                        ...(content.rendimientos.cargasParciales ?? []),
                        emptyOaCarga(),
                      ],
                    },
                  })
                }
              >
                + Agregar carga parcial
              </button>
            )}
            <div
              className="mt-3 grid gap-1 text-xs sm:grid-cols-2"
              data-testid="oa-rendimiento-summary"
            >
              <span>TOTAL UNIDADES LLENADAS: {content.rendimientos.cantidadUnidades ?? "—"}</span>
              <span>TOTAL UNIDADES DESECHADAS: {content.rendimientos.unidadesDesechadas ?? "—"}</span>
              <span>TOTAL UNIDADES ACEPTADAS: {content.rendimientos.unidadesAceptadas ?? "—"}</span>
              <span>
                RENDIMIENTO A: {content.rendimientos.rendimientoA ?? "—"}% (teórico{" "}
                {content.rendimientos.rangoTeorico})
                {enRango === true && (
                  <span className="ml-2 text-emerald-700">dentro de rango</span>
                )}
                {enRango === false && (
                  <span className="ml-2 text-rose-700">fuera de rango</span>
                )}
              </span>
            </div>
            <label className="mt-3 block text-xs">
              OBSERVACIONES
              <textarea
                disabled={structureLocked}
                value={content.observaciones}
                onChange={(e) => onChange({ ...content, observaciones: e.target.value })}
                className="mt-1 min-h-24 w-full rounded border px-2 py-1 text-sm"
              />
            </label>
          </details>

          <details open className="rounded border border-[var(--os-border)] p-3">
            <summary className="cursor-pointer font-medium">
              CONTROLES EN PROCESO — Control de peso/volumen
            </summary>
            <p className="mt-2 text-xs">
              CONTROL ENVASAMIENTO · {content.controlesPeso.limiteTexto}
            </p>
            <table className="mt-2 min-w-full text-xs" data-testid="oa-peso-table">
              <thead>
                <tr className="bg-[var(--os-bg-muted,#f3f3f3)] text-left">
                  {["FECHA", "INICIO", "FIRMA", "MEDIO", "FIRMA", "FINAL", "FIRMA"].map((x, i) => (
                    <th key={`${x}-${i}`} className="p-2">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(content.controlesPeso.filas ?? []).map((f) => (
                  <tr key={f.id} className="border-t">
                    {(["fecha", "inicio"] as const).map((key) => (
                      <td key={key} className="p-1">
                        <input
                          disabled={structureLocked}
                          value={f[key]}
                          onChange={(e) =>
                            onChange({
                              ...content,
                              controlesPeso: {
                                ...content.controlesPeso,
                                filas: content.controlesPeso.filas.map((x) =>
                                  x.id === f.id ? { ...x, [key]: e.target.value } : x
                                ),
                              },
                            })
                          }
                          className="w-full rounded border px-1 py-1"
                        />
                      </td>
                    ))}
                    <td className="p-1 text-[var(--os-text-muted)]">—</td>
                    <td className="p-1">
                      <input
                        disabled={structureLocked}
                        value={f.medio}
                        onChange={(e) =>
                          onChange({
                            ...content,
                            controlesPeso: {
                              ...content.controlesPeso,
                              filas: content.controlesPeso.filas.map((x) =>
                                x.id === f.id ? { ...x, medio: e.target.value } : x
                              ),
                            },
                          })
                        }
                        className="w-full rounded border px-1 py-1"
                      />
                    </td>
                    <td className="p-1 text-[var(--os-text-muted)]">—</td>
                    <td className="p-1">
                      <input
                        disabled={structureLocked}
                        value={f.final}
                        onChange={(e) =>
                          onChange({
                            ...content,
                            controlesPeso: {
                              ...content.controlesPeso,
                              filas: content.controlesPeso.filas.map((x) =>
                                x.id === f.id ? { ...x, final: e.target.value } : x
                              ),
                            },
                          })
                        }
                        className="w-full rounded border px-1 py-1"
                      />
                    </td>
                    <td className="p-1 text-[var(--os-text-muted)]">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!structureLocked && (
              <button
                type="button"
                className="mt-2 text-sm text-[var(--os-teal)]"
                onClick={() =>
                  onChange({
                    ...content,
                    controlesPeso: {
                      ...content.controlesPeso,
                      filas: [...(content.controlesPeso.filas ?? []), emptyOaPesoFila()],
                    },
                  })
                }
              >
                + Agregar fila de control
              </button>
            )}
            <p className="mt-2 text-[10px] text-[var(--os-text-muted)]">
              Las columnas FIRMA quedan vacías en el PDF para firma física.
            </p>
          </details>
        </>
      )}

      <details open className="rounded border border-[var(--os-border)] p-3">
        <summary className="cursor-pointer font-medium">
          CONTROLES EN PROCESO — Etiquetado / Codificado
        </summary>
        <p className="mt-2 rounded bg-[var(--os-bg-muted,#f5f5f5)] p-2 text-xs">
          {OA_ETIQUETADO_LEGAL_TEXT}
        </p>
        <p className="mt-1 text-[10px] text-[var(--os-text-muted)]">
          Texto legal bloqueado — no editable desde una orden común.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field
            label="Lote codificado"
            value={content.etiquetadoCodificado.loteCodificado}
            readOnly={readOnly && !codificadoOnly}
            onChange={(v) =>
              onChange({
                ...content,
                etiquetadoCodificado: { ...content.etiquetadoCodificado, loteCodificado: v },
              })
            }
          />
          <Field
            label="Vencimiento codificado"
            value={content.etiquetadoCodificado.vencimientoCodificado}
            readOnly={readOnly && !codificadoOnly}
            onChange={(v) =>
              onChange({
                ...content,
                etiquetadoCodificado: {
                  ...content.etiquetadoCodificado,
                  vencimientoCodificado: v,
                },
              })
            }
          />
          <Field
            label="Fecha del control"
            value={content.etiquetadoCodificado.fechaControl}
            readOnly={readOnly && !codificadoOnly}
            onChange={(v) =>
              onChange({
                ...content,
                etiquetadoCodificado: { ...content.etiquetadoCodificado, fechaControl: v },
              })
            }
          />
          <Field
            label="Responsable"
            value={content.etiquetadoCodificado.responsable}
            readOnly={readOnly && !codificadoOnly}
            onChange={(v) =>
              onChange({
                ...content,
                etiquetadoCodificado: { ...content.etiquetadoCodificado, responsable: v },
              })
            }
          />
          <Field
            label="Observaciones"
            value={content.etiquetadoCodificado.observaciones}
            readOnly={readOnly && !codificadoOnly}
            onChange={(v) =>
              onChange({
                ...content,
                etiquetadoCodificado: { ...content.etiquetadoCodificado, observaciones: v },
              })
            }
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--os-text-muted)]">Resultado</span>
            <select
              disabled={readOnly && !codificadoOnly}
              value={content.etiquetadoCodificado.resultado}
              onChange={(e) =>
                onChange({
                  ...content,
                  etiquetadoCodificado: {
                    ...content.etiquetadoCodificado,
                    resultado: e.target.value as "" | "CONFORME" | "NO_CONFORME",
                  },
                })
              }
              className="rounded border px-2 py-1.5"
            >
              <option value="">—</option>
              <option value="CONFORME">Conforme</option>
              <option value="NO_CONFORME">No conforme</option>
            </select>
          </label>
        </div>
      </details>

      {!codificadoOnly && (
        <details className="rounded border border-[var(--os-border)] p-3">
          <summary className="cursor-pointer font-medium">ANÁLISIS DE PRODUCTO TERMINADO</summary>
          <Field
            label="RESULTADO"
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
            FIRMA / AUTORIZACIÓN PRODUCCIÓN / CONTROL CALIDAD / DIRECCIÓN TÉCNICA: espacios vacíos
            para firma física.
          </p>
        </details>
      )}
    </div>
  );
}

// keep helper used by parent for renumber
export function renumberOaMaterials(content: OaContent): OaContent {
  return {
    ...content,
    materials: content.materials.map((m, i) => ({ ...m, nro: i + 1 })),
  };
}

void emptyOaMaterial;
