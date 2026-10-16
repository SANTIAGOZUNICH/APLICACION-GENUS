import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  businessCalendar,
  easterSunday,
  holidayMap,
  movableHolidayDate,
  nationalHolidays,
  stageCountdown,
  toBuenosAiresDate,
} from "./business-days";

describe("feriados nacionales argentinos", () => {
  it("Pascua", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("2026 coincide con el calendario oficial (Ley 27.399)", () => {
    expect(nationalHolidays(2026).map((h) => h.date)).toEqual([
      "2026-01-01",
      "2026-02-16", // Carnaval
      "2026-02-17",
      "2026-03-24",
      "2026-04-02",
      "2026-04-03", // Viernes Santo
      "2026-05-01",
      "2026-05-25",
      "2026-06-15", // Güemes: 17/6 es miércoles → lunes anterior
      "2026-06-20",
      "2026-07-09",
      "2026-08-17", // lunes: no se mueve
      "2026-10-12", // lunes: no se mueve
      "2026-11-23", // Soberanía: 20/11 es viernes → lunes siguiente
      "2026-12-08",
      "2026-12-25",
    ]);
  });

  it("regla de traslado: martes/miércoles → lunes anterior, jueves/viernes → lunes siguiente, fin de semana y lunes no se mueven", () => {
    expect(movableHolidayDate(2025, 6, 17)).toBe("2025-06-16"); // martes
    expect(movableHolidayDate(2026, 6, 17)).toBe("2026-06-15"); // miércoles
    expect(movableHolidayDate(2025, 11, 20)).toBe("2025-11-24"); // jueves
    expect(movableHolidayDate(2026, 11, 20)).toBe("2026-11-23"); // viernes
    expect(movableHolidayDate(2025, 8, 17)).toBe("2025-08-17"); // domingo
    expect(movableHolidayDate(2026, 8, 17)).toBe("2026-08-17"); // lunes
  });

  it("los puentes turísticos (Res. 164/2025) no son feriados salvo que se pidan", () => {
    expect(holidayMap([2026]).has("2026-03-23")).toBe(false);
    expect(holidayMap([2026], { includeBridgeDays: true }).get("2026-03-23")?.kind).toBe("puente");
  });

  it("excepciones por decreto: se pueden sumar y quitar fechas", () => {
    const m = holidayMap([2026], { adjustments: { add: [{ date: "2026-09-10", name: "Extra" }], remove: ["2026-10-12"] } });
    expect(m.has("2026-09-10")).toBe(true);
    expect(m.has("2026-10-12")).toBe(false);
  });
});

describe("días hábiles", () => {
  const cal = businessCalendar();

  it("no cuenta sábados, domingos ni feriados", () => {
    expect(cal.isBusinessDay("2026-10-09")).toBe(true); // viernes
    expect(cal.isBusinessDay("2026-10-10")).toBe(false); // sábado
    expect(cal.isBusinessDay("2026-10-11")).toBe(false); // domingo
    expect(cal.isBusinessDay("2026-10-12")).toBe(false); // feriado
    expect(cal.isBusinessDay("2026-10-13")).toBe(true);
  });

  it("el día de inicio no cuenta; el de llegada sí", () => {
    expect(cal.businessDaysBetween("2026-10-05", "2026-10-05")).toBe(0);
    expect(cal.businessDaysBetween("2026-10-05", "2026-10-06")).toBe(1);
    expect(cal.businessDaysBetween("2026-10-09", "2026-10-13")).toBe(1); // fin de semana largo
    expect(cal.businessDaysBetween("2026-10-09", "2026-10-05")).toBe(0);
  });

  it("sumar días hábiles salta fines de semana y feriados", () => {
    expect(cal.addBusinessDays("2026-10-05", 10)).toBe("2026-10-20");
    expect(cal.addBusinessDays("2026-12-04", 1)).toBe("2026-12-07"); // lunes 7/12: puente, no feriado
    expect(cal.addBusinessDays("2026-12-04", 2)).toBe("2026-12-09"); // martes 8/12 es feriado
  });

  it("zona horaria de Buenos Aires (UTC-3), no la del servidor", () => {
    expect(toBuenosAiresDate("2026-10-06T02:30:00Z")).toBe("2026-10-05");
    expect(toBuenosAiresDate("2026-10-06T03:00:00Z")).toBe("2026-10-06");
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("cuenta regresiva de una etapa", () => {
  const start = "2026-10-05T13:00:00Z"; // lunes 10:00 en Buenos Aires

  it("descuenta desde el ingreso real, sin contar el día de ingreso", () => {
    expect(stageCountdown(start, "2026-10-05T20:00:00Z", 10)).toMatchObject({ elapsedDays: 0, remainingDays: 10 });
    expect(stageCountdown(start, "2026-10-06T15:00:00Z", 10)).toMatchObject({ elapsedDays: 1, remainingDays: 9 });
  });

  it("excluye fines de semana y el feriado del 12/10", () => {
    // 6,7,8,9 + 13,14,15,16 + 19 = 9 días hábiles
    expect(stageCountdown(start, "2026-10-19T15:00:00Z", 10)).toMatchObject({ elapsedDays: 9, remainingDays: 1, estimatedDate: "2026-10-20" });
  });

  it("si el plazo se supera no hay números negativos", () => {
    const t = stageCountdown(start, "2026-10-20T15:00:00Z", 10)!;
    expect(t).toMatchObject({ remainingDays: 0, overdue: false, progressPct: 100 });
    const late = stageCountdown(start, "2026-11-30T15:00:00Z", 10)!;
    expect(late.remainingDays).toBe(0);
    expect(late.elapsedDays).toBe(10);
    expect(late.overdue).toBe(true);
  });

  it("sin inicio verificable no inventa nada", () => {
    expect(stageCountdown(null, "2026-10-19T15:00:00Z", 10)).toBeNull();
    expect(stageCountdown(undefined, "2026-10-19T15:00:00Z", 10)).toBeNull();
    expect(stageCountdown("no es una fecha", "2026-10-19T15:00:00Z", 10)).toBeNull();
    expect(stageCountdown("", "2026-10-19T15:00:00Z", 10)).toBeNull();
  });

  it("el inicio cerca de la medianoche usa la fecha de Buenos Aires", () => {
    // 23:30 del domingo 4/10 en BA = 02:30Z del lunes: el ingreso es del domingo, el lunes ya descuenta 1
    expect(stageCountdown("2026-10-05T02:30:00Z", "2026-10-05T15:00:00Z", 5)).toMatchObject({ startDate: "2026-10-04", elapsedDays: 1, remainingDays: 4 });
  });

  it("etapa de 5 días (Envasado) con feriado largo en el medio", () => {
    // ingreso viernes 9/10: el 12/10 es feriado → lunes 12 y sábado/domingo no cuentan
    const t = stageCountdown("2026-10-09T14:00:00Z", "2026-10-13T14:00:00Z", 5)!;
    expect(t).toMatchObject({ elapsedDays: 1, remainingDays: 4, estimatedDate: "2026-10-19" });
  });
});
