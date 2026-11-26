"use client";

/** Configuración del mapa (Depósito y Dirección): posiciones, geometría y forma del plano. Formularios simples; nada se elimina (se desactiva lo vacío). */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cfgActualizar, cfgCrear, cfgForma, cfgPlano } from "@/lib/ubicaciones/client";
import { SHAPE_KINDS, SHAPE_KIND_LABEL } from "@/lib/ubicaciones/rules";
import type { MapView, ShapeView, UbicacionView } from "@/lib/ubicaciones/types";
import { fieldCls } from "./ubicaciones-dialogs";

const small = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 text-base";
const lbl = "block text-xs font-medium";

type Geo = { x: string; y: string; w: string; h: string };
const geoOf = (l: { x: number; y: number; w: number; h: number }): Geo => ({ x: String(l.x), y: String(l.y), w: String(l.w), h: String(l.h) });

function GeoInputs({ geo, onChange, testid }: { geo: Geo; onChange: (g: Geo) => void; testid: string }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {(["x", "y", "w", "h"] as const).map((k) => (
        <label key={k} className={lbl}>
          {k === "w" ? "Ancho" : k === "h" ? "Alto" : k.toUpperCase()}
          <input className={small} inputMode="decimal" value={geo[k]} onChange={(e) => onChange({ ...geo, [k]: e.target.value })} data-testid={`${testid}-${k}`} />
        </label>
      ))}
    </div>
  );
}

export function LocationConfigForm({ location, onSaved, onError }: { location: UbicacionView; onSaved: (message: string) => void; onError: (m: string) => void }) {
  const [code, setCode] = useState(location.code);
  const [zone, setZone] = useState(location.zone);
  const [order, setOrder] = useState(String(location.sortOrder));
  const [geo, setGeo] = useState<Geo>(geoOf(location));
  const [busy, setBusy] = useState(false);
  const occupied = location.items.length > 0;
  async function save(patch?: { active: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      await cfgActualizar({ id: location.id, expectedVersion: location.version, code, zone, sortOrder: Number(order), ...geo, ...(patch ?? {}) });
      onSaved(patch ? (patch.active ? `Ubicación ${code} reactivada.` : `Ubicación ${code} desactivada.`) : `Ubicación ${code} actualizada.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3" data-testid="ubi-config-form">
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Código<input className={small} value={code} disabled={occupied} onChange={(e) => setCode(e.target.value)} data-testid="ubi-config-code" /></label>
        <label className={lbl}>Zona<input className={small} value={zone} onChange={(e) => setZone(e.target.value)} data-testid="ubi-config-zone" /></label>
      </div>
      {occupied ? <p className="text-xs text-[var(--os-text-muted)]">Está ocupada: no se puede cambiar el código ni desactivar hasta liberarla.</p> : null}
      <GeoInputs geo={geo} onChange={setGeo} testid="ubi-config" />
      <label className={lbl}>Orden<input className={small} inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value.replace(/\D/g, ""))} /></label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" onClick={() => void save()} disabled={busy} data-testid="ubi-config-guardar">Guardar cambios</Button>
        <Button type="button" variant="secondary" className="min-h-11" disabled={busy || (location.active && occupied)} onClick={() => void save({ active: !location.active })} data-testid="ubi-config-activa">{location.active ? "Desactivar" : "Reactivar"}</Button>
      </div>
    </div>
  );
}

export function NewLocationForm({ onSaved, onError }: { onSaved: (message: string, id: string) => void; onError: (m: string) => void }) {
  const [code, setCode] = useState("");
  const [zone, setZone] = useState("");
  const [geo, setGeo] = useState<Geo>({ x: "10", y: "10", w: "50", h: "36" });
  const [busy, setBusy] = useState(false);
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await cfgCrear({ code, zone, ...geo });
      setCode("");
      onSaved(`Ubicación ${r.location.code} creada.`, r.location.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3" data-testid="ubi-new-form">
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Código<input className={small} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ej.: F01" data-testid="ubi-new-code" /></label>
        <label className={lbl}>Zona<input className={small} value={zone} onChange={(e) => setZone(e.target.value)} data-testid="ubi-new-zone" /></label>
      </div>
      <GeoInputs geo={geo} onChange={setGeo} testid="ubi-new" />
      <Button type="button" className="min-h-11" onClick={() => void create()} disabled={busy || !code.trim()} data-testid="ubi-new-crear">Crear ubicación</Button>
    </div>
  );
}

function ShapeForm({ shape, onSaved, onError }: { shape: ShapeView | null; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [kind, setKind] = useState<string>(shape?.kind ?? "PASILLO");
  const [label, setLabel] = useState(shape?.label ?? "");
  const [sublabel, setSublabel] = useState(shape?.sublabel ?? "");
  const [geo, setGeo] = useState<Geo>(shape ? geoOf(shape) : { x: "10", y: "10", w: "40", h: "40" });
  const [rotation, setRotation] = useState(String(shape?.rotation ?? 0));
  const [points, setPoints] = useState(shape?.points ? JSON.stringify(shape.points) : "");
  const [busy, setBusy] = useState(false);
  async function save(active?: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await cfgForma({ ...(shape ? { id: shape.id } : {}), kind, label, sublabel, ...geo, rotation: Number(rotation) || 0, ...(kind === "CONTORNO" ? { points } : {}), ...(active === undefined ? {} : { active }) });
      onSaved(shape ? "Forma actualizada." : "Forma creada.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo guardar la forma.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-xl border border-[var(--os-border)] p-3" data-testid="ubi-shape-form">
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Tipo
          <select className={small} value={kind} disabled={Boolean(shape)} onChange={(e) => setKind(e.target.value)}>{SHAPE_KINDS.map((k) => <option key={k} value={k}>{SHAPE_KIND_LABEL[k]}</option>)}</select>
        </label>
        <label className={lbl}>Rotación del texto<input className={small} inputMode="numeric" value={rotation} onChange={(e) => setRotation(e.target.value)} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Texto<input className={small} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className={lbl}>Subtexto<input className={small} value={sublabel} onChange={(e) => setSublabel(e.target.value)} /></label>
      </div>
      {kind === "CONTORNO" ? (
        <label className={lbl}>Puntos del contorno (JSON [[x,y],…])<textarea className={`${small} min-h-20 font-mono text-sm`} value={points} onChange={(e) => setPoints(e.target.value)} /></label>
      ) : <GeoInputs geo={geo} onChange={setGeo} testid="ubi-shape" />}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" onClick={() => void save()} disabled={busy}>{shape ? "Guardar forma" : "Crear forma"}</Button>
        {shape ? <Button type="button" variant="secondary" className="min-h-11" onClick={() => void save(!shape.active)} disabled={busy}>{shape.active ? "Ocultar" : "Mostrar"}</Button> : null}
      </div>
    </div>
  );
}

export function ShapesDialog({ map, onClose, onSaved, onError }: { map: MapView; onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState(map.config.title);
  const [w, setW] = useState(String(map.config.width));
  const [h, setH] = useState(String(map.config.height));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(40rem,calc(100vw-16px))] max-w-[min(40rem,calc(100vw-16px))] overflow-y-auto p-4 sm:p-6" data-testid="ubi-shapes-dialog">
        <DialogHeader>
          <DialogTitle>Forma del plano</DialogTitle>
          <DialogDescription>Contorno, pasillos, escalera y vacío. Las formas se ocultan, no se borran.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-xl border border-[var(--os-border)] p-3">
          <label className={lbl}>Título del plano<input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={lbl}>Ancho del lienzo<input className={small} inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} /></label>
            <label className={lbl}>Alto del lienzo<input className={small} inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></label>
          </div>
          <Button type="button" className="min-h-11" onClick={() => void cfgPlano({ title, width: Number(w), height: Number(h) }).then(() => onSaved("Plano actualizado.")).catch((e) => onError(e instanceof Error ? e.message : "No se pudo guardar."))}>Guardar plano</Button>
        </div>
        {map.shapes.map((s) => <ShapeForm key={`${s.id}-${s.x}-${s.y}-${s.active}`} shape={s} onSaved={onSaved} onError={onError} />)}
        <h4 className="text-sm font-semibold">Nueva forma</h4>
        <ShapeForm shape={null} onSaved={onSaved} onError={onError} />
      </DialogContent>
    </Dialog>
  );
}
