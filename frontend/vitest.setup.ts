import { vi } from "vitest";

/** Permite importar módulos server-only en tests de lógica pura. */
vi.mock("server-only", () => ({}));

/** Evita cargar googleapis en tests del mapper SEMANAS. */
vi.mock("@/lib/adapters/sheets/sheets-reader", () => ({
  SPREADSHEET_MIME: "application/vnd.google-apps.spreadsheet",
  sheetsReader: {
    getSpreadsheetMeta: vi.fn(),
    readSheetValues: vi.fn(),
  },
}));
