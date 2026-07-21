"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  emptyOaOperario,
} from "@/lib/orders/content";
import {
  computeDesechadosAuto,
  emptyOaSimpleControl,
  emptyOaSimpleMaterial,
  listOaSimplePendingFields,
  mapOASimpleFormToLegalDocument,
  summarizeOaSimpleDerived,
  type OaSimpleForm,
  type OaSimpleMaterial,
  type OaSimpleSector,
} from "@/lib/orders/oa-simple-form";
import type { OaContent } from "@/lib/orders/types";

const STEPS = [
  { id: 1, title: "Datos generales" },
  { id: 2, title: "Materiales" },
  { id: 3, title: "Producción y controles" },
  { id: 4, title: "Revisar y entregar" },
] as const;

type OaSimpleWizardProps = {
  simple: OaSimpleForm;
  legalBase?: OaContent;
  readOnly?: boolean;
  /** Solo CODIFICADO: limita edición al bloque de codificado. */
  codificadoOnly?: boolean;
  onChange: (next: OaSimpleForm) => void;
  onRequestFullForm?: () => void;
  onPreview?: () => void;
  onSaveProgress?: () => void;
  onDeliver?: () => void;
  canDeliver?: boolean;
  canSave?: boolean;
};

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-[var(--os-text)]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[var(--os-text-muted)]">{hint}</span> : null}
    </label>
  );
}

function inputClass(readOnly?: boolean) {
  return `rounded border border-[var(--os-border)] bg-white px-2 py-1.5 text-sm ${
    readOnly ? "bg-[var(--os-surface-muted,#f3f6f8)] text-[var(--os-text-muted)]" : ""
  }`;
}

function patchMaterial(
  materials: OaSimpleMaterial[],
  id: string,
  patch: Partial<OaSimpleMaterial>
): OaSimpleMaterial[] {
  return materials.map((m) => {
    if (m.id !== id) return m;
    const next = { ...m, ...patch };
    if (!next.desechadosManual && ("recibidos" in patch || "usados" in patch)) {
      next.desechados = computeDesechadosAuto(next.recibidos, next.usados);
    }
    return next;
  });
}

export function OaSimpleWizard({
  simple,
  legalBase,
  readOnly,
  codificadoOnly,
  onChange,
  onRequestFullForm,
  onPreview,
  onSaveProgress,
  onDeliver,
  canDeliver,
  canSave,
}: OaSimpleWizardProps) {
  const [step, setStep] = useState(codificadoOnly ? 3 : 1);
  const [showDateOverrides, setShowDateOverrides] = useState(!simple.todoMismoDia);
  const [editMaterialDetails, setEditMaterialDetails] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const derived = useMemo(() => summarizeOaSimpleDerived(simple), [simple]);
  const pending = useMemo(() => listOaSimplePendingFields(simple), [simple]);
  const legalPreview = useMemo(
    () => mapOASimpleFormToLegalDocument(simple, legalBase),
    [simple, legalBase]
  );

  const set = (patch: Partial<OaSimpleForm>) => onChange({ ...simple, ...patch });

  const locked = Boolean(readOnly);

  return (
    <div className="space-y-4" data-testid="oa-simple-wizard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-teal)]">
            Paso {step} de 4
          </p>
          <h4 className="text-base font-semibold">{STEPS[step - 1].title}</h4>
          <p className="text-xs text-[var(--os-text-muted)]">
            Carga rápida · el PDF legal conserva todos los campos del documento
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRequestFullForm && (
            <Button type="button" variant="secondary" onClick={onRequestFullForm}>
              Ver formulario completo
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAdvancedOpen((v) => !v)}
            data-testid="oa-advanced-toggle"
          >
            {advancedOpen ? "Ocultar detalles" : "Editar detalles del documento"}
          </Button>
        </div>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={codificadoOnly && s.id !== 3 && s.id !== 4}
              className={`rounded-full px-3 py-1 ${
                s.id === step
                  ? "bg-[var(--os-navy,#123B5D)] text-white"
                  : "bg-[var(--os-surface-muted,#e8eef2)] text-[var(--os-text-muted)]"
              }`}
              onClick={() => setStep(s.id)}
            >
              {s.id}. {s.title}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && !codificadoOnly && (
        <section className="space-y-4 rounded border border-[var(--os-border)] p-4" data-testid="oa-step-generales">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Producto">
              <input
                className={inputClass(locked)}
                value={simple.productName}
                disabled={locked}
                onChange={(e) => set({ productName: e.target.value })}
              />
            </Field>
            <Field label="Cliente" hint="Opcional">
              <input
                className={inputClass(locked)}
                value={simple.client}
                disabled={locked}
                onChange={(e) => set({ client: e.target.value })}
              />
            </Field>
            <Field label="Código" hint="Opcional">
              <input
                className={inputClass(locked)}
                value={simple.productCode}
                disabled={locked}
                onChange={(e) => set({ productCode: e.target.value })}
              />
            </Field>
            <Field label="Lote" hint="Opcional">
              <input
                className={inputClass(locked)}
                value={simple.lot}
                disabled={locked}
                onChange={(e) => {
                  const lot = e.target.value;
                  set({
                    lot,
                    codificado: {
                      ...simple.codificado,
                      loteImpreso: simple.codificado.loteImpreso || lot,
                    },
                  });
                }}
              />
            </Field>
            <Field label="VTO" hint="Opcional">
              <input
                className={inputClass(locked)}
                value={simple.vto}
                disabled={locked}
                onChange={(e) => {
                  const vto = e.target.value;
                  set({
                    vto,
                    codificado: {
                      ...simple.codificado,
                      vencimientoImpreso: simple.codificado.vencimientoImpreso || vto,
                    },
                  });
                }}
              />
            </Field>
            <Field label="Sector">
              <select
                className={inputClass(locked)}
                value={simple.sector}
                disabled={locked}
                onChange={(e) => set({ sector: e.target.value as OaSimpleSector })}
              >
                <option value="">Sin cambiar</option>
                <option value="ENVASADO_MASIVO">Masivo</option>
                <option value="ENVASADO_PREMIUM">Premium</option>
              </select>
            </Field>
          </div>

          <div className="rounded border border-[var(--os-border)] bg-[var(--os-surface-muted,#f4f8fa)] p-3">
            <Field
              label="Fecha de la jornada"
              hint="Se propaga automáticamente a emisión, materiales, envasado, controles y codificado."
            >
              <input
                type="date"
                className={inputClass(locked)}
                value={simple.fechaJornada}
                disabled={locked}
                data-testid="oa-fecha-jornada"
                onChange={(e) => set({ fechaJornada: e.target.value })}
              />
            </Field>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={simple.todoMismoDia}
                disabled={locked}
                data-testid="oa-todo-mismo-dia"
                onChange={(e) => {
                  const todoMismoDia = e.target.checked;
                  set({ todoMismoDia });
                  setShowDateOverrides(!todoMismoDia);
                }}
              />
              ¿Todo se realizó el mismo día?
            </label>
            {!simple.todoMismoDia && (
              <div className="mt-3 grid gap-2 md:grid-cols-2" data-testid="oa-fechas-especificas">
                {(
                  [
                    ["emision", "Fecha de emisión"],
                    ["materiales", "Fecha materiales"],
                    ["inicio", "Fecha inicio envasado"],
                    ["terminacion", "Fecha terminación"],
                    ["rendimientos", "Fecha unidades"],
                    ["controles", "Fecha controles"],
                    ["codificado", "Fecha codificado"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label} hint="Usar fecha de la jornada si se deja vacío">
                    <input
                      type="date"
                      className={inputClass(locked)}
                      value={simple.fechas[key]}
                      disabled={locked}
                      onChange={(e) =>
                        set({
                          fechas: { ...simple.fechas, [key]: e.target.value },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
            {showDateOverrides && simple.todoMismoDia ? null : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Producción teórica (unidades)">
              <input
                type="number"
                className={inputClass(locked)}
                value={simple.produccionTeoricaUnidades ?? ""}
                disabled={locked}
                onChange={(e) =>
                  set({
                    produccionTeoricaUnidades:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Contenido teórico">
              <input
                className={inputClass(locked)}
                value={simple.contenidoTeorico}
                disabled={locked}
                onChange={(e) => set({ contenidoTeorico: e.target.value })}
              />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Operarios intervinientes</p>
            <div className="space-y-2">
              {simple.operarios.map((op) => (
                <div key={op.id} className="flex flex-wrap gap-2">
                  <input
                    className={`${inputClass(locked)} min-w-[180px] flex-1`}
                    placeholder="Nombre"
                    value={op.nombre}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        operarios: simple.operarios.map((o) =>
                          o.id === op.id ? { ...o, nombre: e.target.value } : o
                        ),
                      })
                    }
                  />
                  <input
                    className={`${inputClass(locked)} w-40`}
                    placeholder="Sector"
                    value={op.sector}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        operarios: simple.operarios.map((o) =>
                          o.id === op.id ? { ...o, sector: e.target.value } : o
                        ),
                      })
                    }
                  />
                  {!locked && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        set({
                          operarios: simple.operarios.filter((o) => o.id !== op.id),
                        })
                      }
                    >
                      Quitar
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {!locked && (
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => set({ operarios: [...simple.operarios, emptyOaOperario()] })}
              >
                Agregar operario
              </Button>
            )}
            <p className="mt-2 text-xs text-[var(--os-text-muted)]">
              Se usan como responsables predeterminados en materiales, controles y codificado.
              Firmas del PDF quedan vacías para firma física.
            </p>
            {(advancedOpen || simple.responsableGeneral) && (
              <Field label="Cambiar responsable general" hint="Opcional · prioridad sobre operarios">
                <input
                  className={inputClass(locked)}
                  value={simple.responsableGeneral}
                  disabled={locked}
                  onChange={(e) => set({ responsableGeneral: e.target.value })}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Hora de inicio" hint="Opcional">
              <input
                type="time"
                className={inputClass(locked)}
                value={simple.horaInicio}
                disabled={locked}
                onChange={(e) => set({ horaInicio: e.target.value })}
              />
            </Field>
            <Field label="Hora de terminación" hint="Opcional">
              <input
                type="time"
                className={inputClass(locked)}
                value={simple.horaTerminacion}
                disabled={locked}
                onChange={(e) => set({ horaTerminacion: e.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={simple.terminoOtroDia}
              disabled={locked}
              onChange={(e) => set({ terminoOtroDia: e.target.checked })}
            />
            Terminó otro día
          </label>
          {simple.terminoOtroDia && (
            <Field label="Fecha de terminación">
              <input
                type="date"
                className={inputClass(locked)}
                value={simple.fechas.terminacion}
                disabled={locked}
                onChange={(e) =>
                  set({ fechas: { ...simple.fechas, terminacion: e.target.value } })
                }
              />
            </Field>
          )}
        </section>
      )}

      {step === 2 && !codificadoOnly && (
        <section className="space-y-3 rounded border border-[var(--os-border)] p-4" data-testid="oa-step-materiales">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--os-text-muted)]">
              Fecha y responsable se completan solos desde la jornada
              {derived.responsable ? ` (${derived.responsable})` : ""}.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditMaterialDetails((v) => !v)}
            >
              {editMaterialDetails ? "Ocultar detalles" : "Editar detalles"}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--os-surface-muted,#e8eef2)] text-left">
                  <th className="border px-2 py-1">Insumo</th>
                  <th className="border px-2 py-1">Código</th>
                  <th className="border px-2 py-1">Recibidos</th>
                  <th className="border px-2 py-1">Usados</th>
                  <th className="border px-2 py-1">Desechados</th>
                  {editMaterialDetails && (
                    <>
                      <th className="border px-2 py-1">Fecha</th>
                      <th className="border px-2 py-1">Responsable</th>
                    </>
                  )}
                  <th className="border px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {simple.materials.map((m) => (
                  <tr key={m.id}>
                    <td className="border px-1 py-1">
                      <input
                        className={inputClass(locked)}
                        value={m.nombreInsumo}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            materials: patchMaterial(simple.materials, m.id, {
                              nombreInsumo: e.target.value,
                            }),
                          })
                        }
                      />
                    </td>
                    <td className="border px-1 py-1">
                      <input
                        className={inputClass(locked)}
                        value={m.codigo}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            materials: patchMaterial(simple.materials, m.id, {
                              codigo: e.target.value,
                            }),
                          })
                        }
                      />
                    </td>
                    <td className="border px-1 py-1">
                      <input
                        className={inputClass(locked)}
                        value={m.recibidos}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            materials: patchMaterial(simple.materials, m.id, {
                              recibidos: e.target.value,
                            }),
                          })
                        }
                      />
                    </td>
                    <td className="border px-1 py-1">
                      <input
                        className={inputClass(locked)}
                        value={m.usados}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            materials: patchMaterial(simple.materials, m.id, {
                              usados: e.target.value,
                            }),
                          })
                        }
                      />
                    </td>
                    <td className="border px-1 py-1">
                      <input
                        className={inputClass(locked)}
                        value={m.desechados}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            materials: patchMaterial(simple.materials, m.id, {
                              desechados: e.target.value,
                              desechadosManual: true,
                            }),
                          })
                        }
                      />
                      {m.desechadosManual && (
                        <input
                          className={`${inputClass(locked)} mt-1 w-full`}
                          placeholder="Motivo del ajuste"
                          value={m.observacionDesechados}
                          disabled={locked}
                          onChange={(e) =>
                            set({
                              materials: patchMaterial(simple.materials, m.id, {
                                observacionDesechados: e.target.value,
                              }),
                            })
                          }
                        />
                      )}
                    </td>
                    {editMaterialDetails && (
                      <>
                        <td className="border px-1 py-1">
                          <input
                            type="date"
                            className={inputClass(locked)}
                            value={m.fechaOverride}
                            disabled={locked}
                            onChange={(e) =>
                              set({
                                materials: patchMaterial(simple.materials, m.id, {
                                  fechaOverride: e.target.value,
                                }),
                              })
                            }
                          />
                        </td>
                        <td className="border px-1 py-1">
                          <input
                            className={inputClass(locked)}
                            placeholder="Cambiar responsable"
                            value={m.responsableOverride}
                            disabled={locked}
                            onChange={(e) =>
                              set({
                                materials: patchMaterial(simple.materials, m.id, {
                                  responsableOverride: e.target.value,
                                }),
                              })
                            }
                          />
                        </td>
                      </>
                    )}
                    <td className="border px-1 py-1">
                      {!locked && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            set({
                              materials: simple.materials.filter((x) => x.id !== m.id),
                            })
                          }
                        >
                          Quitar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!locked && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                set({ materials: [...simple.materials, emptyOaSimpleMaterial()] })
              }
            >
              Agregar material
            </Button>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4 rounded border border-[var(--os-border)] p-4" data-testid="oa-step-produccion">
          {!codificadoOnly && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Total de unidades llenadas">
                  <input
                    type="number"
                    className={inputClass(locked)}
                    value={simple.totalUnidadesLlenadas ?? ""}
                    disabled={locked}
                    data-testid="oa-total-llenadas"
                    onChange={(e) =>
                      set({
                        totalUnidadesLlenadas:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Unidades desechadas">
                  <input
                    type="number"
                    className={inputClass(locked)}
                    value={simple.unidadesDesechadas ?? ""}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        unidadesDesechadas:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Producción teórica">
                  <input
                    type="number"
                    className={inputClass(locked)}
                    value={simple.produccionTeoricaUnidades ?? ""}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        produccionTeoricaUnidades:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Contenido teórico">
                  <input
                    className={inputClass(locked)}
                    value={simple.contenidoTeorico}
                    disabled={locked}
                    onChange={(e) => set({ contenidoTeorico: e.target.value })}
                  />
                </Field>
              </div>

              <div
                className="grid gap-2 rounded border border-[var(--os-border)] bg-[var(--os-surface-muted,#f4f8fa)] p-3 text-sm md:grid-cols-4"
                data-testid="oa-rendimiento-live"
              >
                <span>Llenadas: {simple.totalUnidadesLlenadas ?? "—"}</span>
                <span>Desechadas: {simple.unidadesDesechadas ?? "—"}</span>
                <span>Aceptadas: {derived.aceptadas ?? "—"}</span>
                <span>
                  Rendimiento: {derived.rendimientoA ?? "—"}%{" "}
                  {derived.enRango == null
                    ? ""
                    : derived.enRango
                      ? "(dentro 95–101%)"
                      : "(fuera de rango)"}
                </span>
              </div>

              <Field label="Observaciones">
                <textarea
                  className={inputClass(locked)}
                  rows={3}
                  value={simple.observaciones}
                  disabled={locked}
                  onChange={(e) => set({ observaciones: e.target.value })}
                />
              </Field>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={simple.registrarPorTandas}
                  disabled={locked}
                  data-testid="oa-por-tandas"
                  onChange={(e) => set({ registrarPorTandas: e.target.checked })}
                />
                Registrar producción por tandas o momentos
              </label>
              {simple.registrarPorTandas && (
                <div className="space-y-2" data-testid="oa-tandas-table">
                  {simple.tandas.map((t) => (
                    <div key={t.id} className="flex flex-wrap gap-2">
                      <input
                        type="date"
                        className={inputClass(locked)}
                        value={t.fecha}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            tandas: simple.tandas.map((x) =>
                              x.id === t.id ? { ...x, fecha: e.target.value } : x
                            ),
                          })
                        }
                      />
                      <input
                        type="number"
                        className={inputClass(locked)}
                        placeholder="Cantidad"
                        value={t.cantidadUnidades ?? ""}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            tandas: simple.tandas.map((x) =>
                              x.id === t.id
                                ? {
                                    ...x,
                                    cantidadUnidades:
                                      e.target.value === "" ? null : Number(e.target.value),
                                  }
                                : x
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  {!locked && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        set({
                          tandas: [
                            ...simple.tandas,
                            { id: crypto.randomUUID(), fecha: "", cantidadUnidades: null },
                          ],
                        })
                      }
                    >
                      Agregar tanda
                    </Button>
                  )}
                </div>
              )}

              <div className="rounded border border-[var(--os-border)] p-3">
                <p className="mb-2 text-sm font-semibold">Control de peso/volumen</p>
                <p className="mb-2 text-xs text-[var(--os-text-muted)]">{simple.limiteTexto}</p>
                {simple.controles.map((c, idx) => (
                  <div key={c.id} className="mb-3 grid gap-2 md:grid-cols-4">
                    <Field label={idx === 0 ? "Valor inicial" : `Inicial #${idx + 1}`}>
                      <input
                        className={inputClass(locked)}
                        value={c.inicio}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            controles: simple.controles.map((x) =>
                              x.id === c.id ? { ...x, inicio: e.target.value } : x
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Valor medio">
                      <input
                        className={inputClass(locked)}
                        value={c.medio}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            controles: simple.controles.map((x) =>
                              x.id === c.id ? { ...x, medio: e.target.value } : x
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Valor final">
                      <input
                        className={inputClass(locked)}
                        value={c.final}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            controles: simple.controles.map((x) =>
                              x.id === c.id ? { ...x, final: e.target.value } : x
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Resultado">
                      <select
                        className={inputClass(locked)}
                        value={c.resultado}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            controles: simple.controles.map((x) =>
                              x.id === c.id
                                ? {
                                    ...x,
                                    resultado: e.target.value as typeof c.resultado,
                                  }
                                : x
                            ),
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="CONFORME">Conforme</option>
                        <option value="NO_CONFORME">No conforme</option>
                      </select>
                    </Field>
                    <Field label="Observación (opcional)">
                      <input
                        className={inputClass(locked)}
                        value={c.observacion}
                        disabled={locked}
                        onChange={(e) =>
                          set({
                            controles: simple.controles.map((x) =>
                              x.id === c.id ? { ...x, observacion: e.target.value } : x
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                ))}
                {!locked && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      set({ controles: [...simple.controles, emptyOaSimpleControl()] })
                    }
                  >
                    Agregar otro control
                  </Button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Análisis de granel — resultado">
                  <input
                    className={inputClass(locked)}
                    value={simple.analisisGranel.resultado}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        analisisGranel: {
                          ...simple.analisisGranel,
                          resultado: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Estado granel">
                  <select
                    className={inputClass(locked)}
                    value={simple.analisisGranel.estado}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        analisisGranel: {
                          ...simple.analisisGranel,
                          estado: e.target.value as typeof simple.analisisGranel.estado,
                        },
                      })
                    }
                  >
                    <option value="">—</option>
                    <option value="APROBADO">Aprobado</option>
                    <option value="NO_APROBADO">No aprobado</option>
                    <option value="NO_INFORMADO">No informado</option>
                  </select>
                </Field>
                <Field label="Análisis producto terminado — resultado">
                  <input
                    className={inputClass(locked)}
                    value={simple.analisisPt.resultado}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        analisisPt: { ...simple.analisisPt, resultado: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Estado PT">
                  <select
                    className={inputClass(locked)}
                    value={simple.analisisPt.estado}
                    disabled={locked}
                    onChange={(e) =>
                      set({
                        analisisPt: {
                          ...simple.analisisPt,
                          estado: e.target.value as typeof simple.analisisPt.estado,
                        },
                      })
                    }
                  >
                    <option value="">—</option>
                    <option value="APROBADO">Aprobado</option>
                    <option value="NO_APROBADO">No aprobado</option>
                    <option value="NO_INFORMADO">No informado</option>
                  </select>
                </Field>
              </div>
            </>
          )}

          <div className="rounded border border-[var(--os-border)] p-3" data-testid="oa-codificado-block">
            <p className="mb-2 text-sm font-semibold">Codificado</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Lote impreso" hint="Opcional · por defecto el lote general">
                <input
                  className={inputClass(readOnly && !codificadoOnly)}
                  value={simple.codificado.loteImpreso}
                  disabled={readOnly && !codificadoOnly}
                  onChange={(e) =>
                    set({
                      codificado: { ...simple.codificado, loteImpreso: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Vencimiento impreso" hint="Opcional · por defecto VTO">
                <input
                  className={inputClass(readOnly && !codificadoOnly)}
                  value={simple.codificado.vencimientoImpreso}
                  disabled={readOnly && !codificadoOnly}
                  onChange={(e) =>
                    set({
                      codificado: {
                        ...simple.codificado,
                        vencimientoImpreso: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Resultado">
                <select
                  className={inputClass(readOnly && !codificadoOnly)}
                  value={simple.codificado.resultado}
                  disabled={readOnly && !codificadoOnly}
                  onChange={(e) =>
                    set({
                      codificado: {
                        ...simple.codificado,
                        resultado: e.target.value as typeof simple.codificado.resultado,
                      },
                    })
                  }
                >
                  <option value="">—</option>
                  <option value="CONFORME">Conforme</option>
                  <option value="NO_CONFORME">No conforme</option>
                </select>
              </Field>
              <Field label="Observaciones">
                <input
                  className={inputClass(readOnly && !codificadoOnly)}
                  value={simple.codificado.observaciones}
                  disabled={readOnly && !codificadoOnly}
                  onChange={(e) =>
                    set({
                      codificado: {
                        ...simple.codificado,
                        observaciones: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-3 rounded border border-[var(--os-border)] p-4" data-testid="oa-step-revisar">
          <h4 className="font-semibold">Resumen</h4>
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--os-text-muted)]">Producto</dt>
              <dd>{simple.productName || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Lote</dt>
              <dd>{simple.lot || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Fecha de jornada</dt>
              <dd data-testid="oa-review-fecha">{simple.fechaJornada || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Operarios</dt>
              <dd>
                {simple.operarios
                  .map((o) => o.nombre)
                  .filter(Boolean)
                  .join(", ") || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Materiales con datos</dt>
              <dd>
                {simple.materials.filter((m) => m.nombreInsumo || m.recibidos || m.usados).length}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Unidades llenadas / aceptadas</dt>
              <dd>
                {simple.totalUnidadesLlenadas ?? "—"} / {derived.aceptadas ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Rendimiento</dt>
              <dd>
                {derived.rendimientoA ?? "—"}%
                {derived.enRango == null
                  ? ""
                  : derived.enRango
                    ? " · dentro de rango"
                    : " · fuera de rango"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Controles cargados</dt>
              <dd>
                {simple.controles.filter((c) => c.inicio || c.medio || c.final).length}
              </dd>
            </div>
          </dl>

          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <p className="font-medium">Campos pendientes</p>
            {pending.length === 0 ? (
              <p>Ninguno crítico.</p>
            ) : (
              <ul className="list-disc pl-5">
                {pending.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded border border-[var(--os-border)] bg-[var(--os-surface-muted,#f4f8fa)] p-3 text-xs">
            <p className="mb-1 font-semibold">Propagación al PDF (vista rápida)</p>
            <p>
              Emisión / materiales / inicio / controles / codificado →{" "}
              <strong>{legalPreview.header.fechaEmision || "—"}</strong>
            </p>
            <p>
              Responsable materiales →{" "}
              <strong>{legalPreview.materials[0]?.responsable || "—"}</strong>
            </p>
            <p>
              Fila automática de unidades →{" "}
              <strong>
                {legalPreview.rendimientos.cargasParciales[0]?.fecha || "—"} ·{" "}
                {legalPreview.rendimientos.cargasParciales[0]?.cantidadUnidades ?? "—"}
              </strong>
            </p>
          </div>
        </section>
      )}

      {advancedOpen && !codificadoOnly && (
        <section
          className="space-y-3 rounded border border-dashed border-[var(--os-border)] p-4"
          data-testid="oa-advanced-panel"
        >
          <h4 className="text-sm font-semibold">Detalles del documento</h4>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Análisis (encabezado)">
              <input
                className={inputClass(locked)}
                value={simple.analisis}
                disabled={locked}
                onChange={(e) => set({ analisis: e.target.value })}
              />
            </Field>
            <Field label="Aprobó">
              <input
                className={inputClass(locked)}
                value={simple.aprobo}
                disabled={locked}
                onChange={(e) => set({ aprobo: e.target.value })}
              />
            </Field>
            <Field label="Límite control peso">
              <input
                className={inputClass(locked)}
                value={simple.limiteTexto}
                disabled={locked}
                onChange={(e) =>
                  set({
                    limiteTexto: e.target.value as OaSimpleForm["limiteTexto"],
                  })
                }
              />
            </Field>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[var(--os-border)] pt-3">
        <Button
          type="button"
          variant="secondary"
          disabled={step <= 1 || (codificadoOnly && step <= 3)}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
        >
          Anterior
        </Button>
        {canSave && onSaveProgress && (
          <Button type="button" variant="secondary" onClick={onSaveProgress}>
            Guardar avance
          </Button>
        )}
        {step < 4 ? (
          <Button type="button" onClick={() => setStep((s) => Math.min(4, s + 1))}>
            Siguiente
          </Button>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              Corregir
            </Button>
            {onPreview && (
              <Button type="button" variant="secondary" onClick={onPreview}>
                Vista previa PDF
              </Button>
            )}
            {canDeliver && onDeliver && (
              <Button type="button" onClick={onDeliver} data-testid="oa-wizard-entregar">
                Entregar
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
