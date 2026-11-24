"use client";

/** Administración › INSUMOS › Catálogo: alta, edición de nombre, baja/alta lógica y orden de insumos y responsables (sin tocar código). */
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createItemApi, createResponsableApi, reorderItemsApi, reorderResponsablesApi, updateItemApi, updateResponsableApi } from "@/lib/insumos/insumos-client";
import { INSUMO_RESPONSABLE_SECTORS } from "@/lib/insumos/insumos-rules";
import type { InsumoItem, InsumoResponsable } from "@/lib/insumos/types";
import { SECTOR_LABELS } from "@/types/operational/sector";

const field = "min-h-10 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface,transparent)] px-3 text-sm";
const rowCls = "flex flex-wrap items-center gap-2 rounded-lg border border-[var(--os-border)] p-2";

type Row = { id: string; name: string; active: boolean };

function EditableList({ rows, onRename, onToggle, onMove, testPrefix }: { rows: Row[]; onRename: (id: string, name: string) => Promise<void>; onToggle: (id: string, active: boolean) => Promise<void>; onMove: (id: string, dir: -1 | 1) => Promise<void>; testPrefix: string }) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={r.id} className={`${rowCls} ${r.active ? "" : "opacity-60"}`} data-testid={`${testPrefix}-${r.id}`}>
          {editing?.id === r.id ? (
            <>
              <input className={`${field} min-w-0 flex-1`} value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} aria-label="Nombre" data-testid={`${testPrefix}-nombre-input`} />
              <Button size="sm" onClick={async () => { await onRename(r.id, editing.name); setEditing(null); }} data-testid={`${testPrefix}-guardar-nombre`}>Guardar</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 font-medium">{r.name}{r.active ? "" : " · de baja"}</span>
              <Button size="sm" variant="secondary" aria-label={`Subir ${r.name}`} disabled={i === 0} onClick={() => void onMove(r.id, -1)}><ArrowUp className="size-4" /></Button>
              <Button size="sm" variant="secondary" aria-label={`Bajar ${r.name}`} disabled={i === rows.length - 1} onClick={() => void onMove(r.id, 1)}><ArrowDown className="size-4" /></Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing({ id: r.id, name: r.name })} data-testid={`${testPrefix}-editar`}>Editar</Button>
              <Button size="sm" variant="secondary" onClick={() => void onToggle(r.id, !r.active)} data-testid={`${testPrefix}-baja`}>{r.active ? "Dar de baja" : "Reactivar"}</Button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function InsumosCatalogAdmin({ items, responsables, onChanged }: { items: InsumoItem[]; responsables: InsumoResponsable[]; onChanged: () => Promise<void> | void }) {
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");
  const [newResp, setNewResp] = useState<Record<string, string>>({});

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el cambio.");
    }
  }
  const move = (list: Row[], id: string, dir: -1 | 1): string[] => {
    const ids = list.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return ids;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    return ids;
  };

  return (
    <div className="space-y-6" data-testid="insumos-catalogo">
      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300" data-testid="insumos-catalogo-error">{error}</p> : null}

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Insumos</h3>
        <p className="text-sm text-[var(--os-text-muted)]">Los insumos dados de baja dejan de ofrecerse en los sectores; el historial conserva el nombre con el que se retiraron.</p>
        <EditableList
          testPrefix="catalogo-insumo"
          rows={items}
          onRename={(id, name) => run(() => updateItemApi(id, { name }))}
          onToggle={(id, active) => run(() => updateItemApi(id, { active }))}
          onMove={(id, dir) => run(() => reorderItemsApi(move(items, id, dir)))}
        />
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const n = newItem; void run(async () => { await createItemApi(n); setNewItem(""); }); }}>
          <input className={`${field} min-w-0 flex-1`} placeholder="Nuevo insumo (ej. BOLSAS)" value={newItem} onChange={(e) => setNewItem(e.target.value)} data-testid="catalogo-insumo-nuevo" />
          <Button type="submit" disabled={!newItem.trim()} data-testid="catalogo-insumo-agregar">Agregar insumo</Button>
        </form>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Responsables por sector</h3>
        <p className="text-sm text-[var(--os-text-muted)]">Cada responsable pertenece a un solo sector (la misma persona en dos sectores son dos registros distintos).</p>
        {INSUMO_RESPONSABLE_SECTORS.map((sector) => {
          const rows = responsables.filter((r) => r.sector === sector);
          return (
            <div key={sector} className="space-y-2" data-testid={`catalogo-sector-${sector}`}>
              <h4 className="font-semibold">{SECTOR_LABELS[sector]}</h4>
              <EditableList
                testPrefix={`catalogo-resp-${sector}`}
                rows={rows}
                onRename={(id, name) => run(() => updateResponsableApi(id, { name }))}
                onToggle={(id, active) => run(() => updateResponsableApi(id, { active }))}
                onMove={(id, dir) => run(() => reorderResponsablesApi(sector, move(rows, id, dir)))}
              />
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const n = newResp[sector] ?? ""; void run(async () => { await createResponsableApi(sector, n); setNewResp((s) => ({ ...s, [sector]: "" })); }); }}>
                <input className={`${field} min-w-0 flex-1`} placeholder={`Nuevo responsable de ${SECTOR_LABELS[sector]}`} value={newResp[sector] ?? ""} onChange={(e) => setNewResp((s) => ({ ...s, [sector]: e.target.value }))} data-testid={`catalogo-resp-nuevo-${sector}`} />
                <Button type="submit" disabled={!(newResp[sector] ?? "").trim()} data-testid={`catalogo-resp-agregar-${sector}`}>Agregar</Button>
              </form>
            </div>
          );
        })}
      </section>
    </div>
  );
}
