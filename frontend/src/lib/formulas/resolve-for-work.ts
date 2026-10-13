/**
 * Fórmula para la OE automática de un trabajo asignado a Elaboración (servidor). Reutiliza el banco de fórmulas
 * (Neon) y el índice de Google Drive existentes, SOLO LECTURA (nunca modifica Drive ni el banco):
 *  1. banco: coincidencia exacta cliente + producto o alias único (`resolveLookup`); «ambigua» o «en conflicto» → se
 *     informa y no se elige;
 *  2. si el banco no la tiene: Drive, solo con UNA coincidencia exacta del producto en la carpeta del cliente;
 *  3. fórmula incompleta (sin % o total ≠ 100 %) o ilegible → no se usa: la OE queda «pendiente de completar».
 * Cada resultado sin fórmula trae la causa comprobada (`cause`): no está en el banco, no aparece en la carpeta
 * configurada, hay un conflicto o no se pudo acceder a Drive. Si Drive no se pudo consultar, se dice eso.
 */
import "server-only";
import { readyFormulaBank } from "./get-formula-bank";
import { hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import { normalizeSearchKey } from "./types";
import { formulaIncompleteReason, pickExactDriveHit, type WorkFormulaResolution } from "./work-formula-rules";

export async function resolveFormulaForWork(args: { client: string; product: string }): Promise<WorkFormulaResolution> {
  const client = args.client.trim();
  const product = args.product.trim();
  if (!client || !product) {
    return { ok: false, status: "missing_input", cause: "SIN_DATOS", message: "El trabajo no tiene cliente y producto: no se puede buscar la fórmula." };
  }

  // 1) Banco de fórmulas (versión VIGENTE, sin revisión pendiente).
  let bankAvailable = true;
  try {
    const bank = await readyFormulaBank();
    const lookup = bank.resolveLookup(client, product);
    if (lookup.kind === "found") {
      const snap = lookup.snapshot;
      const materials = snap.ingredients.map((i) => ({ materiaPrima: i.materialName, codigo: i.materialCodeOrPhase, formulaPct: i.percentage }));
      const why = formulaIncompleteReason(materials);
      if (why) {
        return { ok: false, status: "incomplete", cause: "BANCO_INCOMPLETA", message: `${why} Fórmula de «${snap.displayProduct}» en el banco de fórmulas: revisala ahí.` };
      }
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
      return {
        ok: false,
        status: "conflict",
        cause: "BANCO_CONFLICTO",
        message: `La fórmula de «${product}» tiene versiones en conflicto en el banco de fórmulas: no se eligió ninguna. ${lookup.message ?? ""}`.trim(),
      };
    }
    if (lookup.reason === "ambiguous") {
      return { ok: false, status: "ambiguous", cause: "BANCO_AMBIGUA", message: `En el banco de fórmulas hay más de una fórmula que coincide con «${product}» (${client}): no se eligió ninguna.` };
    }
  } catch {
    bankAvailable = false;
  }
  const bankPart = bankAvailable
    ? `«${product}» (${client}) no está en el banco de fórmulas`
    : `No se pudo consultar el banco de fórmulas para «${product}» (${client})`;

  // 2) Google Drive (solo lectura), coincidencia exacta y única.
  if (!hasGoogleCredentials()) {
    return {
      ok: false,
      status: "not_found",
      cause: bankAvailable ? "DRIVE_SIN_CONFIGURAR" : "BANCO_NO_DISPONIBLE",
      message: `${bankPart} y Google Drive no está configurado en el servidor, así que no se pudo buscar ahí.`,
    };
  }
  try {
    const { syncDriveFormulasIndex, listDriveClientsCached, searchDriveProducts, resolveFormulaFromDriveFile } = await import("./drive-formulas-index");
    const index = await syncDriveFormulasIndex(false);
    if (!index.ok) {
      const noFolder = /no configurada/i.test(index.error ?? "");
      const noAccess = /sin acceso/i.test(index.error ?? "");
      return {
        ok: false,
        status: "error",
        cause: noFolder ? "DRIVE_SIN_CONFIGURAR" : noAccess ? "DRIVE_SIN_ACCESO" : "DRIVE_ERROR",
        message: noFolder
          ? `${bankPart} y no hay carpeta de fórmulas de Drive configurada.`
          : noAccess
            ? `${bankPart} y la cuenta de GENUS OS no puede abrir la carpeta de fórmulas de Drive: no se sabe si está ahí.`
            : `${bankPart} y no se pudo leer Google Drive en este momento: no se sabe si está ahí. Reintentá más tarde.`,
      };
    }
    const clients = await listDriveClientsCached();
    const clientNorm = normalizeSearchKey(client);
    if (!clients.some((c) => normalizeSearchKey(c) === clientNorm)) {
      return {
        ok: false,
        status: "not_found",
        cause: "NO_EN_BANCO_SIN_CARPETA_CLIENTE",
        message: `${bankPart} y en la carpeta de fórmulas de Drive no hay una carpeta del cliente «${client}» (el nombre tiene que coincidir).`,
      };
    }
    const hits = await searchDriveProducts(client, product, 50);
    const pick = pickExactDriveHit(hits, product);
    if (pick.kind === "many") {
      return { ok: false, status: "ambiguous", cause: "DRIVE_AMBIGUA", message: `En Drive hay ${pick.count} archivos de «${product}» en la carpeta de «${client}»: no se eligió ninguno.` };
    }
    if (pick.kind === "none") {
      return {
        ok: false,
        status: "not_found",
        cause: "NO_EN_BANCO_SIN_ARCHIVO",
        message: `${bankPart} y en la carpeta de «${client}» de Drive no hay un archivo cuyo producto sea exactamente «${product}».`,
      };
    }
    const res = await resolveFormulaFromDriveFile({ fileId: pick.hit.fileId, clientHint: client, productHint: product });
    if (!res.found) {
      return { ok: false, status: "error", cause: "DRIVE_ILEGIBLE", message: `El archivo de Drive «${pick.hit.fileName}» no se pudo leer como fórmula: ${res.message}` };
    }
    const why = formulaIncompleteReason(res.materials);
    if (why) {
      return { ok: false, status: "incomplete", cause: "DRIVE_INCOMPLETA", message: `${why} Archivo de Drive «${pick.hit.fileName}».` };
    }
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
    return {
      ok: false,
      status: "error",
      cause: "DRIVE_ERROR",
      message: `${bankPart} y no se pudo leer Google Drive en este momento: no se sabe si está ahí. La OE queda pendiente; reintentá más tarde.`,
    };
  }
}
