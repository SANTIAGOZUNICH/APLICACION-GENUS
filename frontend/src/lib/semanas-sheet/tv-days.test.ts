import { describe, expect, it } from "vitest";
import { pickTvDays, type TvDay } from "./tv-days";

const day = (date: string, d: number): TvDay => ({ date, weekId: "1", d });
const planned = [day("2026-05-04", 0), day("2026-05-05", 1), day("2026-05-06", 2), day("2026-05-07", 3), day("2026-05-11", 0)];

describe("Modo TV — elección de días (sin inventar datos)", () => {
  it("hoy y el siguiente día con planificación (salta fines de semana)", () => {
    expect(pickTvDays(planned, "2026-05-07", 2)).toEqual({ days: [day("2026-05-07", 3), day("2026-05-11", 0)], reason: null });
  });
  it("3 días en pantallas grandes", () => {
    expect(pickTvDays(planned, "2026-05-05", 3).days.map((d) => d.date)).toEqual(["2026-05-05", "2026-05-06", "2026-05-07"]);
  });
  it("si hoy no está planificado usa el próximo día cargado y lo informa", () => {
    const r = pickTvDays(planned, "2026-05-08", 2);
    expect(r.days[0]!.date).toBe("2026-05-11");
    expect(r.reason).toMatch(/no tiene planificación/);
  });
  it("si hoy es posterior a todo lo cargado muestra los últimos días y lo informa", () => {
    const r = pickTvDays(planned, "2026-10-08", 2);
    expect(r.days.map((d) => d.date)).toEqual(["2026-05-07", "2026-05-11"]);
    expect(r.reason).toMatch(/últimos días cargados/);
  });
  it("sin planificación no muestra nada", () => {
    expect(pickTvDays([], "2026-05-06", 2)).toEqual({ days: [], reason: null });
  });
});
