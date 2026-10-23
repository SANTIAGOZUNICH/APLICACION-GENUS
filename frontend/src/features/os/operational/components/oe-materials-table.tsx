"use client";

/**
 * Tabla de materias primas de la OE, tipo Excel: edición directa en la celda, Enter / ↓ / ↑ entre filas, pegar una
 * columna desde una planilla y autoguardado (lo hace el editor). Columnas:
 *   Materia prima · Código (fórmula) · CÓDIGO MP (Stock MP) · % · KG A PESAR (teórico) · KG REAL UTILIZADO · Dif. ·
 *   LOTE MP · Obs.
 * Lo único que se descuenta del stock son los KG REAL UTILIZADO, del CÓDIGO MP de cada fila (LOTE MP es opcional).
 * «+ lote» agrega una fila de lote adicional para la misma MP (cuando se usó de más de un lote).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { emptyOeMaterial, hydrateOrderContent } from "@/lib/orders/content";
import {
  buildOeConsumptionPlan,
  codeExistsInCatalog,
  normMpCode,
  normMpLote,
  suggestCodigoMp,
  type MpCatalogLot,
} from "@/lib/orders/oe-mp-consumption";
import { fetchMpCatalogApi, type OrdersClientSession } from "@/lib/orders/orders-client";
import type { OeContent, OeMaterialRow } from "@/lib/orders/types";

/** Texto largo que baja de línea y hace crecer la fila (nunca se corta ni usa «…»). */
function AutoTextarea({ value, onChange, disabled, className, testId }: { value: string; onChange: (v: string) => void; disabled?: boolean; className?: string; testId?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      className={`${className ?? ""} resize-none overflow-hidden whitespace-pre-wrap break-words leading-snug`}
      data-testid={testId}
    />
  );
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : String(Number(n.toFixed(4))).replace(".", ","));

export function useMpCatalog(session: OrdersClientSession | null) {
  const [lots, setLots] = useState<MpCatalogLot[] | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetchMpCatalogApi(session)
      .then((l) => {
        if (alive) setLots(l);
      })
      .catch(() => {
        if (alive) setLots([]);
      });
    return () => {
      alive = false;
    };
  }, [session]);
  return lots;
}

export function OeMaterialsTable({
  content,
  onChange,
  formulaLocked,
  opsLocked,
  canEditCodigoMp,
  session,
  actorEmail,
  onRemoveMaterial,
}: {
  content: OeContent;
  onChange: (next: OeContent) => void;
  formulaLocked: boolean;
  opsLocked: boolean;
  canEditCodigoMp: boolean;
  session: OrdersClientSession | null;
  actorEmail?: string;
  onRemoveMaterial: (id: string) => void;
}) {
  const catalog = useMpCatalog(session);
  // Defensa: plantillas/OE guardadas antes de CÓDIGO MP / KG REAL no tienen esos campos (la tabla los lee como texto).
  const materials = useMemo(() => hydrateOrderContent(content).materials, [content]);
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const plan = useMemo(() => (catalog ? buildOeConsumptionPlan(materials, catalog) : null), [materials, catalog]);
  const issuesByRow = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const i of plan?.issues ?? []) out.set(i.rowId, (out.get(i.rowId) ?? new Set()).add(i.field));
    return out;
  }, [plan]);
  const codes = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of catalog ?? []) if (!l.archived) map.set(normMpCode(l.codigo), l.descripcion);
    return [...map].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);

  const patch = (id: string, p: Partial<OeMaterialRow>) => {
    const stamp = ("kgReal" in p || "lote" in p) && actorEmail ? { ajusteAt: new Date().toISOString(), ajusteBy: actorEmail } : {};
    onChange({
      ...content,
      materials: materials.map((x) => {
        if (x.id === id) return { ...x, ...p, ...stamp };
        // Los lotes adicionales heredan el CÓDIGO MP de su fila.
        if ("codigoMp" in p && x.parentRowId === id) return { ...x, codigoMp: p.codigoMp ?? "" };
        return x;
      }),
    });
  };
  const addLot = (parent: OeMaterialRow) => {
    const idx = materials.findIndex((m) => m.id === parent.id);
    let end = idx + 1;
    while (end < materials.length && materials[end]!.parentRowId === parent.id) end++;
    const child = emptyOeMaterial({
      materiaPrima: parent.materiaPrima,
      codigo: parent.codigo,
      codigoMp: parent.codigoMp,
      parentRowId: parent.id,
    });
    onChange({ ...content, materials: [...materials.slice(0, end), child, ...materials.slice(end)] });
  };
  const removeRow = (m: OeMaterialRow) => {
    if (m.parentRowId) onChange({ ...content, materials: materials.filter((x) => x.id !== m.id) });
    else onRemoveMaterial(m.id);
  };

  /** Excel: Enter / ↓ baja, Shift+Enter / ↑ sube, en la misma columna. */
  const onKeyNav = (e: React.KeyboardEvent<HTMLInputElement>, col: string, rowIndex: number) => {
    const down = (e.key === "Enter" && !e.shiftKey) || e.key === "ArrowDown";
    const up = (e.key === "Enter" && e.shiftKey) || e.key === "ArrowUp";
    if (!down && !up) return;
    const cells = Array.from(e.currentTarget.closest("tbody")?.querySelectorAll<HTMLInputElement>(`[data-col="${col}"]`) ?? []);
    const pos = cells.indexOf(e.currentTarget);
    const target = cells[pos + (down ? 1 : -1)];
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.select();
    void rowIndex;
  };
  /** Pegar varias líneas (una columna copiada de una planilla) completa las filas siguientes. */
  const onPasteCol = (e: React.ClipboardEvent<HTMLInputElement>, field: "lote" | "codigoMp" | "kgReal", rowIndex: number) => {
    const values = e.clipboardData.getData("text").replace(/\r/g, "").split("\n").map((l) => l.split("\t")[0]!.trim());
    while (values.length > 1 && values[values.length - 1] === "") values.pop();
    if (values.length <= 1) return;
    e.preventDefault();
    const byIndex = new Map(values.map((v, k) => [rowIndex + k, v]));
    onChange({
      ...content,
      materials: materials.map((x, i) => {
        if (!byIndex.has(i)) return x;
        const v = byIndex.get(i)!;
        if (field === "kgReal") {
          const n = Number(v.replace(/\./g, "").replace(",", "."));
          return { ...x, kgReal: v === "" ? null : Number.isFinite(n) ? n : x.kgReal };
        }
        return { ...x, [field]: v };
      }),
    });
  };

  return (
    <>
      {plan && plan.issues.length > 0 && !opsLocked ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-400/10 px-2 py-1.5 text-xs" data-testid="oe-consumo-pendientes">
          <p className="font-semibold">Antes de entregar, completá ({plan.issues.length}):</p>
          <ul className="ml-4 list-disc">
            {plan.issues.slice(0, 12).map((i) => (
              <li key={`${i.rowId}-${i.field}`}>{i.message}</li>
            ))}
            {plan.issues.length > 12 ? <li>…y {plan.issues.length - 12} más.</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-xs" data-testid="oe-materials-table">
          <thead>
            <tr className="bg-[var(--os-bg-muted,#f3f3f3)] text-left">
              <th className="min-w-[16rem] p-2">Materia prima</th>
              <th className="p-2">Código</th>
              <th className="p-2" title="Código de la materia prima en Stock MP (el que se descuenta)">CÓDIGO MP</th>
              <th className="p-2">%</th>
              <th className="p-2 text-[var(--os-text-muted)]" title="Teórico (cantidad × %)">KG A PESAR</th>
              <th className="p-2 text-emerald-700 dark:text-emerald-300" title="Lo que realmente se usó: es lo que se descuenta del stock">
                KG REAL UTILIZADO
              </th>
              <th className="p-2" title="KG REAL − KG A PESAR">Dif.</th>
              <th className="p-2">LOTE MP</th>
              <th className="p-2">Obs.</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {materials.map((m, rowIndex) => {
              const child = Boolean(m.parentRowId);
              const parent = child ? byId.get(m.parentRowId!) : undefined;
              const flags = issuesByRow.get(m.id);
              const codeOk = !m.codigoMp.trim() || !catalog || codeExistsInCatalog(catalog, m.codigoMp);
              const suggestion = !child && catalog && !m.codigoMp.trim() ? suggestCodigoMp(m, catalog) : null;
              const rowLots = catalog
                ? catalog.filter((l) => !l.archived && normMpCode(l.codigo) === normMpCode(m.codigoMp || parent?.codigoMp))
                : [];
              const loteOwnRow = rowLots.some((l) => normMpLote(l.lote) === normMpLote(m.lote));
              // Un código con una sola fila en Stock MP (Ingresos MP acumula ahí todos sus lotes): se descuenta de esa fila.
              const loteViaCodigo = Boolean(m.lote.trim()) && !loteOwnRow && rowLots.length === 1;
              const loteOk = !m.lote.trim() || !catalog || loteOwnRow || loteViaCodigo;
              const dif = !child && m.ajuste != null ? m.ajuste : null;
              const cellCls = (bad: boolean) => `w-full rounded border px-2 py-1.5 text-sm ${bad ? "border-rose-500 bg-rose-500/10" : ""}`;
              return (
                <tr key={m.id} className={`border-t align-top ${child ? "bg-[var(--os-bg-muted,#f7f7f7)]/50" : ""}`} data-testid={child ? "oe-row-lote-adicional" : "oe-row"}>
                  <td className="p-1">
                    {child ? (
                      <span className="whitespace-normal break-words pl-3 text-[var(--os-text-muted)]">↳ lote adicional · {parent?.materiaPrima || m.materiaPrima}</span>
                    ) : (
                      <AutoTextarea
                        disabled={formulaLocked}
                        value={m.materiaPrima}
                        onChange={(v) => patch(m.id, { materiaPrima: v })}
                        className={`w-full rounded border px-2 py-1.5 text-sm ${formulaLocked ? "bg-[var(--os-bg-muted,#eef1f4)]" : ""}`}
                        testId="oe-cell-materia"
                      />
                    )}
                  </td>
                  <td className="p-1">
                    {child ? (
                      <span className="text-[var(--os-text-muted)]">{parent?.codigo}</span>
                    ) : (
                      <input
                        disabled={formulaLocked}
                        value={m.codigo}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(e) => patch(m.id, { codigo: e.target.value })}
                        className={`w-full rounded border px-2 py-1.5 text-sm ${formulaLocked ? "bg-[var(--os-bg-muted,#eef1f4)]" : ""}`}
                        data-testid="oe-cell-codigo"
                      />
                    )}
                  </td>
                  <td className="min-w-[8.5rem] p-1">
                    {child ? (
                      <span className="font-mono text-[var(--os-text-muted)]">{parent?.codigoMp || "—"}</span>
                    ) : (
                      <>
                        <input
                          disabled={!canEditCodigoMp}
                          value={m.codigoMp}
                          list="oe-mp-codes"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          // Se guarda EXACTAMENTE lo escrito (transformar el valor en cada tecla desincroniza el teclado
                          // virtual de Android y agrega letras); las mayúsculas se aplican al salir del campo.
                          onChange={(e) => patch(m.id, { codigoMp: e.target.value })}
                          onBlur={(e) => {
                            const up = e.target.value.toUpperCase();
                            if (up !== m.codigoMp) patch(m.id, { codigoMp: up });
                          }}
                          onKeyDown={(e) => onKeyNav(e, "codigoMp", rowIndex)}
                          onPaste={(e) => onPasteCol(e, "codigoMp", rowIndex)}
                          data-col="codigoMp"
                          className={`${cellCls(!codeOk || Boolean(flags?.has("codigoMp")))} font-mono`}
                          placeholder={suggestion?.kind === "many" ? "Elegí del catálogo" : "Buscar…"}
                          title={!codeOk ? "Ese código no existe en Stock MP" : m.codigoMp ? codes.find(([c]) => c === normMpCode(m.codigoMp))?.[1] : undefined}
                          aria-label={`CÓDIGO MP de ${m.materiaPrima || m.codigo || "la materia prima"}`}
                          data-testid="oe-cell-codigo-mp"
                        />
                        {suggestion?.kind === "one" && canEditCodigoMp ? (
                          <button
                            type="button"
                            className="mt-0.5 text-[11px] text-[var(--os-teal,#0d9488)] underline"
                            onClick={() => patch(m.id, { codigoMp: suggestion.codigo })}
                            data-testid="oe-codigo-mp-sugerido"
                          >
                            Usar {suggestion.codigo}
                          </button>
                        ) : suggestion?.kind === "many" ? (
                          <p className="mt-0.5 text-[11px] text-amber-700" title={suggestion.codigos.join(", ")}>
                            {suggestion.codigos.length} coincidencias: elegí una
                          </p>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="p-1 font-mono">{child ? "" : fmt(m.formulaPct)}</td>
                  <td className="p-1 font-mono text-[var(--os-text-muted)]" data-testid="oe-cell-kg">
                    {child ? "" : fmt(m.kgAPesar)}
                  </td>
                  <td className="min-w-[7rem] p-1">
                    <DecimalInput
                      disabled={opsLocked}
                      value={m.kgReal}
                      onValue={(n) => patch(m.id, { kgReal: n })}
                      onKeyDown={(e) => onKeyNav(e, "kgReal", rowIndex)}
                      onPaste={(e) => onPasteCol(e, "kgReal", rowIndex)}
                      data-col="kgReal"
                      placeholder="kg reales"
                      className={`${cellCls(Boolean(flags?.has("kgReal")))} border-emerald-500/60 font-mono font-semibold`}
                      title="KG REAL UTILIZADO (se descuenta del stock)"
                      data-testid="oe-cell-kg-real"
                    />
                  </td>
                  <td className={`p-1 font-mono ${dif != null && dif !== 0 ? "text-amber-700 dark:text-amber-300" : "text-[var(--os-text-muted)]"}`} data-testid="oe-cell-dif">
                    {dif == null ? "" : `${dif > 0 ? "+" : ""}${fmt(dif)}`}
                  </td>
                  <td className="min-w-[7rem] p-1">
                    <input
                      disabled={opsLocked}
                      value={m.lote}
                      list={`oe-mp-lots-${m.id}`}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(e) => patch(m.id, { lote: e.target.value })}
                      onKeyDown={(e) => onKeyNav(e, "lote", rowIndex)}
                      onPaste={(e) => onPasteCol(e, "lote", rowIndex)}
                      data-col="lote"
                      className={cellCls(!loteOk || Boolean(flags?.has("lote")))}
                      placeholder={m.materiaPrima.trim() || m.codigo.trim() ? "Completar lote" : undefined}
                      title={
                        !loteOk
                          ? "Ese lote no está en Stock MP para el CÓDIGO MP de la fila"
                          : loteViaCodigo
                            ? `Se descuenta del registro del código en Stock MP (lote ${rowLots[0]!.lote || "sin lote"}); el lote ${m.lote.trim()} queda registrado en el movimiento.`
                            : undefined
                      }
                      aria-label={`Lote de ${m.materiaPrima || m.codigo || "la materia prima"}`}
                      data-testid="oe-cell-lote"
                    />
                    <datalist id={`oe-mp-lots-${m.id}`}>
                      {rowLots.map((l) => (
                        <option key={l.id} value={l.lote}>
                          {`${l.lote} — ${fmt(l.cantidadKg)} kg`}
                        </option>
                      ))}
                    </datalist>
                  </td>
                  <td className="p-1">
                    <input
                      disabled={opsLocked}
                      value={m.ajusteMotivo}
                      autoComplete="off"
                      autoCorrect="off"
                      onChange={(e) => patch(m.id, { ajusteMotivo: e.target.value })}
                      className="w-full rounded border px-2 py-1.5 text-sm"
                      placeholder="opcional"
                      data-testid="oe-cell-ajuste-motivo"
                    />
                  </td>
                  <td className="whitespace-nowrap p-1">
                    {!child && !opsLocked && (m.materiaPrima.trim() || m.codigo.trim()) ? (
                      <button type="button" className="mr-2 text-[var(--os-teal,#0d9488)]" onClick={() => addLot(m)} title="La MP se usó de más de un lote" data-testid="oe-add-lote">
                        + lote
                      </button>
                    ) : null}
                    {(child && !opsLocked) || (!child && !formulaLocked) ? (
                      <button type="button" className="text-rose-700" onClick={() => removeRow(m)} data-testid={child ? "oe-remove-lote" : "oe-remove-material"}>
                        Quitar
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="oe-mp-codes">
          {codes.map(([c, d]) => (
            <option key={c} value={c}>
              {`${c} — ${d}`}
            </option>
          ))}
        </datalist>
      </div>
    </>
  );
}
