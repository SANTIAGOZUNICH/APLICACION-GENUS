import "server-only";

import { eq, inArray, or } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { mpWeeklyControls, operationalOrders } from "@/lib/db/schema";
import type { MpWeeklyControl } from "@/lib/mp-control/types";
import { normalizeSearchKey, type FormulaProductRecord } from "@/lib/formulas/types";

export type FormulaUsageRef = {
  kind: "OE" | "OA" | "MP_CONTROL";
  id: string;
  label: string;
};

type MemMp = { controls: MpWeeklyControl[] };
const g = globalThis as unknown as { __genusMpControlMem?: MemMp };

function memMpControls(): MpWeeklyControl[] {
  return g.__genusMpControlMem?.controls ?? [];
}

function matchesControlProduct(
  control: { client: string; product: string },
  product: FormulaProductRecord
): boolean {
  return (
    normalizeSearchKey(control.client) === product.normalizedClient &&
    normalizeSearchKey(control.product) === product.normalizedProduct
  );
}

function scanMpControlUsage(product: FormulaProductRecord): FormulaUsageRef[] {
  const out: FormulaUsageRef[] = [];
  for (const c of memMpControls()) {
    if (!matchesControlProduct(c, product) && !c.formulaSnapshot) continue;
    if (
      matchesControlProduct(c, product) ||
      (c.formulaSnapshot &&
        normalizeSearchKey(c.formulaSnapshot.client) === product.normalizedClient &&
        normalizeSearchKey(c.formulaSnapshot.product) === product.normalizedProduct)
    ) {
      out.push({
        kind: "MP_CONTROL",
        id: c.id,
        label: `${c.client} / ${c.product}`.trim() || c.id,
      });
    }
  }
  return out;
}

/** Referencias OE/OA/control que impiden borrado definitivo. */
export async function findFormulaUsageRefs(
  product: FormulaProductRecord,
  versionIds: string[]
): Promise<FormulaUsageRef[]> {
  const refs: FormulaUsageRef[] = [];

  if (isDatabaseConfigured()) {
    const db = getDb();
    const orderPredicates = [eq(operationalOrders.formulaProductId, product.id)];
    if (versionIds.length) {
      orderPredicates.push(inArray(operationalOrders.formulaVersionId, versionIds));
    }
    const orderRows = await db
      .select({
        id: operationalOrders.id,
        type: operationalOrders.type,
        orderNumber: operationalOrders.orderNumber,
        formulaProductId: operationalOrders.formulaProductId,
        formulaVersionId: operationalOrders.formulaVersionId,
      })
      .from(operationalOrders)
      .where(or(...orderPredicates));

    for (const row of orderRows) {
      if (row.formulaProductId !== product.id && !versionIds.includes(row.formulaVersionId ?? "")) {
        continue;
      }
      refs.push({
        kind: row.type === "OA" ? "OA" : "OE",
        id: row.id,
        label: row.orderNumber,
      });
    }

    try {
      const controls = await db.select().from(mpWeeklyControls);
      for (const row of controls) {
        if (
          matchesControlProduct(row, product) ||
          (row.formulaSnapshot &&
            typeof row.formulaSnapshot === "object" &&
            normalizeSearchKey(String((row.formulaSnapshot as { client?: string }).client ?? "")) ===
              product.normalizedClient &&
            normalizeSearchKey(String((row.formulaSnapshot as { product?: string }).product ?? "")) ===
              product.normalizedProduct)
        ) {
          refs.push({
            kind: "MP_CONTROL",
            id: row.id,
            label: `${row.client} / ${row.product}`.trim() || row.id,
          });
        }
      }
    } catch {
      /* tabla opcional según migración */
    }
  }

  refs.push(...scanMpControlUsage(product));

  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
