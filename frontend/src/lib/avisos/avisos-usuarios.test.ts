import { beforeEach, describe, expect, it } from "vitest";
import { AvisosService, resetAvisosMemoryForTests, resolveRecipients } from "./avisos-service";
import type { AvisoDirectoryUser } from "./directory";

const dir: AvisoDirectoryUser[] = [
  { email: "ana@lab", name: "Ana", sector: "ENVASADO_MASIVO", roleLabel: "Supervisora", responsable: true },
  { email: "beto@lab", name: "Beto", sector: "ENVASADO_MASIVO", roleLabel: "Operario", responsable: false },
  { email: "carla@lab", name: "Carla", sector: "ENVASADO_MASIVO", roleLabel: "Operaria", responsable: false },
  { email: "dani@lab", name: "Dani", sector: "ELABORACION", roleLabel: "Operario", responsable: false },
];
const directory = async () => dir;
const prod = { email: "prod@lab", sector: "PRODUCCION" as const, displayName: "Prod Uno" };
const base = { title: "Priorizar", body: "Priorizar el pedido de Pilar para mañana", priority: "IMPORTANTE" as const, toSectors: [] as never[] };

describe("Avisos por usuario", () => {
  beforeEach(() => resetAvisosMemoryForTests());

  it("un usuario específico: solo esa persona lo recibe; su lectura es individual", async () => {
    const svc = new AvisosService(directory);
    const m = await svc.create(prod, { ...base, toUsers: ["beto@lab"] });
    const beto = { email: "beto@lab", sector: "ENVASADO_MASIVO" as const };
    const ana = { email: "ana@lab", sector: "ENVASADO_MASIVO" as const };
    expect((await svc.list(beto, "recibidos")).map((x) => x.id)).toEqual([m.id]);
    expect(await svc.list(ana, "recibidos")).toEqual([]); // mismo sector, otra persona: NO lo recibe
    expect(await svc.list({ email: "dani@lab", sector: "ELABORACION" }, "recibidos")).toEqual([]);
    const read = await svc.markRead(beto, m.id);
    expect(read?.mine?.readAt).toBeTruthy();
  });

  it("varios usuarios: cada uno tiene su propio leído / archivado", async () => {
    const svc = new AvisosService(directory);
    const m = await svc.create(prod, { ...base, toUsers: ["beto@lab", "dani@lab"] });
    const beto = { email: "beto@lab", sector: "ENVASADO_MASIVO" as const };
    const dani = { email: "dani@lab", sector: "ELABORACION" as const };
    await svc.markRead(beto, m.id);
    const forBeto = (await svc.list(beto, "recibidos"))[0]!;
    const forDani = (await svc.list(dani, "recibidos"))[0]!;
    expect(forBeto.mine?.readAt).toBeTruthy();
    expect(forDani.mine?.readAt).toBeNull(); // no se marcó para los demás
    await svc.archive(dani, m.id);
    expect((await svc.list(beto, "recibidos")).length).toBe(1);
    expect((await svc.list(dani, "recibidos")).length).toBe(0);
    expect((await svc.list(dani, "archivados")).length).toBe(1);
  });

  it("responsables de un sector: solo ellos, no todo el sector", async () => {
    const svc = new AvisosService(directory);
    const m = await svc.create(prod, { ...base, toSectors: ["ENVASADO_MASIVO"], onlyResponsables: true });
    expect(m.toSectors).toEqual([]);
    expect(m.userRecipients.map((u) => [u.email, u.via])).toEqual([["ana@lab", "RESPONSABLE"]]);
    expect((await svc.list({ email: "ana@lab", sector: "ENVASADO_MASIVO" }, "recibidos")).length).toBe(1);
    expect((await svc.list({ email: "beto@lab", sector: "ENVASADO_MASIVO" }, "recibidos")).length).toBe(0);
  });

  it("un sector completo sigue funcionando como antes (todos sus integrantes)", async () => {
    const svc = new AvisosService(directory);
    const m = await svc.create(prod, { ...base, toSectors: ["ENVASADO_MASIVO"] });
    expect(m.toSectors).toEqual(["ENVASADO_MASIVO"]);
    expect((await svc.list({ email: "carla@lab", sector: "ENVASADO_MASIVO" }, "recibidos")).length).toBe(1);
  });

  it("valida destinatarios: usuario inexistente, sector sin responsables y aviso sin destinatarios", async () => {
    await expect(resolveRecipients(prod, { ...base, toUsers: ["nadie@lab"] }, directory)).rejects.toThrow(/No existe un usuario activo/);
    await expect(resolveRecipients(prod, { ...base, toSectors: ["CALIDAD"], onlyResponsables: true }, directory)).rejects.toThrow(/no tiene responsables/);
    await expect(resolveRecipients(prod, { ...base }, directory)).rejects.toThrow(/al menos un destinatario/);
  });

  it("no se avisa a sí mismo ni se repite una persona de un sector ya incluido", async () => {
    const r = await resolveRecipients({ ...prod, email: "beto@lab" }, { ...base, toSectors: ["ELABORACION"], toUsers: ["beto@lab", "dani@lab", "carla@lab"] }, directory);
    expect(r.sectorWide).toEqual(["ELABORACION"]);
    expect(r.users.map((u) => u.email)).toEqual(["carla@lab"]);
  });
});
