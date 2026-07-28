import { describe, expect, it, beforeEach } from "vitest";
import {
  getAvisosService,
  resetAvisosMemoryForTests,
} from "@/lib/avisos/avisos-service";
import { AVISO_PARTICIPANT_SECTORS } from "@/lib/avisos/types";
import type { SectorId } from "@/types/operational/sector";

describe("AvisosService", () => {
  beforeEach(() => {
    resetAvisosMemoryForTests();
  });

  it("todos los sectores participantes pueden enviar", async () => {
    const svc = getAvisosService();
    for (const sector of AVISO_PARTICIPANT_SECTORS) {
      const msg = await svc.create(
        { email: `${sector.toLowerCase()}@test`, sector },
        {
          title: `Hola desde ${sector}`,
          body: "Mensaje de prueba",
          priority: "NORMAL",
          toSectors: ["CALIDAD"],
        }
      );
      expect(msg.fromSector).toBe(sector);
      expect(msg.toSectors).toContain("CALIDAD");
    }
  });

  it("lectura y archivo son por destinatario; el aviso persiste", async () => {
    const svc = getAvisosService();
    const msg = await svc.create(
      { email: "prod@test", sector: "PRODUCCION" },
      {
        title: "Urgente",
        body: "Revisar lote",
        priority: "URGENTE",
        toSectors: ["CALIDAD", "MATERIA_PRIMA"],
      }
    );

    await svc.markRead({ email: "cal@test", sector: "CALIDAD" }, msg.id);
    await svc.archive({ email: "cal@test", sector: "CALIDAD" }, msg.id);

    const calidadArch = await svc.list({ email: "cal@test", sector: "CALIDAD" }, "archivados");
    expect(calidadArch.some((m) => m.id === msg.id)).toBe(true);

    const mpInbox = await svc.list({ email: "mp@test", sector: "MATERIA_PRIMA" }, "recibidos");
    expect(mpInbox.some((m) => m.id === msg.id)).toBe(true);
    const mpRec = mpInbox.find((m) => m.id === msg.id)!;
    expect(mpRec.recipients.find((r) => r.sector === "MATERIA_PRIMA")?.archivedAt).toBeNull();

    const sent = await svc.list({ email: "prod@test", sector: "PRODUCCION" }, "enviados");
    expect(sent.some((m) => m.id === msg.id)).toBe(true);

    await svc.restore({ email: "cal@test", sector: "CALIDAD" }, msg.id);
    const calidadInbox = await svc.list({ email: "cal@test", sector: "CALIDAD" }, "recibidos");
    expect(calidadInbox.some((m) => m.id === msg.id)).toBe(true);
  });

  it("toAll envía a todos los participantes", async () => {
    const svc = getAvisosService();
    const msg = await svc.create(
      { email: "mp@test", sector: "MATERIA_PRIMA" },
      {
        title: "Broadcast",
        body: "A todos",
        priority: "IMPORTANTE",
        toSectors: [],
        toAll: true,
      }
    );
    expect(msg.toSectors).toHaveLength(AVISO_PARTICIPANT_SECTORS.length);
  });

  it("no permite sector fuera de participantes", async () => {
    const svc = getAvisosService();
    await expect(
      svc.create(
        { email: "dir@test", sector: "DIRECCION" as SectorId },
        {
          title: "X",
          body: "Y",
          priority: "NORMAL",
          toSectors: ["CALIDAD"],
        }
      )
    ).rejects.toThrow(/no puede enviar/i);
  });
});
