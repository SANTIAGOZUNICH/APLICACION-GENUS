"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BULK_ACTION_LABEL,
  type BulkActionVerdict,
  type BulkPendingAction,
} from "../../lib/bulk-action-verdicts";

export interface BulkPendingDialogItem {
  id: string;
  label: string;
  detail?: string;
  /** Codificado: cantidad total propuesta (editable por trabajo). */
  defaultTotal?: number | null;
  unit?: string | null;
}

export interface BulkPendingConfirmPayload {
  delivery?: {
    actualDeliveredAt: string;
    remito: string;
    receivedBy: string;
    observations: string;
  };
  observation?: string;
  totals?: Record<string, number | null>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: BulkPendingAction;
  items: BulkPendingDialogItem[];
  verdicts: BulkActionVerdict[] | null;
  previewError?: string | null;
  busy?: boolean;
  onConfirm: (payload: BulkPendingConfirmPayload) => void;
}

function nowDatetimeLocal(): string {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const FIELD =
  "mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2 min-h-10";

/**
 * Confirmación de acciones masivas que reutilizan el flujo individual: muestra qué trabajos entran, cuáles no (con
 * motivo), pide los datos obligatorios del flujo individual y explica el resultado. Solo «Confirmar» ejecuta.
 */
export function BulkPendingActionDialog(props: Props) {
  // El cuerpo se monta solo mientras el modal está abierto → los campos arrancan limpios en cada apertura.
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => !props.busy && props.onOpenChange(o)}
    >
      <Body {...props} />
    </Dialog>
  );
}

function Body({
  onOpenChange,
  action,
  items,
  verdicts,
  previewError,
  busy,
  onConfirm,
}: Props) {
  const [at, setAt] = useState(nowDatetimeLocal);
  const [remito, setRemito] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [observations, setObservations] = useState("");
  const [totals, setTotals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const byId = new Map((verdicts ?? []).map((v) => [v.id, v]));
  const included = items.filter((i) => byId.get(i.id)?.code === "ELIGIBLE");
  const excluded = items.filter((i) => {
    const c = byId.get(i.id)?.code;
    return c && c !== "ELIGIBLE";
  });
  const label = BULK_ACTION_LABEL[action];
  const ready = verdicts != null && !previewError;
  const canConfirm = !busy && ready && included.length > 0;

  function submit() {
    if (!canConfirm) return;
    setError(null);
    if (action === "DELIVER") {
      const d = new Date(at);
      if (!at || !Number.isFinite(d.getTime())) {
        setError("La fecha y hora real de entrega son obligatorias.");
        return;
      }
      onConfirm({
        delivery: {
          actualDeliveredAt: d.toISOString(),
          remito: remito.trim(),
          receivedBy: receivedBy.trim(),
          observations: observations.trim(),
        },
      });
      return;
    }
    const parsed: Record<string, number | null> = {};
    for (const i of included) {
      const raw = (totals[i.id] ?? "").trim().replace(",", ".");
      if (raw === "") {
        parsed[i.id] = i.defaultTotal ?? null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        setError(
          `La cantidad total de «${i.label}» debe ser un número mayor que 0.`,
        );
        return;
      }
      parsed[i.id] = n;
    }
    onConfirm({ observation: observations.trim(), totals: parsed });
  }

  return (
    <DialogContent data-testid="bulk-action-dialog" data-action={action}>
      <DialogHeader>
        <DialogTitle>
          {label}{" "}
          {ready
            ? `(${included.length} de ${items.length})`
            : `(${items.length})`}
        </DialogTitle>
        <DialogDescription data-testid="bulk-action-expected">
          {action === "DELIVER"
            ? "Cada trabajo se registra como entrega FINAL de todo su saldo, con las mismas reglas que «Registrar entrega»: queda entregado, con su línea de entrega, evento y aviso. No toca stock ni consumos de MP."
            : "Cada trabajo pasa a Codificado con las mismas reglas que «Enviar a Codificado»: queda disponible para ese sector, con su historial y aviso. No toca stock ni consumos de MP."}
        </DialogDescription>
      </DialogHeader>

      {previewError ? (
        <p
          className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          {previewError}
        </p>
      ) : null}
      {verdicts == null && !previewError ? (
        <p
          className="text-sm text-[var(--os-text-muted)]"
          data-testid="bulk-action-checking"
        >
          Verificando qué trabajos se pueden procesar…
        </p>
      ) : null}

      {ready ? (
        <div className="max-h-56 space-y-3 overflow-y-auto text-sm">
          <section data-testid="bulk-action-included">
            <h3 className="font-medium">Se procesarán ({included.length})</h3>
            <ul className="mt-1 space-y-1 text-xs">
              {included.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <span>
                    {i.label}
                    {i.detail ? (
                      <span className="text-[var(--os-text-muted)]">
                        {" "}
                        · {i.detail}
                      </span>
                    ) : null}
                  </span>
                  {action === "SEND_CODIFICADO" ? (
                    <label className="ml-auto flex items-center gap-1 text-[var(--os-text-muted)]">
                      Total{i.unit ? ` (${i.unit})` : ""}
                      <input
                        inputMode="decimal"
                        value={
                          totals[i.id] ??
                          (i.defaultTotal != null ? String(i.defaultTotal) : "")
                        }
                        onChange={(e) =>
                          setTotals((t) => ({ ...t, [i.id]: e.target.value }))
                        }
                        className="w-24 rounded border border-[var(--os-border)] px-2 py-1 tabular-nums"
                        data-testid="bulk-action-total"
                        aria-label={`Cantidad total de ${i.label}`}
                      />
                    </label>
                  ) : (
                    <span className="ml-auto text-[var(--os-text-muted)]">
                      {byId.get(i.id)?.outcome}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {excluded.length > 0 ? (
            <section data-testid="bulk-action-excluded">
              <h3 className="font-medium text-amber-300">
                No se pueden procesar ({excluded.length}) — quedan sin cambios
              </h3>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {excluded.map((i) => (
                  <li key={i.id}>
                    {i.label} —{" "}
                    <span className="text-[var(--os-text-muted)]">
                      {byId.get(i.id)?.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {action === "DELIVER" ? (
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="font-medium">Fecha y hora real de entrega *</span>
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className={FIELD}
              data-testid="bulk-deliver-at"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="font-medium">Remito</span>
              <input
                value={remito}
                onChange={(e) => setRemito(e.target.value)}
                className={FIELD}
                data-testid="bulk-deliver-remito"
              />
            </label>
            <label className="block">
              <span className="font-medium">Recibe</span>
              <input
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                className={FIELD}
                data-testid="bulk-deliver-received"
              />
            </label>
          </div>
          <label className="block">
            <span className="font-medium">Observaciones</span>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={2}
              className={FIELD}
            />
          </label>
          <p className="text-xs text-[var(--os-text-muted)]">
            Estos datos se aplican a todos los trabajos del lote. Para una
            entrega parcial o con cantidad distinta, usá «Registrar entrega» en
            el trabajo.
          </p>
        </div>
      ) : (
        <label className="block text-sm">
          <span className="font-medium">
            Observación (opcional, común a todos)
          </span>
          <textarea
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            rows={2}
            className={FIELD}
            data-testid="bulk-codificado-observation"
          />
        </label>
      )}

      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          data-testid="bulk-action-cancel"
        >
          Cancelar
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!canConfirm}
          data-testid="bulk-action-confirm"
        >
          {busy ? "Procesando…" : `Confirmar (${included.length})`}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
