/**
 * Hoja única de MP: el orden de los listados es el de CARGA y no cambia por editar, ajustar kg, ingresar ni egresar.
 * (La persistencia en Postgres — load_seq, concurrencia, históricos — se prueba en scripts/e2e/mp-hoja-unica-validate.mjs.)
 */
import { describe, expect, it } from "vitest";
import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import { InventoryService } from "@/lib/inventory/inventory-service";
import type { SectorId } from "@/types/operational/sector";

const mp = { email: "mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as SectorId };
const NOMBRES = ["Glicerina", "Ácido hialurónico", "Fragancia", "Alcohol cetílico", "Vitamina E"];

function cargar() {
  const repo = new MemoryInventoryRepo();
  const svc = new InventoryService(repo);
  for (const [i, descripcion] of NOMBRES.entries()) {
    svc.upsertMpStock(mp, { descripcion, codigo: `Z-${5 - i}`, lote: `L${i}`, cantidadKg: 10 * (i + 1), proveedor: `P${5 - i}` });
  }
  return { repo, svc };
}
const orden = (svc: InventoryService) => svc.listMpStock(mp).map((r) => r.descripcion);

describe("orden de carga de Stock MP (servicio)", () => {
  it("se lista en el orden en que se cargó, no alfabético ni por código", () => {
    const { svc } = cargar();
    expect(orden(svc)).toEqual(NOMBRES);
  });

  it("editar una fila NO la mueve", () => {
    const { svc } = cargar();
    const segunda = svc.listMpStock(mp)[1]!;
    svc.upsertMpStock(mp, { id: segunda.id, proveedor: "Otro proveedor", ubicacion: "Estante 9", lote: "NUEVO" });
    expect(orden(svc)).toEqual(NOMBRES);
    expect(svc.listMpStock(mp)[1]!.proveedor).toBe("Otro proveedor");
  });

  it("ajustar los kg de un lote NO lo mueve y solo cambia esa cantidad", () => {
    const { svc } = cargar();
    const antes = svc.listMpStock(mp);
    svc.adjustMpStock(mp, antes[0]!.id, 77, "Conteo físico de prueba");
    const despues = svc.listMpStock(mp);
    expect(despues.map((r) => r.descripcion)).toEqual(NOMBRES);
    expect(despues.map((r) => r.cantidadKg)).toEqual([77, ...antes.slice(1).map((r) => r.cantidadKg)]);
  });

  it("una materia prima nueva se agrega AL FINAL y no mueve las anteriores", () => {
    const { svc } = cargar();
    svc.upsertMpStock(mp, { descripcion: "Aceite de coco", codigo: "A-0", lote: "K1", cantidadKg: 5 });
    expect(orden(svc)).toEqual([...NOMBRES, "Aceite de coco"]);
  });

  it("un ingreso confirmado de un lote existente no lo reordena; uno de un lote nuevo queda al final", async () => {
    const { svc } = cargar();
    const base = svc.listMpStock(mp);
    await svc.upsertMpIngreso(mp, {
      fecha: "2026-10-01", remitoNro: "R-1", codigo: base[2]!.codigo, descripcion: base[2]!.descripcion, lote: base[2]!.lote, bultos: 1, cantidad: 4, status: "CONFIRMADO",
    });
    await svc.upsertMpIngreso(mp, {
      fecha: "2026-10-02", remitoNro: "R-2", codigo: "N-1", descripcion: "Nueva MP", lote: "NN", bultos: 1, cantidad: 3, status: "CONFIRMADO",
    });
    expect(orden(svc)).toEqual([...NOMBRES, "Nueva MP"]);
  });

  it("ingresos MP: se listan en el orden de carga aunque la fecha del remito sea anterior", async () => {
    const { svc } = cargar();
    for (const [i, fecha] of ["2026-10-05", "2026-09-01", "2026-10-20"].entries()) {
      await svc.upsertMpIngreso(mp, { fecha, remitoNro: `RR-${i}`, codigo: `Q-${i}`, descripcion: `Q ${i}`, lote: `QL${i}`, bultos: 1, cantidad: 1, status: "BORRADOR" });
    }
    expect(svc.listMpIngresos(mp).map((r) => r.remitoNro)).toEqual(["RR-0", "RR-1", "RR-2"]);
  });
});
