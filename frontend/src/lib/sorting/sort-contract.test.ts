import { describe, expect, it } from "vitest";
import {
  applySort,
  compareDates,
  compareNumbers,
  compareNumericField,
  compareStrings,
  compareVtoNearest,
  extractTrailingNumber,
  type SortOption,
} from "./sort-contract";

describe("extractTrailingNumber", () => {
  it("extrae el número de formatos mixtos reales de la app", () => {
    expect(extractTrailingNumber("OA-2026-000145")).toBe(145);
    expect(extractTrailingNumber("OA-2026-4521")).toBe(4521);
    expect(extractTrailingNumber("OP-4521")).toBe(4521);
    expect(extractTrailingNumber("4521")).toBe(4521);
    expect(extractTrailingNumber(4521)).toBe(4521);
  });

  it("null si no hay dígitos — nunca inventa un 0", () => {
    expect(extractTrailingNumber(null)).toBeNull();
    expect(extractTrailingNumber(undefined)).toBeNull();
    expect(extractTrailingNumber("")).toBeNull();
    expect(extractTrailingNumber("sin número")).toBeNull();
  });
});

describe("compareNumericField — regla dura: numérico, no alfabético (2, 9, 10, 100)", () => {
  it("ordena 2, 9, 10, 100 correctamente ascendente", () => {
    const values = ["100", "10", "2", "9"];
    const sorted = [...values].sort((a, b) => compareNumericField(a, b, "asc"));
    expect(sorted).toEqual(["2", "9", "10", "100"]);
  });

  it("NUNCA produce el orden alfabético incorrecto (10, 100, 2, 9)", () => {
    const values = ["100", "10", "2", "9"];
    const sorted = [...values].sort((a, b) => compareNumericField(a, b, "asc"));
    expect(sorted).not.toEqual(["10", "100", "2", "9"]);
  });

  it("ordena OA mezclando números con y sin ceros a la izquierda (bug real de native-orders-list-view)", () => {
    // OA-2026-99 (sin padding) vs OA-2026-000145 (con padding) — un
    // localeCompare de string plano ordenaría "000145" antes que "99"
    // (comparación caracter a caracter: '0' < '9'), dando 145 antes que 99,
    // que es numéricamente incorrecto.
    const values = ["OA-2026-000145", "OA-2026-99", "OA-2026-4521", "OA-2026-2"];
    const sorted = [...values].sort((a, b) => compareNumericField(a, b, "asc"));
    expect(sorted).toEqual(["OA-2026-2", "OA-2026-99", "OA-2026-000145", "OA-2026-4521"]);
  });

  it("descendente invierte el orden", () => {
    const values = ["2", "9", "10", "100"];
    const sorted = [...values].sort((a, b) => compareNumericField(a, b, "desc"));
    expect(sorted).toEqual(["100", "10", "9", "2"]);
  });

  it("nulls/vacíos siempre al final, en ambas direcciones", () => {
    const values: Array<string | null> = ["10", null, "2", "", "9"];
    const asc = [...values].sort((a, b) => compareNumericField(a, b, "asc"));
    expect(asc.slice(0, 3)).toEqual(["2", "9", "10"]);
    expect(asc.slice(3)).toEqual(expect.arrayContaining([null, ""]));
    const desc = [...values].sort((a, b) => compareNumericField(a, b, "desc"));
    expect(desc.slice(0, 3)).toEqual(["10", "9", "2"]);
  });
});

describe("compareStrings — A-Z/Z-A, insensible a mayúsculas, números embebidos correctos", () => {
  it("ordena A-Z insensible a mayúsculas y tildes básicas", () => {
    const values = ["zapallo", "Acondicionador", "banana"];
    const sorted = [...values].sort((a, b) => compareStrings(a, b, "asc"));
    expect(sorted).toEqual(["Acondicionador", "banana", "zapallo"]);
  });

  it("Z-A invierte", () => {
    const values = ["Acondicionador", "banana", "zapallo"];
    const sorted = [...values].sort((a, b) => compareStrings(a, b, "desc"));
    expect(sorted).toEqual(["zapallo", "banana", "Acondicionador"]);
  });

  it("números embebidos en texto ordenan numéricamente (Línea 2 antes que Línea 10)", () => {
    const values = ["Línea 10", "Línea 2", "Línea 1"];
    const sorted = [...values].sort((a, b) => compareStrings(a, b, "asc"));
    expect(sorted).toEqual(["Línea 1", "Línea 2", "Línea 10"]);
  });

  it("vacíos/null al final", () => {
    const values: Array<string | null> = ["b", null, "a", ""];
    const sorted = [...values].sort((a, b) => compareStrings(a, b, "asc"));
    expect(sorted.slice(0, 2)).toEqual(["a", "b"]);
  });
});

describe("compareDates — más reciente/más antiguo primero", () => {
  it("asc = más antiguo primero, desc = más reciente primero", () => {
    const values = ["2026-08-10", "2026-01-01", "2026-12-31"];
    expect([...values].sort((a, b) => compareDates(a, b, "asc"))).toEqual([
      "2026-01-01",
      "2026-08-10",
      "2026-12-31",
    ]);
    expect([...values].sort((a, b) => compareDates(a, b, "desc"))).toEqual([
      "2026-12-31",
      "2026-08-10",
      "2026-01-01",
    ]);
  });

  it("fechas inválidas o ausentes siempre al final", () => {
    const values: Array<string | null> = ["2026-08-10", null, "no-es-fecha", "2026-01-01"];
    const sorted = [...values].sort((a, b) => compareDates(a, b, "asc"));
    expect(sorted.slice(0, 2)).toEqual(["2026-01-01", "2026-08-10"]);
  });
});

describe("compareVtoNearest — vencimiento más próximo primero", () => {
  const today = new Date("2026-08-15T12:00:00.000Z");

  it("entre dos VTO futuros, el más próximo gana", () => {
    const values = ["2027-01-01", "2026-09-01", "2026-12-01"];
    const sorted = [...values].sort((a, b) => compareVtoNearest(a, b, today));
    expect(sorted).toEqual(["2026-09-01", "2026-12-01", "2027-01-01"]);
  });

  it("vencidos van primero (requieren acción), y entre vencidos el más reciente primero", () => {
    const values = ["2026-01-01", "2026-08-01", "2026-12-01"]; // los dos primeros ya vencidos al 2026-08-15
    const sorted = [...values].sort((a, b) => compareVtoNearest(a, b, today));
    expect(sorted).toEqual(["2026-08-01", "2026-01-01", "2026-12-01"]);
  });

  it("sin VTO queda al final", () => {
    const values: Array<string | null> = ["2026-12-01", null, "2026-09-01"];
    const sorted = [...values].sort((a, b) => compareVtoNearest(a, b, today));
    expect(sorted).toEqual(["2026-09-01", "2026-12-01", null]);
  });
});

describe("applySort — opera sobre el array COMPLETO recibido, no muta el original", () => {
  interface Row {
    id: string;
    n: number;
  }
  const options: SortOption<Row>[] = [
    { key: "n_asc", label: "Número ascendente", compare: (a, b) => compareNumbers(a.n, b.n, "asc") },
    { key: "n_desc", label: "Número descendente", compare: (a, b) => compareNumbers(a.n, b.n, "desc") },
  ];
  const rows: Row[] = [
    { id: "c", n: 10 },
    { id: "a", n: 2 },
    { id: "b", n: 9 },
  ];

  it("ordena según la key pedida", () => {
    expect(applySort(rows, options, "n_asc").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(applySort(rows, options, "n_desc").map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("no muta el array original", () => {
    const original = [...rows];
    applySort(rows, options, "n_asc");
    expect(rows).toEqual(original);
  });

  it("key desconocida cae al primer option en vez de romper", () => {
    expect(applySort(rows, options, "no-existe").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
