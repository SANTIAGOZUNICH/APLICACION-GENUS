import { beforeEach, describe, expect, it } from "vitest";
import { MemoryPlanningRepository } from "@/lib/planning/memory-repository";
import { PlanningService } from "@/lib/planning/planning-service";
import { getPlanningSource } from "@/lib/planning/planning-source";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningValidationError,
} from "@/lib/planning/types";
import { projectNativeWorkItems } from "@/lib/planning/native-projector";
import {
  filterWorkItemsForSectorAndPerson,
} from "@/lib/operational/work-item-filters";

const actor = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION",
  displayName: "Agustina Zunich",
};

describe("PlanningService foundation", () => {
  let repo: MemoryPlanningRepository;
  let service: PlanningService;

  beforeEach(() => {
    repo = new MemoryPlanningRepository();
    service = new PlanningService(repo);
  });

  it("crea semana con week_start lunes", async () => {
    const week = await service.createWeek({ weekStart: "2026-07-13" }, actor);
    expect(week.status).toBe("DRAFT");
    expect(week.weekStart).toBe("2026-07-13");
    expect(week.version).toBe(1);
  });

  it("rechaza week_start que no es lunes", async () => {
    await expect(
      service.createWeek({ weekStart: "2026-07-14" }, actor)
    ).rejects.toBeInstanceOf(PlanningValidationError);
  });

  it("crea WorkItems con validación línea/rama", async () => {
    const week = await service.createWeek({ weekStart: "2026-07-13" }, actor);
    const cristian = await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "CAV",
        product: "SHAMPOO",
        plannedQuantity: "100KG",
        sector: "ELABORACION",
        branchOwner: "Cristian",
      },
      actor
    );
    expect(cristian.branchOwner).toBe("Cristian");
    expect(cristian.line).toBeNull();

    await expect(
      service.createItem(
        week.id,
        {
          plannedDate: "2026-07-14",
          client: "X",
          product: "Y",
          plannedQuantity: "1",
          sector: "ELABORACION",
          line: "Línea 1",
        },
        actor
      )
    ).rejects.toBeInstanceOf(PlanningValidationError);

    await expect(
      service.createItem(
        week.id,
        {
          plannedDate: "2026-07-14",
          client: "X",
          product: "Y",
          plannedQuantity: "1",
          sector: "ENVASADO_PREMIUM",
          line: "Línea 3",
        },
        actor
      )
    ).rejects.toBeInstanceOf(PlanningValidationError);

    const masivo = await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "NIZA",
        product: "CREMA",
        plannedQuantity: "500",
        sector: "ENVASADO_MASIVO",
        line: "Línea 1",
      },
      actor
    );
    expect(masivo.line).toBe("Línea 1");
  });

  it("edita con version correcta y falla 409 con version vieja", async () => {
    const week = await service.createWeek({ weekStart: "2026-07-13" }, actor);
    const item = await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "A",
        product: "B",
        plannedQuantity: "10",
        sector: "ELABORACION",
        branchOwner: "Nicolás",
      },
      actor
    );
    const updated = await service.patchItem(
      item.id,
      { version: 1, product: "B2" },
      actor
    );
    expect(updated.version).toBe(2);
    expect(updated.product).toBe("B2");

    await expect(
      service.patchItem(item.id, { version: 1, product: "stale" }, actor)
    ).rejects.toBeInstanceOf(PlanningConflictError);
  });

  it("delete permitido en DRAFT y rechazado tras publicar", async () => {
    const week = await service.createWeek({ weekStart: "2026-07-13" }, actor);
    const a = await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "C1",
        product: "P1",
        plannedQuantity: "1",
        sector: "ELABORACION",
        branchOwner: "Cristian",
      },
      actor
    );
    const b = await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "C2",
        product: "P2",
        plannedQuantity: "1",
        sector: "ELABORACION",
        branchOwner: "Nicolás",
      },
      actor
    );
    await service.deleteItem(a.id, actor);
    expect(await repo.getItem(a.id)).toBeNull();

    await service.publishWeek(week.id, actor);
    await expect(service.deleteItem(b.id, actor)).rejects.toBeInstanceOf(
      PlanningForbiddenError
    );
  });

  it("publicación transaccional y rollback si falla", async () => {
    const week = await service.createWeek({ weekStart: "2026-07-13" }, actor);
    await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "C",
        product: "P",
        plannedQuantity: "1",
        sector: "ENVASADO_MASIVO",
        line: "Línea 1",
      },
      actor
    );

    // publish ok
    const published = await service.publishWeek(week.id, actor);
    expect(published.week.status).toBe("PUBLISHED");
    expect(published.items.every((i) => i.status === "PUBLICADO")).toBe(true);

    // nueva semana para rollback
    const week2 = await service.createWeek({ weekStart: "2026-07-20" }, actor);
    await service.createItem(
      week2.id,
      {
        plannedDate: "2026-07-21",
        client: "C",
        product: "P",
        plannedQuantity: "1",
        sector: "ENVASADO_PREMIUM",
        line: "Línea 1",
      },
      actor
    );
    repo.failPublishHalfway = true;
    await expect(service.publishWeek(week2.id, actor)).rejects.toThrow(
      /Simulated/
    );
    const stillDraft = await repo.getWeekById(week2.id);
    expect(stillDraft?.status).toBe("DRAFT");
    const items = await repo.listItems(week2.id);
    expect(items.every((i) => i.status === "BORRADOR")).toBe(true);
  });

  it("sectores ven solo publicados; ramas y líneas", async () => {
    const week = await service.createWeek({ weekStart: "2026-07-13" }, actor);
    await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "C",
        product: "CRIS",
        plannedQuantity: "1",
        sector: "ELABORACION",
        branchOwner: "Cristian",
      },
      actor
    );
    await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "C",
        product: "NICO",
        plannedQuantity: "1",
        sector: "ELABORACION",
        branchOwner: "Nicolás",
      },
      actor
    );
    await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "M",
        product: "MAS",
        plannedQuantity: "1",
        sector: "ENVASADO_MASIVO",
        line: "Línea 1",
      },
      actor
    );
    await service.createItem(
      week.id,
      {
        plannedDate: "2026-07-14",
        client: "P",
        product: "PRE",
        plannedQuantity: "1",
        sector: "ENVASADO_PREMIUM",
        line: "Línea 1",
      },
      actor
    );

    // borradores no visibles a sectores
    let published = await service.listPublishedItems({ sector: "ELABORACION" });
    expect(published).toHaveLength(0);

    await service.publishWeek(week.id, actor);
    published = await service.listPublishedItems({ sector: "ELABORACION" });
    const domain = projectNativeWorkItems(published);
    const cris = filterWorkItemsForSectorAndPerson(domain, "ELABORACION", "Cristian");
    const nico = filterWorkItemsForSectorAndPerson(domain, "ELABORACION", "Nicolás");
    expect(cris.map((i) => i.product)).toEqual(["CRIS"]);
    expect(nico.map((i) => i.product)).toEqual(["NICO"]);

    const masivo = await service.listPublishedItems({
      sector: "ENVASADO_MASIVO",
    });
    expect(masivo).toHaveLength(1);
    expect(masivo[0]?.line).toBe("Línea 1");

    const premium = await service.listPublishedItems({
      sector: "ENVASADO_PREMIUM",
    });
    expect(premium).toHaveLength(1);
  });

  it("flag planning source sheets es default", () => {
    expect(getPlanningSource()).toBe("sheets");
  });
});
