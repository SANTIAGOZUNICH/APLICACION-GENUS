import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import {
  assertFeatureWritesEnabled,
  isFeatureMemoryAllowed,
  isFeatureSchemaReady,
  SchemaPendingError,
} from "@/lib/db/feature-schema";
import { mpWeeklyControlLines, mpWeeklyControls } from "@/lib/db/schema";
import { enrichControlLine } from "./calcs";
import {
  canReadMpControl,
  canWriteMpControl,
  type MpControlActor,
  type MpFormulaSnapshot,
  type MpWeeklyControl,
  type MpWeeklyControlLine,
} from "./types";

type Mem = { controls: MpWeeklyControl[] };
const g = globalThis as unknown as { __genusMpControlMem?: Mem };
function mem(): Mem {
  if (!g.__genusMpControlMem) g.__genusMpControlMem = { controls: [] };
  return g.__genusMpControlMem;
}

function assertRead(actor: MpControlActor) {
  if (!canReadMpControl(actor.sector)) throw new Error("Sin permiso de lectura MP Control.");
}
function assertWrite(actor: MpControlActor) {
  if (!canWriteMpControl(actor.sector)) throw new Error("Solo MP puede editar el Control semanal.");
}

function buildLinesFromSnapshot(
  snapshot: MpFormulaSnapshot,
  quantityKg: number | null,
  stockByCodigo: Record<string, number> = {}
): MpWeeklyControlLine[] {
  return snapshot.materials.map((m, i) => {
    const enriched = enrichControlLine({
      codigo: m.codigo ?? "",
      materiaPrima: m.materiaPrima ?? "",
      formulaPct: m.formulaPct,
      quantityKg,
      stockActual: stockByCodigo[(m.codigo ?? "").trim()] ?? 0,
      sortOrder: i,
    });
    return { id: randomUUID(), ...enriched };
  });
}

function recalcLines(
  lines: MpWeeklyControlLine[],
  quantityKg: number | null
): MpWeeklyControlLine[] {
  return lines.map((l, i) => {
    const e = enrichControlLine({
      codigo: l.codigo,
      materiaPrima: l.materiaPrima,
      formulaPct: l.formulaPct,
      quantityKg,
      stockActual: l.stockActual,
      kgEditados: l.kgEditados,
      lote: l.lote,
      preparado: l.preparado,
      observacion: l.observacion,
      sortOrder: i,
    });
    return { ...l, ...e, id: l.id };
  });
}

function rowToControl(
  row: typeof mpWeeklyControls.$inferSelect,
  lines: Array<typeof mpWeeklyControlLines.$inferSelect>
): MpWeeklyControl {
  return {
    id: row.id,
    status: row.status as MpWeeklyControl["status"],
    client: row.client,
    product: row.product,
    quantityKg: row.quantityKg,
    linkedOeId: row.linkedOeId,
    driveFileId: row.driveFileId,
    driveModifiedTime: row.driveModifiedTime,
    driveChecksum: row.driveChecksum,
    formulaSnapshot: row.formulaSnapshot as MpFormulaSnapshot | null,
    source: row.source,
    lines: lines
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        id: l.id,
        sortOrder: l.sortOrder,
        codigo: l.codigo,
        materiaPrima: l.materiaPrima,
        formulaPct: l.formulaPct,
        kgNecesarios: l.kgNecesarios,
        kgEditados: l.kgEditados,
        stockActual: l.stockActual,
        stockProyectado: l.stockProyectado,
        diferencia: l.diferencia,
        estado: l.estado as MpWeeklyControlLine["estado"],
        lote: l.lote,
        preparado: l.preparado,
        observacion: l.observacion,
      })),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export class MpControlService {
  async list(actor: MpControlActor): Promise<MpWeeklyControl[]> {
    assertRead(actor);
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const rows = await db
          .select()
          .from(mpWeeklyControls)
          .orderBy(desc(mpWeeklyControls.updatedAt));
        const out: MpWeeklyControl[] = [];
        for (const row of rows) {
          const lines = await db
            .select()
            .from(mpWeeklyControlLines)
            .where(eq(mpWeeklyControlLines.controlId, row.id));
          out.push(rowToControl(row, lines));
        }
        return out;
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }
    if (!isFeatureMemoryAllowed()) return [];
    return [...mem().controls].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(actor: MpControlActor, id: string): Promise<MpWeeklyControl | null> {
    assertRead(actor);
    const all = await this.list(actor);
    return all.find((c) => c.id === id) ?? null;
  }

  async create(
    actor: MpControlActor,
    input: {
      client: string;
      product: string;
      quantityKg: number | null;
      linkedOeId?: string | null;
      snapshot: MpFormulaSnapshot;
      stockByCodigo?: Record<string, number>;
    }
  ): Promise<MpWeeklyControl> {
    assertWrite(actor);
    await assertFeatureWritesEnabled();
    const now = new Date().toISOString();
    const lines = buildLinesFromSnapshot(
      input.snapshot,
      input.quantityKg,
      input.stockByCodigo
    );
    const control: MpWeeklyControl = {
      id: randomUUID(),
      status: "BORRADOR",
      client: input.client,
      product: input.product,
      quantityKg: input.quantityKg,
      linkedOeId: input.linkedOeId ?? null,
      driveFileId: input.snapshot.driveFileId ?? null,
      driveModifiedTime: input.snapshot.driveModifiedTime ?? null,
      driveChecksum: input.snapshot.driveChecksum ?? null,
      formulaSnapshot: input.snapshot,
      source: input.snapshot.source,
      lines,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await this.persist(control);
    return control;
  }

  async update(
    actor: MpControlActor,
    id: string,
    patch: {
      quantityKg?: number | null;
      client?: string;
      product?: string;
      linkedOeId?: string | null;
      lines?: MpWeeklyControlLine[];
      status?: "BORRADOR" | "COMPLETADO";
      /** Si true, recalcula kg desde snapshot sin alterar formulaSnapshot. */
      recalcFromSnapshot?: boolean;
      stockByCodigo?: Record<string, number>;
    }
  ): Promise<MpWeeklyControl> {
    assertWrite(actor);
    await assertFeatureWritesEnabled();
    const existing = await this.get(actor, id);
    if (!existing) throw new Error("Control no encontrado.");
    if (existing.status === "COMPLETADO" && patch.status !== "BORRADOR") {
      // permitir solo lectura tras completar salvo reopen explícito no pedido
    }
    let lines = patch.lines ?? existing.lines;
    const quantityKg =
      patch.quantityKg !== undefined ? patch.quantityKg : existing.quantityKg;

    if (patch.recalcFromSnapshot && existing.formulaSnapshot) {
      const snap = existing.formulaSnapshot;
      lines = buildLinesFromSnapshot(snap, quantityKg, patch.stockByCodigo).map(
        (nl, i) => {
          const prev = existing.lines[i];
          return {
            ...nl,
            id: prev?.id ?? nl.id,
            kgEditados: prev?.kgEditados ?? null,
            lote: prev?.lote ?? "",
            preparado: prev?.preparado ?? false,
            observacion: prev?.observacion ?? "",
          };
        }
      );
      lines = recalcLines(lines, quantityKg);
    } else {
      lines = recalcLines(lines, quantityKg);
    }

    const now = new Date().toISOString();
    const next: MpWeeklyControl = {
      ...existing,
      client: patch.client ?? existing.client,
      product: patch.product ?? existing.product,
      quantityKg,
      linkedOeId:
        patch.linkedOeId !== undefined ? patch.linkedOeId : existing.linkedOeId,
      lines,
      status: patch.status ?? existing.status,
      updatedBy: actor.email,
      updatedAt: now,
      completedAt:
        patch.status === "COMPLETADO"
          ? now
          : patch.status === "BORRADOR"
            ? null
            : existing.completedAt,
      // snapshot inmutable: nunca se sobrescribe aquí
      formulaSnapshot: existing.formulaSnapshot,
    };
    await this.persist(next);
    return next;
  }

  async deleteDraft(actor: MpControlActor, id: string): Promise<void> {
    assertWrite(actor);
    await assertFeatureWritesEnabled();
    const existing = await this.get(actor, id);
    if (!existing) throw new Error("Control no encontrado.");
    if (existing.status !== "BORRADOR") {
      throw new Error("Solo se pueden eliminar borradores.");
    }
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db.delete(mpWeeklyControls).where(eq(mpWeeklyControls.id, id));
        return;
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    mem().controls = mem().controls.filter((c) => c.id !== id);
  }

  private async persist(control: MpWeeklyControl): Promise<void> {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db
          .insert(mpWeeklyControls)
          .values({
            id: control.id,
            status: control.status,
            client: control.client,
            product: control.product,
            quantityKg: control.quantityKg,
            linkedOeId: control.linkedOeId,
            driveFileId: control.driveFileId,
            driveModifiedTime: control.driveModifiedTime,
            driveChecksum: control.driveChecksum,
            formulaSnapshot: control.formulaSnapshot,
            source: control.source,
            createdBy: control.createdBy,
            updatedBy: control.updatedBy,
            createdAt: new Date(control.createdAt),
            updatedAt: new Date(control.updatedAt),
            completedAt: control.completedAt
              ? new Date(control.completedAt)
              : null,
            audit: {
              updatedBy: control.updatedBy,
              at: control.updatedAt,
              action: "persist",
            },
          })
          .onConflictDoUpdate({
            target: mpWeeklyControls.id,
            set: {
              status: control.status,
              client: control.client,
              product: control.product,
              quantityKg: control.quantityKg,
              linkedOeId: control.linkedOeId,
              updatedBy: control.updatedBy,
              updatedAt: new Date(control.updatedAt),
              completedAt: control.completedAt
                ? new Date(control.completedAt)
                : null,
            },
          });
        await db
          .delete(mpWeeklyControlLines)
          .where(eq(mpWeeklyControlLines.controlId, control.id));
        if (control.lines.length) {
          await db.insert(mpWeeklyControlLines).values(
            control.lines.map((l) => ({
              id: l.id,
              controlId: control.id,
              sortOrder: l.sortOrder,
              codigo: l.codigo,
              materiaPrima: l.materiaPrima,
              formulaPct: l.formulaPct,
              kgNecesarios: l.kgNecesarios,
              kgEditados: l.kgEditados,
              stockActual: l.stockActual,
              stockProyectado: l.stockProyectado,
              diferencia: l.diferencia,
              estado: l.estado,
              lote: l.lote,
              preparado: l.preparado,
              observacion: l.observacion,
              payload: {},
            }))
          );
        }
        return;
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const idx = mem().controls.findIndex((c) => c.id === control.id);
    if (idx >= 0) mem().controls[idx] = control;
    else mem().controls.unshift(control);
  }
}

let singleton: MpControlService | null = null;
export function getMpControlService(): MpControlService {
  if (!singleton) singleton = new MpControlService();
  return singleton;
}

export function resetMpControlMemoryForTests(): void {
  g.__genusMpControlMem = { controls: [] };
  singleton = null;
}
