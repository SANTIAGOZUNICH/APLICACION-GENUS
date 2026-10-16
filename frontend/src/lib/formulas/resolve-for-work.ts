/**
 * Fórmula para la OE automática de un trabajo asignado a Elaboración (servidor). SOLO LECTURA (nunca modifica Drive,
 * el banco ni permisos).
 *
 * Fuente: carpeta NUEVA de Drive («ORDEN DE ELABORACION», ver drive-formula-source.ts), una vez validada su indexación:
 *  1. vínculo explícito cliente + producto → archivo (elegido por Producción), si el archivo sigue vigente y accesible;
 *     si no, se avisa (nunca se usa otro archivo en silencio);
 *  2. si no hay vínculo: búsqueda en el índice (cliente primero, después producto); se usa SOLO con una coincidencia
 *     fuerte y única; varias (copias, versiones) o parecidas → «ambigua»/«no encontrada» y Producción elige y vincula;
 *  3. fórmula incompleta (sin % o total ≠ 100 %) o ilegible → no se usa: la OE queda «pendiente de completar».
 *
 * Mientras la carpeta nueva no se haya indexado bien al menos una vez, se mantiene la búsqueda anterior (banco de
 * fórmulas + carpeta configurada en memoria), para no dejar a Elaboración sin OE durante el cambio.
 */
import "server-only";
import { readyFormulaBank } from "./get-formula-bank";
import { hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import { formulaIncompleteReason, pickExactDriveHit, resolveCrossSourceDuplicates, type WorkFormulaResolution } from "./work-formula-rules";

export async function resolveFormulaForWork(args: { client: string; product: string; actor?: { email: string; sector: string } }): Promise<WorkFormulaResolution> {
  const client = args.client.trim();
  const product = args.product.trim();
  if (!client || !product) {
    return { ok: false, status: "missing_input", message: "El trabajo no tiene cliente y producto: no se puede buscar la fórmula." };
  }

  const src = await import("./drive-formula-source");
  if (await src.isNewFormulaSourceValidated()) return resolveFromNewDriveSource(client, product, args.actor);

  // --- Ubicación anterior (solo hasta validar la carpeta nueva) ---
  // 1) Banco de fórmulas (versión VIGENTE, sin revisión pendiente).
  let bankMessage = "";
  try {
    const bank = await readyFormulaBank();
    const lookup = bank.resolveLookup(client, product);
    if (lookup.kind === "found") {
      const snap = lookup.snapshot;
      const materials = snap.ingredients.map((i) => ({ materiaPrima: i.materialName, codigo: i.materialCodeOrPhase, formulaPct: i.percentage }));
      const why = formulaIncompleteReason(materials);
      if (why) return { ok: false, status: "incomplete", message: `${why} Fórmula de «${snap.displayProduct}»: revisala en el banco de fórmulas.` };
      return {
        ok: true,
        ref: {
          source: "CACHE_NEON",
          formulaProductId: snap.formulaProductId,
          formulaVersionId: snap.formulaVersionId,
          versionHash: snap.versionHash,
          displayClient: snap.displayClient,
          displayProduct: snap.displayProduct,
          productCode: snap.productCode,
        },
        materials,
        procedureSteps: snap.procedureSteps.map((s) => ({ id: s.id, text: s.instruction })),
      };
    }
    if (lookup.kind === "conflict") {
      return { ok: false, status: "conflict", message: `La fórmula de «${product}» tiene versiones en conflicto: no se eligió ninguna. ${lookup.message ?? ""}`.trim() };
    }
    if (lookup.reason === "ambiguous") {
      return { ok: false, status: "ambiguous", message: `Hay más de una fórmula que coincide con «${product}» (${client}): no se eligió ninguna.` };
    }
    bankMessage = lookup.message ?? "";
  } catch {
    bankMessage = "No se pudo consultar el banco de fórmulas.";
  }

  // 2) Google Drive (solo lectura), coincidencia exacta y única.
  if (!hasGoogleCredentials()) {
    return { ok: false, status: "not_found", message: `No se encontró la fórmula de «${product}» (${client}). ${bankMessage}`.trim() };
  }
  try {
    const { searchDriveProducts, resolveFormulaFromDriveFile, downloadDriveFormulaBuffer } = await import("./drive-formulas-index");
    const hits = await searchDriveProducts(client, product, 50);
    const pick = pickExactDriveHit(hits, product);
    let chosen = pick.kind === "one" ? pick.hit : null;
    if (pick.kind === "many") {
      // ¿Está en más de una carpeta de fórmulas (principal y adicional)? Se comparan los archivos (solo lectura).
      const crossFolder = new Set(pick.hits.map((h) => h.sourceFolderId)).size > 1;
      const checksums = crossFolder
        ? await Promise.all(pick.hits.map(async (h) => (await downloadDriveFormulaBuffer(h.fileId, h.mimeType)).checksum))
        : [];
      const dup = resolveCrossSourceDuplicates(pick.hits, checksums);
      if (dup.kind === "conflict") {
        return {
          ok: false,
          status: "conflict",
          message: `«${product}» (${client}) está en más de una carpeta de fórmulas de Drive con versiones distintas (${pick.hits.map((h) => `«${h.fileName}»`).join(", ")}): no se eligió ninguna. Dejá una sola versión o pasala al banco de fórmulas.`,
        };
      }
      if (dup.kind === "same_folder") {
        return { ok: false, status: "ambiguous", message: `En Drive hay ${pick.count} fórmulas de «${product}» (${client}): no se eligió ninguna.` };
      }
      chosen = dup.hit; // mismo archivo en las dos carpetas: no es conflicto
    }
    if (!chosen) {
      return { ok: false, status: "not_found", message: `No se encontró la fórmula de «${product}» (${client}) en el banco ni en Drive.` };
    }
    const res = await resolveFormulaFromDriveFile({ fileId: chosen.fileId, clientHint: client, productHint: product });
    if (!res.found) return { ok: false, status: "error", message: `No se pudo leer la fórmula de Drive: ${res.message}` };
    const why = formulaIncompleteReason(res.materials);
    if (why) return { ok: false, status: "incomplete", message: `${why} Archivo de Drive «${res.snapshot.sourceSheet || chosen.fileName}».` };
    return {
      ok: true,
      ref: {
        source: "DRIVE",
        formulaProductId: res.snapshot.formulaProductId,
        formulaVersionId: res.snapshot.formulaVersionId,
        versionHash: res.snapshot.versionHash,
        displayClient: res.snapshot.displayClient,
        displayProduct: res.snapshot.displayProduct,
        productCode: res.snapshot.productCode,
        driveFileId: res.snapshot.driveFileId,
        driveModifiedTime: res.snapshot.driveModifiedTime,
        sourceSheet: res.snapshot.sourceSheet,
      },
      materials: res.materials,
      procedureSteps: res.procedureSteps,
    };
  } catch {
    return { ok: false, status: "error", message: "No se pudo leer Google Drive para buscar la fórmula. La OE queda pendiente; reintentá más tarde." };
  }
}

/** Carpeta nueva: vínculo vigente → índice (coincidencia fuerte y única). */
async function resolveFromNewDriveSource(client: string, product: string, actor?: { email: string; sector: string }): Promise<WorkFormulaResolution> {
  const src = await import("./drive-formula-source");
  let lookup: Awaited<ReturnType<typeof src.lookupFormulaForWork>>;
  try {
    lookup = await src.lookupFormulaForWork(client, product);
    // ¿Se agregó el archivo hace poco? Si no aparece, se actualiza el índice (si tiene más de 10 minutos) y se reintenta.
    if (lookup.kind === "match" && lookup.decision.kind === "none") {
      // Sin carpeta del cliente puede ser una carpeta recién agregada: se reindexa si el índice tiene más de 2 minutos.
      await src.ensureFreshIndex((lookup.decision.clientFolders.length ? 10 : 2) * 60 * 1000);
      lookup = await src.lookupFormulaForWork(client, product);
    }
  } catch {
    return { ok: false, status: "error", message: "No se pudo consultar el índice de fórmulas. La OE queda pendiente; reintentá más tarde." };
  }
  if (lookup.kind === "link_invalid") {
    return { ok: false, status: "error", message: `Fórmula vinculada «${lookup.link.fileName}»: ${lookup.message}` };
  }
  let file: { fileId: string; fileName: string; clientFolderName: string; modifiedTime: string | null };
  if (lookup.kind === "linked") file = lookup.file;
  else if (lookup.decision.kind === "one") file = lookup.decision.file;
  else if (lookup.decision.kind === "ambiguous") return { ok: false, status: "ambiguous", message: lookup.decision.message };
  else return { ok: false, status: "not_found", message: lookup.decision.message };

  try {
    const { parseDriveFormulaBuffer } = await import("./drive-formulas-index");
    const data = await src.readIndexedFile(file.fileId);
    const res = parseDriveFormulaBuffer({
      buffer: data.buffer,
      checksum: data.checksum,
      fileId: file.fileId,
      fileName: file.fileName,
      modifiedTime: file.modifiedTime,
      client: file.clientFolderName,
      productHint: product,
      knownClients: [file.clientFolderName],
    });
    if (!res.found) return { ok: false, status: "error", message: `No se pudo leer la fórmula del archivo «${file.fileName}»: ${res.message}` };
    const why = formulaIncompleteReason(res.materials);
    if (why) return { ok: false, status: "incomplete", message: `${why} Archivo de Drive «${file.fileName}».` };
    // Única coincidencia segura → queda vinculada para las próximas asignaciones del mismo cliente + producto.
    if (lookup.kind === "match" && actor) await src.autoLinkFormula(actor, { client, product, fileId: file.fileId }).catch(() => false);
    return {
      ok: true,
      ref: {
        source: "DRIVE",
        formulaProductId: res.snapshot.formulaProductId,
        formulaVersionId: res.snapshot.formulaVersionId,
        versionHash: res.snapshot.versionHash,
        displayClient: res.snapshot.displayClient,
        displayProduct: res.snapshot.displayProduct,
        productCode: res.snapshot.productCode,
        driveFileId: res.snapshot.driveFileId,
        driveModifiedTime: res.snapshot.driveModifiedTime,
        sourceSheet: res.snapshot.sourceSheet,
      },
      materials: res.materials,
      procedureSteps: res.procedureSteps,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return { ok: false, status: "error", message: `No se pudo abrir el archivo «${file.fileName}» de Drive. ${msg}`.trim() };
  }
}
