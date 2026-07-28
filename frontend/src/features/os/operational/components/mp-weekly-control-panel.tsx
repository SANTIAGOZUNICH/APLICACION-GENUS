"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import {
  FormulaClientProductPickers,
  type SelectedFormulaOption,
} from "@/features/os/operational/components/formula-client-product-pickers";
import { LifecycleActionsMenu } from "@/features/os/operational/components/lifecycle-actions-menu";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import { resolveFormulaMasterApi } from "@/lib/orders/orders-client";
import { mpControlLifecycleActions } from "@/lib/lifecycle/adapters/common";
import type { LifecycleAction } from "@/lib/lifecycle";
import { matchesVisibilityFilter } from "@/lib/lifecycle";
import type { MpWeeklyControl, MpWeeklyControlLine } from "@/lib/mp-control/types";
import { canWriteMpControl } from "@/lib/mp-control/types";

function actorHeaders(email: string, sector: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: email,
    [ACTOR_SECTOR_HEADER]: sector,
  };
}

export function MpWeeklyControlPanel() {
  const { email, sectorId } = usePreviewSession();
  const canWrite = canWriteMpControl(sectorId);
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

  const [controls, setControls] = useState<MpWeeklyControl[]>([]);
  const [active, setActive] = useState<MpWeeklyControl | null>(null);
  const [client, setClient] = useState("");
  const [product, setProduct] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driveFileId, setDriveFileId] = useState<string | undefined>();
  const [qty, setQty] = useState("100");
  const [sourceHint, setSourceHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schemaPending, setSchemaPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [visibility, setVisibility] = useState<"activos" | "archivados" | "anulados">("activos");

  const reload = useCallback(async () => {
    const res = await fetch("/api/v1/mp-control", {
      headers: actorHeaders(session.email, session.sector),
    });
    const body = (await res.json()) as {
      controls?: MpWeeklyControl[];
      error?: string;
      schemaPending?: boolean;
    };
    if (!res.ok) throw new Error(body.error ?? "Error al listar controles");
    setControls(body.controls ?? []);
    setSchemaPending(Boolean(body.schemaPending));
  }, [session]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [reload]);

  async function loadFormulaAndCreate() {
    if (!canWrite) return;
    setLoading(true);
    setError(null);
    try {
      const quantityKg = qty === "" ? null : Number(qty);
      const resolved = await resolveFormulaMasterApi(
        session,
        client,
        product,
        selectedId ?? undefined,
        driveFileId
      );
      if (!resolved.found || !resolved.materials?.length) {
        setError(resolved.message ?? "No se encontró fórmula en Drive/cache.");
        return;
      }
      setSourceHint(resolved.source ?? null);
      const snapshot = {
        client: resolved.snapshot?.displayClient ?? client,
        product: resolved.snapshot?.displayProduct ?? product,
        source: (resolved.source as "DRIVE" | "CACHE_NEON") ?? "DRIVE",
        driveFileId: resolved.snapshot?.driveFileId ?? driveFileId,
        driveModifiedTime: resolved.snapshot?.driveModifiedTime ?? null,
        driveChecksum: resolved.snapshot?.driveChecksum,
        materials: resolved.materials.map((m) => ({
          materiaPrima: m.materiaPrima ?? "",
          codigo: m.codigo ?? "",
          formulaPct: m.formulaPct ?? null,
        })),
        capturedAt: new Date().toISOString(),
      };
      const res = await fetch("/api/v1/mp-control", {
        method: "POST",
        headers: actorHeaders(session.email, session.sector),
        body: JSON.stringify({
          client: snapshot.client,
          product: snapshot.product,
          quantityKg,
          snapshot,
        }),
      });
      const body = (await res.json()) as { control?: MpWeeklyControl; error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo crear control");
      setActive(body.control!);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function patchActive(patch: Record<string, unknown>) {
    if (!active || !canWrite) return;
    const res = await fetch(`/api/v1/mp-control/${active.id}`, {
      method: "PATCH",
      headers: actorHeaders(session.email, session.sector),
      body: JSON.stringify(patch),
    });
    const body = (await res.json()) as { control?: MpWeeklyControl; error?: string };
    if (!res.ok) throw new Error(body.error ?? "No se pudo guardar");
    setActive(body.control!);
    await reload();
  }

  async function onQtyChange(next: string) {
    setQty(next);
    if (!active || !canWrite) return;
    const quantityKg = next === "" ? null : Number(next);
    await patchActive({ quantityKg, recalcFromSnapshot: true });
  }

  function updateLine(lineId: string, patch: Partial<MpWeeklyControlLine>) {
    if (!active) return;
    const lines = active.lines.map((l) =>
      l.id === lineId ? { ...l, ...patch } : l
    );
    void patchActive({ lines });
  }

  const writesEnabled = canWrite && !schemaPending;

  const visibleControls = useMemo(
    () =>
      controls.filter((c) =>
        matchesVisibilityFilter(visibility, {
          status: c.status,
          archived: c.status === "ARCHIVADO",
        })
      ),
    [controls, visibility]
  );

  async function runLifecycle(action: LifecycleAction, reason: string) {
    if (!active || !canWrite) return;
    if (action === "eliminar") {
      const res = await fetch(`/api/v1/mp-control/${active.id}`, {
        method: "DELETE",
        headers: actorHeaders(session.email, session.sector),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo eliminar");
      setActive(null);
      await reload();
      return;
    }
    const lifecycleAction =
      action === "anular" ? "annul" : action === "archivar" ? "archive" : action === "restaurar" ? "restore" : null;
    if (!lifecycleAction) throw new Error("Acción no soportada.");
    const res = await fetch(`/api/v1/mp-control/${active.id}`, {
      method: "PATCH",
      headers: actorHeaders(session.email, session.sector),
      body: JSON.stringify({ lifecycleAction, reason }),
    });
    const body = (await res.json()) as { control?: MpWeeklyControl; error?: string };
    if (!res.ok) throw new Error(body.error ?? "No se pudo completar la acción");
    setActive(body.control!);
    await reload();
  }

  const lifecycleMenuItems = useMemo(() => {
    if (!active) return [];
    const lc = mpControlLifecycleActions(active);
    const linkedImpact = active.linkedOeId
      ? {
          summary: `OE vinculada: ${active.linkedOeId}. No se puede hard-delete.`,
          preservesAudit: true,
          references: lc.eliminar.impact?.references ?? [],
          warnings: ["El control no descuenta stock; anular/archivar conserva auditoría."],
        }
      : undefined;
    return [
      ...(lc.eliminar.allowed
        ? [
            {
              action: "eliminar" as const,
              label: "Eliminar borrador",
              decision: lc.eliminar,
              impact: lc.eliminar.impact,
            },
          ]
        : []),
      ...(lc.anular.allowed && lc.anular.action === "anular"
        ? [
            {
              action: "anular" as const,
              label: "Anular",
              decision: lc.anular,
              impact: linkedImpact ?? lc.anular.impact,
            },
          ]
        : []),
      ...(lc.archivar.allowed && lc.archivar.action === "archivar"
        ? [
            {
              action: "archivar" as const,
              label: "Archivar",
              decision: lc.archivar,
              impact: linkedImpact,
            },
          ]
        : []),
      ...(lc.restaurar.allowed
        ? [
            {
              action: "restaurar" as const,
              label: "Restaurar",
              decision: lc.restaurar,
            },
          ]
        : []),
    ];
  }, [active]);

  return (
    <div className="space-y-4" data-testid="mp-weekly-control-panel">
      <SchemaPendingBanner show={schemaPending} />
      {error ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {sourceHint ? (
        <p className="text-xs text-[var(--os-text-muted)]" data-testid="mp-control-source">
          Fuente fórmula: {sourceHint}
        </p>
      ) : null}

      {writesEnabled ? (
        <div className="grid gap-3 rounded border border-[var(--os-border)] p-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <FormulaClientProductPickers
              session={session}
              client={client}
              product={product}
              hydrateKey="mp-control-new"
              selectedProductId={selectedId}
              suggestionsEnabled
              onClientTextChange={(v) => {
                setClient(v);
                setSelectedId(null);
                setDriveFileId(undefined);
              }}
              onProductTextChange={(v) => {
                setProduct(v);
                setSelectedId(null);
                setDriveFileId(undefined);
              }}
              onClientSelected={(v) => {
                setClient(v);
                setProduct("");
                setSelectedId(null);
                setDriveFileId(undefined);
              }}
              onProductSelected={(opt: SelectedFormulaOption) => {
                setClient(opt.client);
                setProduct(opt.productLabel);
                setSelectedId(opt.productId);
                setDriveFileId(opt.driveFileId);
                setSourceHint(opt.source ?? null);
              }}
              onCommitProductText={() => {}}
            />
          </div>
          <label className="text-xs">
            Cantidad Kg
            <input
              type="number"
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              value={qty}
              onChange={(e) => void onQtyChange(e.target.value)}
              data-testid="mp-control-qty"
            />
          </label>
          <div className="sm:col-span-3 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={loading || !client.trim() || !product.trim()}
              onClick={() => void loadFormulaAndCreate()}
              data-testid="mp-control-load-formula"
            >
              Guardar control
            </Button>
            <Button type="button" variant="secondary" onClick={() => setQty("100")}>
              100 kg
            </Button>
            <Button type="button" variant="secondary" onClick={() => void onQtyChange("250")}>
              250 kg
            </Button>
          </div>
        </div>
      ) : canWrite ? null : (
        <p className="text-sm text-[var(--os-text-muted)]">Solo lectura (Producción/Calidad).</p>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(["activos", "archivados", "anulados"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`rounded border px-2 py-1 text-xs capitalize ${
                  visibility === f
                    ? "border-[var(--os-teal)] bg-[var(--os-bg-muted)]"
                    : "border-[var(--os-border)]"
                }`}
                onClick={() => setVisibility(f)}
              >
                {f}
              </button>
            ))}
          </div>
        <ul className="rounded border border-[var(--os-border)] divide-y max-h-80 overflow-y-auto">
          {visibleControls.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--os-bg-muted)]"
                onClick={() => {
                  setActive(c);
                  setQty(c.quantityKg != null ? String(c.quantityKg) : "");
                  setSourceHint(c.source);
                }}
              >
                <span className="font-medium">
                  {c.client} · {c.product}
                </span>
                <span className="block text-[11px] text-[var(--os-text-muted)]">
                  {c.status} · {c.quantityKg ?? "—"} kg · {c.source ?? "—"}
                </span>
              </button>
            </li>
          ))}
          {visibleControls.length === 0 ? (
            <li className="px-3 py-4 text-sm text-[var(--os-text-muted)]">Sin controles.</li>
          ) : null}
        </ul>
        </div>

        <div className="os-table-wrap min-w-0 overflow-x-clip rounded border border-[var(--os-border)] lg:col-span-2">
          {active ? (
            <div className="space-y-2 p-2">
              <div className="flex flex-wrap items-center gap-2">
                {writesEnabled && active.status === "BORRADOR" ? (
                  <Button
                    type="button"
                    onClick={() => void patchActive({ status: "COMPLETADO" })}
                  >
                    Completar
                  </Button>
                ) : null}
                {writesEnabled && lifecycleMenuItems.length > 0 ? (
                  <LifecycleActionsMenu
                    items={lifecycleMenuItems}
                    onAction={runLifecycle}
                  />
                ) : null}
                <span className="self-center text-xs text-[var(--os-text-muted)]">
                  Snapshot: {active.formulaSnapshot ? "inmutable" : "—"} · no descuenta stock
                  {active.linkedOeId ? ` · OE ${active.linkedOeId}` : ""}
                </span>
              </div>
              <table className="os-table w-full max-w-full table-fixed text-xs" data-testid="mp-control-lines">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-1">Código</th>
                    <th className="p-1">Materia prima</th>
                    <th className="hidden p-1 md:table-cell">% </th>
                    <th className="p-1">Kg nec.</th>
                    <th className="hidden p-1 sm:table-cell">Stock</th>
                    <th className="hidden p-1 md:table-cell">Proyect.</th>
                    <th className="hidden p-1 md:table-cell">Dif.</th>
                    <th className="p-1">Estado</th>
                    <th className="hidden p-1 lg:table-cell">Lote</th>
                    <th className="hidden p-1 lg:table-cell">Prep.</th>
                    <th className="hidden p-1 xl:table-cell">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {active.lines.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="p-1">
                        <input
                          className="w-full min-w-0 max-w-[5rem] rounded border px-1"
                          value={l.codigo}
                          disabled={!writesEnabled}
                          onChange={(e) => updateLine(l.id, { codigo: e.target.value })}
                        />
                      </td>
                      <td className="min-w-0 p-1">
                        <span className="os-break">{l.materiaPrima}</span>
                      </td>
                      <td className="hidden p-1 md:table-cell">{l.formulaPct ?? "—"}</td>
                      <td className="p-1">
                        <input
                          type="number"
                          className="w-full min-w-0 max-w-[4rem] rounded border px-1"
                          value={l.kgEditados ?? l.kgNecesarios ?? ""}
                          disabled={!writesEnabled}
                          onChange={(e) =>
                            updateLine(l.id, {
                              kgEditados:
                                e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="hidden p-1 sm:table-cell">{l.stockActual ?? "—"}</td>
                      <td className="hidden p-1 md:table-cell">{l.stockProyectado ?? "—"}</td>
                      <td className="hidden p-1 md:table-cell">{l.diferencia ?? "—"}</td>
                      <td className="p-1">{l.estado}</td>
                      <td className="hidden p-1 lg:table-cell">
                        <input
                          className="w-full min-w-0 max-w-[4rem] rounded border px-1"
                          value={l.lote}
                          disabled={!writesEnabled}
                          onChange={(e) => updateLine(l.id, { lote: e.target.value })}
                        />
                      </td>
                      <td className="hidden p-1 lg:table-cell">
                        <input
                          type="checkbox"
                          checked={l.preparado}
                          disabled={!writesEnabled}
                          onChange={(e) =>
                            updateLine(l.id, { preparado: e.target.checked })
                          }
                        />
                      </td>
                      <td className="hidden p-1 xl:table-cell">
                        <input
                          className="w-full min-w-0 rounded border px-1"
                          value={l.observacion}
                          disabled={!writesEnabled}
                          onChange={(e) =>
                            updateLine(l.id, { observacion: e.target.value })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-sm text-[var(--os-text-muted)]">
              Seleccioná o creá un control.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
