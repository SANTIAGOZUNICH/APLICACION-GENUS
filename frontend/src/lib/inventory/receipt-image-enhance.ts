/**
 * Mejora AUTOMÁTICA de fotos de remitos para la segunda etapa de lectura (solo servidor, `sharp`).
 *
 * Principios:
 *  - La imagen ORIGINAL nunca se modifica ni se reemplaza: esto trabaja sobre una copia temporal en memoria que no se guarda.
 *  - Solo filtros que no alteran el trazo (orientación EXIF, normalización de iluminación / sombras, contraste, nitidez suave,
 *    recorte de márgenes uniformes, ampliación sin pérdida de resolución). Nada de binarizado duro, umbrales ni reducción de tamaño
 *    que pueda confundir un 1 con un 7 o un 5 con un 6.
 *  - Si `sharp` no está disponible o una imagen no se puede procesar, se devuelve vacío y la lectura sigue con el original.
 */
import "server-only";

export type ImageBytes = { bytes: Uint8Array; contentType: string };
export type EnhanceRegion = "completa" | "encabezado" | "tabla";
export type EnhancedImage = ImageBytes & { region: EnhanceRegion; sourceIndex: number };

/** Lado mayor máximo de la copia mejorada: sin reducir fotos normales, sin disparar el peso del pedido. */
const MAX_SIDE = 3000;
const MIN_SIDE_FOR_UPSCALE = 1600;
const TARGET_SIDE_UPSCALE = 2200;
const JPEG_QUALITY = 88;
const MAX_BYTES = 3_500_000;

type Sharp = typeof import("sharp");
let sharpModule: Sharp | null | undefined;
async function loadSharp(): Promise<Sharp | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    const mod = (await import("sharp")) as unknown as { default?: Sharp } & Sharp;
    sharpModule = (mod.default ?? mod) as Sharp;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

export const isImageType = (t: string) => /^image\/(jpeg|png|webp)$/i.test(t);

/**
 * Normaliza la iluminación dividiendo cada píxel por el «fondo» del papel (sombras, viñeteado, flash): equivale a un color-dodge contra
 * el fondo desenfocado invertido. Conserva el contraste del texto y aplana las sombras suaves.
 */
async function flatten(sharp: Sharp, input: Buffer): Promise<{ buf: Buffer; width: number; height: number }> {
  const base = sharp(input, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).grayscale();
  const meta = await base.clone().toBuffer({ resolveWithObject: true });
  const { width, height } = meta.info;
  // El fondo se calcula en baja resolución (rápido) y se vuelve a la medida original.
  const smallW = Math.max(16, Math.round(width / 8));
  const bg = await sharp(meta.data, { failOn: "none" }).resize(smallW).blur(6).resize(width, height, { fit: "fill" }).negate().toBuffer();
  const leveled = await sharp(meta.data, { failOn: "none" }).composite([{ input: bg, blend: "colour-dodge" }]).toBuffer();
  return { buf: leveled, width, height };
}

async function finish(sharp: Sharp, input: Buffer, width: number, height: number, scaleTo: number | null): Promise<Buffer> {
  let pipeline = sharp(input, { failOn: "none" }).normalize({ lower: 1, upper: 99 }).sharpen({ sigma: 1.1, m1: 0.8, m2: 1.4 });
  const longest = Math.max(width, height);
  if (scaleTo && longest > 0 && Math.abs(scaleTo - longest) > 8) {
    const k = Math.min(scaleTo, MAX_SIDE) / longest;
    pipeline = pipeline.resize(Math.round(width * k), Math.round(height * k), { kernel: "lanczos3", fit: "fill" });
  }
  let quality = JPEG_QUALITY;
  let out = await pipeline.jpeg({ quality, mozjpeg: false }).toBuffer();
  while (out.length > MAX_BYTES && quality > 60) {
    quality -= 8;
    out = await sharp(out, { failOn: "none" }).jpeg({ quality }).toBuffer();
  }
  return out;
}

/** Recorta los márgenes uniformes (mesa, fondo) solo si queda al menos el 55 % de la imagen: nunca se «come» parte del documento. */
async function trimMargins(sharp: Sharp, buf: Buffer, width: number, height: number): Promise<{ buf: Buffer; width: number; height: number }> {
  try {
    const t = await sharp(buf, { failOn: "none" }).trim({ threshold: 18 }).toBuffer({ resolveWithObject: true });
    if (t.info.width * t.info.height >= 0.55 * width * height) return { buf: t.data, width: t.info.width, height: t.info.height };
  } catch {
    /* sin recorte */
  }
  return { buf: buf, width, height };
}

/**
 * Devuelve versiones mejoradas de las fotos (las hojas PDF no se tocan). `regions` pide además recortes ampliados del encabezado y/o de
 * la tabla de la PRIMERA hoja, para releer solo lo que faltó con más resolución sobre el texto chico.
 */
export async function enhanceReceiptImages(files: ImageBytes[], opts: { regions?: Array<Exclude<EnhanceRegion, "completa">> } = {}): Promise<{ images: EnhancedImage[]; applied: boolean; reason?: string }> {
  const sharp = await loadSharp();
  if (!sharp) return { images: [], applied: false, reason: "sharp_no_disponible" };
  const out: EnhancedImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    if (!isImageType(f.contentType)) continue; // HEIC/PDF: el servicio de lectura los procesa tal cual
    try {
      const src = Buffer.from(f.bytes);
      const flat = await flatten(sharp, src);
      const trimmed = await trimMargins(sharp, flat.buf, flat.width, flat.height);
      const longest = Math.max(trimmed.width, trimmed.height);
      const scaleTo = longest < MIN_SIDE_FOR_UPSCALE ? TARGET_SIDE_UPSCALE : null; // fotos chicas: se amplían; las grandes no se reducen
      out.push({ bytes: new Uint8Array(await finish(sharp, trimmed.buf, trimmed.width, trimmed.height, scaleTo)), contentType: "image/jpeg", region: "completa", sourceIndex: i });
      if (i === 0 && opts.regions?.length) {
        for (const region of opts.regions) {
          const top = region === "encabezado" ? 0 : Math.round(trimmed.height * 0.3);
          const h = region === "encabezado" ? Math.round(trimmed.height * 0.4) : trimmed.height - top;
          const crop = await sharp(trimmed.buf, { failOn: "none" }).extract({ left: 0, top, width: trimmed.width, height: Math.max(8, h) }).toBuffer({ resolveWithObject: true });
          out.push({ bytes: new Uint8Array(await finish(sharp, crop.data, crop.info.width, crop.info.height, Math.max(2200, Math.max(crop.info.width, crop.info.height)))), contentType: "image/jpeg", region, sourceIndex: i });
        }
      }
    } catch {
      // Esta foto no se pudo mejorar: se sigue con las demás y con el original.
    }
  }
  return { images: out, applied: out.length > 0, ...(out.length ? {} : { reason: "sin_imagenes_mejorables" }) };
}
