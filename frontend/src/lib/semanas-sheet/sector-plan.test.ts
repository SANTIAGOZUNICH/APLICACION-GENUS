import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOperationalLocks, setOperationalLocksForTests } from "./operational-locks";
import { resetSemanasPrioritiesMemoryForTests, setTaskPriority } from "./semanas-priorities-service";
import { loadSectorPlan, loadSemanasView, setSemanasGatewayForTests, updateTaskPriority, writeSemanasCell } from "./semanas-sheet-service";
import { projectPlanTasks } from "./plan-tasks";
import { XlsxFixtureGateway } from "./xlsx-grid";

vi.mock("@/lib/adapters/drive/operations-document-repository", () => ({
  operationsDocumentRepository: { tryGetCriticalSheetRef: async () => ({ fileId: "semanas-original-indexada" }) },
}));

const COPY = path.resolve(__dirname, "../../../assets/semanas-preview/SEMANAS-2026-copia-de-prueba.xlsx");
const ID = "fixture-semanas-2026";
const TODAY = "2026-05-26";
const prod = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };

describe("Semanas por sector: permisos en el servidor y prioridades compartidas", () => {
  beforeEach(() => {
    vi.stubEnv("SEMANAS_SHEET_ID", ID);
    setSemanasGatewayForTests(new XlsxFixtureGateway(COPY));
    setOperationalLocksForTests(buildOperationalLocks({ deliveries: [], remitos: [], closedWorkItems: [] }));
    resetSemanasPrioritiesMemoryForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setSemanasGatewayForTests(null);
    setOperationalLocksForTests(null);
  });

  it("cada sector recibe SOLO sus tareas; pedir otro sector → 403; sin planificación → 403", async () => {
    const elab = await loadSectorPlan("ELABORACION", null, TODAY);
    expect(elab.sectors).toEqual(["ELABORACION"]);
    expect(elab.tasks.length).toBeGreaterThan(0);
    expect(elab.tasks.every((t) => t.sector === "ELABORACION")).toBe(true);
    const masivo = await loadSectorPlan("ENVASADO_MASIVO", undefined, TODAY);
    expect(masivo.tasks.every((t) => t.sector === "ENVASADO_MASIVO")).toBe(true);
    const premium = await loadSectorPlan("ENVASADO_PREMIUM", "ENVASADO_PREMIUM", TODAY);
    expect(premium.tasks.every((t) => t.sector === "ENVASADO_PREMIUM")).toBe(true);
    await expect(loadSectorPlan("ELABORACION", "ENVASADO_MASIVO", TODAY)).rejects.toMatchObject({ status: 403 });
    await expect(loadSectorPlan("ENVASADO_MASIVO", "ENVASADO_PREMIUM", TODAY)).rejects.toMatchObject({ status: 403 });
    await expect(loadSectorPlan("ENVASADO_MASIVO", "ALGO", TODAY)).rejects.toMatchObject({ status: 403 });
    await expect(loadSectorPlan("CALIDAD", null, TODAY)).rejects.toMatchObject({ status: 403 });
    const codif = await loadSectorPlan("CODIFICADO", null, TODAY);
    expect(new Set(codif.tasks.map((t) => t.sector))).toEqual(new Set(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]));
    await expect(loadSectorPlan("CODIFICADO", "ELABORACION", TODAY)).rejects.toMatchObject({ status: 403 });
    const all = await loadSectorPlan("PRODUCCION", "ALL", TODAY);
    expect(all.tasks.length).toBe(elab.tasks.length + masivo.tasks.length + premium.tasks.length);
  });

  it("a los sectores no se les envían celdas (A1) ni la planilla", async () => {
    const plan = await loadSectorPlan("ELABORACION", null, TODAY);
    expect(JSON.stringify(plan)).not.toMatch(/"a1"|"protection"|"rows"/);
  });

  it("la prioridad que fija Producción es la que ve el sector (y su cambio también); el sector no puede cambiarla", async () => {
    const view = await loadSemanasView("ELABORACION", TODAY);
    const task = projectPlanTasks("ELABORACION", view.weeks!, view.tab, view.priorities, { withCells: true }).find((t) => t.products.some((p) => /CREMA/i.test(p)))!;
    const s1 = await updateTaskPriority(prod, { tabKey: "ELABORACION", taskKey: task.key, priority: "URGENTE", expectedVersion: 0 });
    const seen = (await loadSectorPlan("ELABORACION", null, TODAY)).tasks.find((t) => t.key === task.key)!;
    expect(seen.priority).toBe("URGENTE");
    expect(seen.priorityInfo).toMatchObject({ updatedBy: prod.email, version: 1 });
    // Producción lo baja a NORMAL → el sector lo ve NORMAL
    await updateTaskPriority(prod, { tabKey: "ELABORACION", taskKey: task.key, priority: "NORMAL", expectedVersion: s1.version });
    expect((await loadSectorPlan("ELABORACION", null, TODAY)).tasks.find((t) => t.key === task.key)!.priority).toBe("NORMAL");
    // y en la vista de Producción es exactamente la misma
    const prodView = await loadSemanasView("ELABORACION", TODAY);
    expect(prodView.priorities!.byTask[task.key]!.priority).toBe("NORMAL");
    for (const sector of ["ELABORACION", "ENVASADO_MASIVO", "CODIFICADO", "DIRECCION"] as const) {
      await expect(updateTaskPriority({ ...prod, sector }, { tabKey: "ELABORACION", taskKey: task.key, priority: "URGENTE", expectedVersion: 2 })).rejects.toMatchObject({ status: 403 });
      await expect(setTaskPriority({ ...prod, sector }, { spreadsheetId: ID, tab: "ELABORACION", taskKey: task.key, priority: "URGENTE", expectedVersion: 2 }, view.weeks!)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("los sectores no pueden editar la planificación (celdas) — se rechaza en el servidor", async () => {
    for (const sector of ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "DEPOSITO"] as const) {
      await expect(writeSemanasCell({ ...prod, sector }, { tabKey: "ELABORACION", a1: "B6", expectedValue: "x", value: "y" }, TODAY)).rejects.toMatchObject({ status: 403 });
    }
  });
});
