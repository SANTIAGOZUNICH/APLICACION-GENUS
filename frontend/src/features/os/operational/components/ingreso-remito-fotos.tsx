"use client";

/**
 * Fotos del remito de un ingreso (MP o ME): sacar foto con la cámara del celular/tablet o subir imágenes,
 * varias por ingreso, con progreso y errores; miniaturas y visor ampliable. No toca cantidades ni stock.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Camera, ChevronLeft, ChevronRight, ExternalLink, ImagePlus, Images, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import {
  ADJUNTO_MAX_BYTES,
  validateAdjuntoFile,
  type IngresoAdjunto,
  type IngresoAdjuntoModule,
} from "@/lib/inventory/ingreso-adjuntos-rules";

const API = "/api/v1/inventory/ingreso-adjuntos";

function authHeaders(): Record<string, string> {
  const s = getCurrentAuthSession();
  return { [ACTOR_EMAIL_HEADER]: s?.user.email ?? "", [ACTOR_SECTOR_HEADER]: s?.sector.id ?? "" };
}

/**
 * Cantidad de fotos por ingreso, compartida: la planilla memoriza sus celdas, así que cada botón lee su número de este
 * almacén y se actualiza solo cuando llega el conteo o cambia una foto.
 */
const countsStore = {
  data: { MP: {} as Record<string, number>, ME: {} as Record<string, number> },
  listeners: new Set<() => void>(),
  set(module: IngresoAdjuntoModule, counts: Record<string, number>) {
    this.data = { ...this.data, [module]: counts };
    for (const l of this.listeners) l();
  },
  bump(module: IngresoAdjuntoModule, ingresoId: string, n: number) {
    this.set(module, { ...this.data[module], [ingresoId]: n });
  },
  subscribe(l: () => void) {
    countsStore.listeners.add(l);
    return () => void countsStore.listeners.delete(l);
  },
};

function useAdjuntoCount(module: IngresoAdjuntoModule, ingresoId: string): number {
  return useSyncExternalStore(
    (l) => countsStore.subscribe(l),
    () => countsStore.data[module][ingresoId] ?? 0,
    () => 0
  );
}

/** Carga la cantidad de fotos por ingreso de un módulo (para marcar las filas). */
export function useIngresoAdjuntoCounts(module: IngresoAdjuntoModule, enabled = true) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch(`${API}?module=${module}&counts=1`, { headers: authHeaders(), cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ counts?: Record<string, number> }>) : null))
      .then((body) => {
        if (alive && body) countsStore.set(module, body.counts ?? {});
      })
      .catch(() => {
        /* sin conteo: el botón sigue funcionando */
      });
    return () => {
      alive = false;
    };
  }, [module, enabled, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reload };
}

/**
 * Achica fotos grandes antes de subir (lado mayor 2400 px, JPG 85 %): una foto de celular de 5-10 MB queda en
 * ~1 MB y entra en el límite del servidor. Si el navegador no puede leerla (HEIC fuera de Safari), va tal cual.
 */
async function prepareForUpload(file: File): Promise<File> {
  const small = file.size <= 1.5 * 1024 * 1024 && (file.type === "image/jpeg" || file.type === "image/png");
  if (small || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "remito";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function uploadWithProgress(module: IngresoAdjuntoModule, ingresoId: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<IngresoAdjunto>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { item?: IngresoAdjunto; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* respuesta no JSON (p. ej. límite de tamaño del servidor) */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.item) resolve(body.item);
      else if (xhr.status === 413) reject(new Error(`«${file.name}» es demasiado grande para subir.`));
      else reject(new Error(body.error ?? `No se pudo subir «${file.name}». Volvé a intentar.`));
    };
    xhr.onerror = () => reject(new Error(`Sin conexión: «${file.name}» no se subió. Volvé a intentar.`));
    const fd = new FormData();
    fd.append("module", module);
    fd.append("ingresoId", ingresoId);
    fd.append("file", file, file.name);
    xhr.send(fd);
  });
}

type Pending = { key: string; name: string; pct: number; error?: string };

export function IngresoRemitoFotosButton(props: {
  module: IngresoAdjuntoModule;
  ingresoId: string;
  /** Texto para el título (n.º de ingreso, remito, proveedor). */
  label: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const n = useAdjuntoCount(props.module, props.ingresoId);
  return (
    <>
      <button
        type="button"
        className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-0.5 rounded border px-1.5 text-xs ${n > 0 ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300" : "border-[var(--os-border)] text-[var(--os-text-muted)]"}`}
        title={n > 0 ? `Remito: ${n} foto${n === 1 ? "" : "s"}` : props.canManage ? "Sacar o adjuntar fotos del remito" : "Sin fotos del remito"}
        aria-label={n > 0 ? `Fotos del remito (${n})` : "Fotos del remito"}
        onClick={() => setOpen(true)}
        data-testid="ingreso-fotos-button"
      >
        <Camera className="size-4" />
        {n > 0 ? <span className="font-semibold">{n}</span> : null}
      </button>
      {open ? (
        <IngresoRemitoFotosDialog
          {...props}
          onClose={() => {
            setOpen(false);
            props.onChanged?.();
          }}
        />
      ) : null}
    </>
  );
}

function IngresoRemitoFotosDialog({
  module,
  ingresoId,
  label,
  canManage,
  onClose,
}: {
  module: IngresoAdjuntoModule;
  ingresoId: string;
  label: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<IngresoAdjunto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [viewer, setViewer] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    fetch(`${API}?module=${module}&ingresoId=${encodeURIComponent(ingresoId)}`, { headers: authHeaders(), cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { items?: IngresoAdjunto[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar las fotos.");
        if (alive) {
          setItems(body.items ?? []);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "No se pudieron cargar las fotos.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [module, ingresoId]);

  // Miniaturas: se piden con la sesión (la foto nunca es pública) y se muestran como URL local.
  useEffect(() => {
    let cancelled = false;
    for (const it of items) {
      if (urlsRef.current[it.id] || it.contentType === "application/pdf") continue;
      void fetch(`${API}/${it.id}`, { headers: authHeaders(), cache: "no-store" })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          urlsRef.current = { ...urlsRef.current, [it.id]: url };
          setUrls(urlsRef.current);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [items]);
  useEffect(
    () => () => {
      for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u);
    },
    []
  );
  useEffect(() => {
    if (!loading) countsStore.bump(module, ingresoId, items.length);
  }, [items.length, loading, module, ingresoId]);

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    for (const raw of files) {
      const key = `${raw.name}-${raw.size}-${Math.random()}`;
      setPending((p) => [...p, { key, name: raw.name, pct: 0 }]);
      const setP = (patch: Partial<Pending>) => setPending((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      try {
        const file = await prepareForUpload(raw);
        const v = validateAdjuntoFile({ name: file.name, type: file.type, size: file.size });
        if (!v.ok) throw new Error(v.message);
        const item = await uploadWithProgress(module, ingresoId, file, (pct) => setP({ pct }));
        setItems((prev) => [...prev, item]);
        setPending((p) => p.filter((x) => x.key !== key));
      } catch (e) {
        setP({ error: e instanceof Error ? e.message : "No se pudo subir." });
      }
    }
  };

  const remove = async (it: IngresoAdjunto) => {
    if (!window.confirm(`¿Quitar la foto «${it.fileName}» de este ingreso?`)) return;
    const res = await fetch(`${API}/${it.id}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "No se pudo quitar la foto.");
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    setViewer(null);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(44rem,calc(100vw-16px))] max-w-none overflow-y-auto" data-testid="ingreso-fotos-dialog">
        <DialogTitle>Fotos del remito</DialogTitle>
        <DialogDescription>{label}</DialogDescription>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11 flex-1" onClick={() => cameraRef.current?.click()} data-testid="ingreso-fotos-camara">
              <Camera className="size-5" /> Sacar foto
            </Button>
            <Button type="button" variant="secondary" className="min-h-11 flex-1" onClick={() => galleryRef.current?.click()} data-testid="ingreso-fotos-subir">
              <ImagePlus className="size-5" /> Subir imágenes
            </Button>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = "";
              }}
              data-testid="ingreso-fotos-input-camara"
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
              multiple
              className="hidden"
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = "";
              }}
              data-testid="ingreso-fotos-input"
            />
            <p className="w-full text-xs text-[var(--os-text-muted)]">
              JPG, PNG o HEIC, hasta {ADJUNTO_MAX_BYTES / 1024 / 1024} MB cada una (las fotos grandes se achican solas). Podés subir varias.
            </p>
          </div>
        ) : null}

        {pending.length ? (
          <ul className="space-y-1" data-testid="ingreso-fotos-pendientes">
            {pending.map((p) => (
              <li key={p.key} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  {p.error ? (
                    <button type="button" className="text-[var(--os-text-muted)] underline" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>
                      Cerrar
                    </button>
                  ) : (
                    <span>{p.pct}%</span>
                  )}
                </div>
                {p.error ? (
                  <p className="text-rose-600" role="alert" data-testid="ingreso-fotos-error">
                    {p.error}
                  </p>
                ) : (
                  <div className="h-1.5 rounded bg-[var(--os-border)]">
                    <div className="h-1.5 rounded bg-[var(--os-teal,#0d9488)]" style={{ width: `${p.pct}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="text-sm text-rose-600" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--os-text-muted)]">Cargando fotos…</p>
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-[var(--os-text-muted)]" data-testid="ingreso-fotos-vacio">
            <Images className="size-4" /> Este ingreso todavía no tiene fotos del remito.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="ingreso-fotos-lista">
            {items.map((it, i) => (
              <li key={it.id} className="overflow-hidden rounded border border-[var(--os-border)]" data-testid="ingreso-foto">
                <button type="button" className="block aspect-[4/3] w-full bg-[var(--os-bg)]" onClick={() => (it.contentType === "application/pdf" ? window.open(`${API}/${it.id}`, "_blank", "noopener") : setViewer(i))} title="Ampliar">
                  {it.contentType === "application/pdf" ? (
                    <span className="flex h-full items-center justify-center text-xs text-[var(--os-text-muted)]">PDF · tocar para abrir</span>
                  ) : urls[it.id] && it.contentType !== "image/heic" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[it.id]} alt={it.fileName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-[var(--os-text-muted)]">
                      {it.contentType === "image/heic" ? "HEIC · tocar para abrir" : "Cargando…"}
                    </span>
                  )}
                </button>
                <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-[11px] text-[var(--os-text-muted)]">
                  <span className="truncate" title={`${it.fileName} · ${it.uploadedBy}`}>
                    {new Date(it.uploadedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })} · {it.uploadedBy.split("@")[0]}
                  </span>
                  {canManage ? (
                    <button type="button" aria-label="Quitar foto" title="Quitar foto" onClick={() => void remove(it)} data-testid="ingreso-foto-quitar">
                      <Trash2 className="size-3.5 text-rose-600" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {viewer != null && items[viewer] ? (
          <FotoViewer
            item={items[viewer]}
            url={urls[items[viewer].id]}
            index={viewer}
            total={items.length}
            onPrev={() => setViewer((v) => (v == null ? v : (v - 1 + items.length) % items.length))}
            onNext={() => setViewer((v) => (v == null ? v : (v + 1) % items.length))}
            onClose={() => setViewer(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FotoViewer({
  item,
  url,
  index,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  item: IngresoAdjunto;
  url?: string;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const heic = item.contentType === "image/heic";
  const info = useMemo(
    () => `${item.fileName} · ${new Date(item.uploadedAt).toLocaleString("es-AR")} · ${item.uploadedBy}`,
    [item]
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="left-0 top-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black/95 p-0 text-white"
        data-testid="ingreso-foto-visor"
      >
      <DialogTitle className="sr-only">Foto ampliada</DialogTitle>
      <div className="flex items-center justify-between gap-2 p-2 pr-12 text-xs">
        <span className="truncate">
          {index + 1}/{total} · {info}
        </span>
        <div className="flex items-center gap-1">
          {!heic ? (
            <button type="button" className="rounded p-2 hover:bg-white/10" onClick={() => setZoom((z) => !z)} aria-label={zoom ? "Ajustar a pantalla" : "Ampliar"}>
              {zoom ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
            </button>
          ) : null}
          {url ? (
            <a className="rounded p-2 hover:bg-white/10" href={url} target="_blank" rel="noreferrer" aria-label="Abrir en otra pestaña" download={heic ? item.fileName : undefined}>
              <ExternalLink className="size-5" />
            </a>
          ) : null}
        </div>
      </div>
      <div className={`relative flex-1 ${zoom ? "overflow-auto" : "flex items-center justify-center overflow-hidden"}`}>
        {heic ? (
          <p className="m-auto max-w-sm p-4 text-center text-sm">
            Este navegador no muestra fotos HEIC. Usá «Abrir en otra pestaña» para descargarla, o abrila desde un iPhone/Mac.
          </p>
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={item.fileName}
            onClick={() => setZoom((z) => !z)}
            className={zoom ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
            data-testid="ingreso-foto-visor-img"
          />
        ) : (
          <p className="m-auto text-sm">Cargando…</p>
        )}
        {total > 1 ? (
          <>
            <button type="button" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2" onClick={onPrev} aria-label="Anterior">
              <ChevronLeft className="size-6" />
            </button>
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2" onClick={onNext} aria-label="Siguiente">
              <ChevronRight className="size-6" />
            </button>
          </>
        ) : null}
      </div>
      </DialogContent>
    </Dialog>
  );
}
