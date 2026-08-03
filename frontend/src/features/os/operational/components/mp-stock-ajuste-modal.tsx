"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import { usePreviewSession } from "@/features/os/session/preview-context";

type AjusteTipo =
  | "ingreso"
  | "egreso"
  | "correccion_positiva"
  | "correccion_negativa";

export function MpStockAjusteModal({
  open,
  onClose,
  schemaPending,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  schemaPending: boolean;
  onSaved: () => void;
}) {
  const { email, sectorId } = usePreviewSession();
  const [codigo, setCodigo] = useState("");
  const [materiaPrima, setMateriaPrima] = useState("");
  const [tipo, setTipo] = useState<AjusteTipo>("correccion_positiva");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCodigo("");
      setMateriaPrima("");
      setCantidad("");
      setMotivo("");
      setObs("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  function signedQty(): number {
    const n = Number(cantidad);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    if (tipo === "egreso" || tipo === "correccion_negativa") return -n;
    return n;
  }

  async function submit() {
    if (schemaPending) {
      setError("Base de datos pendiente de actualización. Los cambios están deshabilitados.");
      return;
    }
    const quantity = signedQty();
    if (!codigo.trim() || !Number.isFinite(quantity) || !motivo.trim()) {
      setError("Completá código, cantidad y motivo.");
      return;
    }
    const res = await fetch("/api/v1/mp-stock/ledger", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [ACTOR_EMAIL_HEADER]: email ?? "",
        [ACTOR_SECTOR_HEADER]: sectorId,
      },
      body: JSON.stringify({
        action: "ajuste",
        codigo: codigo.trim(),
        quantity,
        reason: `${motivo.trim()}${obs.trim() ? ` | ${obs.trim()}` : ""} [${tipo}] ${materiaPrima}`,
        allowNegative: true,
        fecha: new Date().toISOString().slice(0, 10),
      }),
    });
    const body = (await res.json()) as { error?: string; schemaPending?: boolean };
    if (!res.ok) {
      setError(body.error ?? "No se pudo registrar el ajuste");
      setConfirm(false);
      return;
    }
    setConfirm(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-lg bg-[var(--os-surface,#fff)] p-4 shadow-xl"
        data-testid="mp-stock-ajuste-modal"
      >
        <h3 className="mb-3 text-lg font-semibold">Registrar ajuste</h3>
        {schemaPending ? (
          <p className="mb-2 text-sm text-amber-800">
            Base de datos pendiente de actualización. Los cambios están deshabilitados.
          </p>
        ) : null}
        {error ? <p className="mb-2 text-sm text-rose-700">{error}</p> : null}
        <label className="mb-2 block text-xs">
          Materia prima
          <input
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={materiaPrima}
            onChange={(e) => setMateriaPrima(e.target.value)}
            disabled={schemaPending}
          />
        </label>
        <label className="mb-2 block text-xs">
          Código
          <input
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            disabled={schemaPending}
            data-testid="ajuste-codigo"
          />
        </label>
        <label className="mb-2 block text-xs">
          Tipo
          <select
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as AjusteTipo)}
            disabled={schemaPending}
          >
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
            <option value="correccion_positiva">Corrección positiva</option>
            <option value="correccion_negativa">Corrección negativa</option>
          </select>
        </label>
        <label className="mb-2 block text-xs">
          Cantidad (kg)
          <input
            type="number"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            disabled={schemaPending}
            data-testid="ajuste-cantidad"
          />
        </label>
        <label className="mb-2 block text-xs">
          Motivo (obligatorio)
          <input
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={schemaPending}
            data-testid="ajuste-motivo"
          />
        </label>
        <label className="mb-2 block text-xs">
          Observaciones
          <textarea
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            rows={2}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            disabled={schemaPending}
          />
        </label>
        <p className="mb-3 text-[11px] text-[var(--os-text-muted)]">
          Actor: {email} · Sector: {sectorId} · Fecha:{" "}
          {new Date().toLocaleString("es-AR")}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={schemaPending}
            onClick={() => setConfirm(true)}
            data-testid="ajuste-confirm-open"
          >
            Confirmar ajuste
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Registrar ajuste de stock?"
        description="Quedará auditado con actor y fecha. No se edita el stock directo."
        confirmLabel="Registrar"
        onConfirm={() => void submit()}
      />
    </div>
  );
}
