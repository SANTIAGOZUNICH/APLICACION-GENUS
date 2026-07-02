import { describe, expect, it } from "vitest";
import { createSectorWorkItem, createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import {
  analyzeWorkflow,
  buildWhyBlockedContext,
  getBlockingReason,
  isBlocked,
  resolveWorkflow,
  resolveWorkflowStageId,
} from "@/lib/workflow-engine";

describe("Workflow Engine — F9.4", () => {
  describe("resolveWorkflowStageId", () => {
    it("mapea sectores a etapas de flujo de planta", () => {
      expect(resolveWorkflowStageId(createSectorWorkItem("ELABORACION", "w1"))).toBe("ELABORACION");
      expect(resolveWorkflowStageId(createSectorWorkItem("ENVASADO_MASIVO", "w2"))).toBe(
        "ENVASADO_MASIVO"
      );
      expect(resolveWorkflowStageId(createSectorWorkItem("ENVASADO_PREMIUM", "w3"))).toBe(
        "ENVASADO_PREMIUM"
      );
      expect(resolveWorkflowStageId(createSectorWorkItem("CALIDAD", "w4"))).toBe("CALIDAD");
    });
  });

  describe("Trabajo → Estado", () => {
    it("detecta bloqueo explícito en WorkItem", () => {
      const item = createTestWorkItem({
        id: "blocked-1",
        sector: "ENVASADO_MASIVO",
        status: "bloqueado",
        blockedBy: ["Falta granel liberado"],
      });

      expect(isBlocked(item)).toBe(true);
      expect(getBlockingReason(item)).toContain("WorkItem marcado como bloqueado.");
      expect(getBlockingReason(item)).toContain("Bloqueado por: Falta granel liberado");
    });

    it("resuelve flujo sin mutar el WorkItem", () => {
      const item = createSectorWorkItem("ELABORACION", "oe-flow");
      const workflow = resolveWorkflow(item);

      expect(workflow.stage).toBe("ELABORACION");
      expect(workflow.nextStages.length).toBeGreaterThan(0);
      expect(workflow.previousStages).toContain("PLANIFICACION");
    });
  });

  describe("analyzeWorkflow", () => {
    it("agrega carga y bloqueos de una colección de WorkItems", () => {
      const items = [
        createSectorWorkItem("ELABORACION", "a", { status: "pendiente" }),
        createSectorWorkItem("ENVASADO_MASIVO", "b", {
          status: "bloqueado",
          blockedBy: ["OE pendiente"],
        }),
        createSectorWorkItem("CALIDAD", "c", { status: "pendiente" }),
      ];

      const analysis = analyzeWorkflow(items);

      expect(analysis.totalItems).toBe(3);
      expect(analysis.blocked.length).toBeGreaterThanOrEqual(1);
      expect(analysis.stageLoad.length).toBeGreaterThan(0);
      expect(analysis.scannedAt).toBeTruthy();
    });
  });

  describe("Contexto Creamy (headless)", () => {
    it("genera explicación cuando el trabajo está bloqueado", () => {
      const item = createTestWorkItem({
        id: "blocked-creamy",
        sector: "ENVASADO_MASIVO",
        status: "bloqueado",
        blockedBy: ["Granel no liberado"],
      });

      const context = buildWhyBlockedContext(item);
      expect(context.questionType).toBe("why_blocked");
      expect(context.headline).toBe("Trabajo bloqueado");
      expect(getBlockingReason(item).join(" ")).toContain("Granel no liberado");
    });
  });
});
