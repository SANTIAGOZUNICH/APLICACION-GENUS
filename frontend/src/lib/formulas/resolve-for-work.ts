/**
 * Fórmula para la OE automática de un trabajo asignado a Elaboración (servidor). Reutiliza el banco de fórmulas
 * (Neon) y el índice de Google Drive existentes, SOLO LECTURA (nunca modifica Drive ni el banco):
 *  1. banco: coincidencia exacta cliente + producto o alias único (`resolveLookup`); «ambigua» o «en conflicto» → se
 *     informa y no se elige;
 *  2. si el banco no la tiene: Drive, solo con UNA coincidencia exacta del producto en la carpeta del cliente;
 *  3. fórmula incompleta (sin % o total ≠ 100 %) o ilegible → no se usa: la OE queda «pendiente de completar».
 */
import "server-only";
import { readyFormulaBank } from "./get-formula-bank";
import { hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import { formulaIncompleteReason, pickExactDriveHit, type WorkFormulaResolution } from "./work-formula-rules";

export async function resolveFormulaForWork(args: { client: string; product: string }): Promise<WorkFormulaResolution> {
  const client = args.client.trim();
  const product = args.product.trim();
  if (!client || !product) {
    return { ok: false, status: "missing_input", message: "El trabajo no tiene cliente y producto: no se puede buscar la fórmula." };
  }

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
    const { searchDriveProducts, resolveFormulaFromDriveFile } = await import("./drive-formulas-index");
    const hits = await searchDriveProducts(client, product, 50);
    const pick = pickExactDriveHit(hits, product);
    if (pick.kind === "many") {
      return { ok: false, status: "ambiguous", message: `En Drive hay ${pick.count} fórmulas de «${product}» (${client}): no se eligió ninguna.` };
    }
    if (pick.kind === "none") {
      return { ok: false, status: "not_found", message: `No se encontró la fórmula de «${product}» (${client}) en el banco ni en Drive.` };
    }
    const res = await resolveFormulaFromDriveFile({ fileId: pick.hit.fileId, clientHint: client, productHint: product });
    if (!res.found) return { ok: false, status: "error", message: `No se pudo leer la fórmula de Drive: ${res.message}` };
    const why = formulaIncompleteReason(res.materials);
    if (why) return { ok: false, status: "incomplete", message: `${why} Archivo de Drive «${res.snapshot.sourceSheet || pick.hit.fileName}».` };
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
