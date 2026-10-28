"use client";

import { useCallback, useEffect, useState } from "react";
import { FORMULA_ISSUE_LABEL } from "@/lib/formulas/oe-formula-compare";
import { fetchOeFormulaCheckApi, verifyOeFormulaApi, type OeFormulaCheckView, type OrdersClientSession } from "@/lib/orders/orders-client";

const pct = (n: number | null) => (n == null ? "—" : `${Number(n.toFixed(4))} %`);

/**
 * «Fórmula pendiente de verificación»: aviso visible cuando la composición de la OE no coincide con la fórmula aprobada.
 * Muestra la comparación fila por fila y, a Producción/Dirección, el botón para verificarla (no cambia ningún porcentaje).
 */
export function OeFormulaCheckBanner({
  session,
  orderId,
  refreshKey,
  canVerify,
}: {
  session: OrdersClientSession;
  orderId: string;
  refreshKey: unknown;
  canVerify: boolean;
}) {
  const [check, setCheck] = useState<OeFormulaCheckView | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOeFormulaCheckApi(session, orderId)
      .then((c) => !cancelled && setCheck(c))
      .catch(() => !cancelled && setCheck(null));
    return () => {
      cancelled = true;
    };
  }, [session, orderId, refreshKey]);

  const act = useCallback(
    async (action: "verify" | "revoke") => {
      setBusy(true);
      setErr(null);
      try {
        setCheck(await verifyOeFormulaApi(session, orderId, { action, note }));
        setNote("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "No se pudo registrar la verificación.");
      } finally {
        setBusy(false);
      }
    },
    [session, orderId, note]
  );

  if (!check || (check.issues.length === 0 && !check.verified)) return null;
  const diffRows = check.evaluation.rows.filter((r) => r.status !== "OK");

  return (
    <section
      className={`space-y-2 rounded border px-3 py-2 text-sm ${check.pending ? "border-rose-400 bg-rose-50 text-rose-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}
      role="alert"
      data-testid="oe-formula-check"
      data-pending={check.pending ? "1" : "0"}
    >
      <h3 className="font-semibold">
        {check.pending ? "Fórmula pendiente de verificación" : check.verified ? `Fórmula verificada por ${check.verifiedBy}` : "Revisar fórmula"}
      </h3>
      <p className="text-xs">
        {check.pending
          ? "No se puede entregar ni descontar materias primas hasta que Producción o Dirección verifique esta fórmula contra la aprobada. Los porcentajes no se modificaron."
          : "La composición difiere de la fórmula aprobada, pero fue verificada manualmente para esta composición."}
      </p>
      <ul className="list-disc pl-5 text-xs">
        {check.issues.map((i) => (
          <li key={i}>{FORMULA_ISSUE_LABEL[i]}</li>
        ))}
      </ul>
      {diffRows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead>
              <tr>
                <th className="py-1 pr-2">Materia prima</th>
                <th className="py-1 pr-2 text-right">% aprobado</th>
                <th className="py-1 pr-2 text-right">% en la OE</th>
                <th className="py-1 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {diffRows.map((r, i) => (
                <tr key={`${r.codigo}-${r.materiaPrima}-${i}`}>
                  <td className="py-0.5 pr-2">{r.materiaPrima}</td>
                  <td className="py-0.5 pr-2 text-right">{pct(r.pctAprobado)}</td>
                  <td className="py-0.5 pr-2 text-right">{pct(r.pctOe)}</td>
                  <td className="py-0.5 text-right">{r.diferencia == null ? r.status.replaceAll("_", " ").toLowerCase() : pct(r.diferencia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {canVerify ? (
        <div className="flex flex-wrap items-center gap-2">
          {check.pending ? (
            <>
              <input
                className="min-w-[16rem] flex-1 rounded border border-[var(--os-border)] bg-white px-2 py-1 text-xs text-black"
                placeholder="Contra qué archivo/versión aprobada la verificaste (obligatorio)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="oe-formula-verify-note"
              />
              <button type="button" className="rounded bg-rose-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy || note.trim().length < 3} onClick={() => void act("verify")} data-testid="oe-formula-verify">
                Verificar fórmula
              </button>
            </>
          ) : (
            <button type="button" className="rounded border px-3 py-1 text-xs" disabled={busy} onClick={() => void act("revoke")}>
              Revocar verificación
            </button>
          )}
        </div>
      ) : null}
      {err ? <p className="text-xs text-rose-800">{err}</p> : null}
    </section>
  );
}
