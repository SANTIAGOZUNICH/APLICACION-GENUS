/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficialAsignacionLotesStatusBanner } from "./official-asignacion-lotes-status";

const fetchMock = vi.fn();
const session = { email: "calidad@laboratoriogenus.com.ar", sector: "CALIDAD" as const };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("OfficialAsignacionLotesStatusBanner — sección 12: estado simple, visible para cualquier sector con acceso", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("muestra las dos fuentes oficiales sincronizadas con su última actualización", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        sources: [
          {
            year: "2025",
            name: "Asignación de Lotes 2025",
            spreadsheetId: "1HqvRt1_1XDT1nOhnxFLr7oEhOc5uZhvYirX2GdjiFOU",
            connected: true,
            enabled: true,
            syncStatus: "ok",
            lastSyncAt: new Date().toISOString(),
            lastSuccessfulSyncAt: new Date().toISOString(),
            lastError: null,
            lastRun: { status: "ok", rowsRead: 40, sheetsTotal: 5, ignoredTabsCount: 0 },
          },
          {
            year: "2026",
            name: "Asignación de Lotes 2026",
            spreadsheetId: "1MUPI0vgnXZOD2Iy5lyaGlGls-Dgwz353pbL57YlJI6o",
            connected: true,
            enabled: true,
            syncStatus: "ok",
            lastSyncAt: new Date().toISOString(),
            lastSuccessfulSyncAt: new Date().toISOString(),
            lastError: null,
            lastRun: { status: "ok", rowsRead: 97, sheetsTotal: 9, ignoredTabsCount: 1 },
          },
        ],
        syncFrequencyMinutes: 10,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<OfficialAsignacionLotesStatusBanner session={session} />);

    expect(await screen.findByTestId("official-asignacion-lotes-status")).toBeTruthy();
    expect(screen.getByTestId("official-asignacion-lotes-status-2025")).toBeTruthy();
    expect(screen.getByTestId("official-asignacion-lotes-status-2026")).toBeTruthy();
    expect(screen.getByText(/Google Sheets conectado/)).toBeTruthy();
    expect(screen.getByText(/97 fila\(s\) procesada\(s\)/)).toBeTruthy();
    expect(screen.getByText(/1 ignorada\(s\)/)).toBeTruthy();
    expect(screen.getByText(/cada 10 min/)).toBeTruthy();
  });

  it("muestra error de sincronización de forma visible cuando una fuente falla", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        sources: [
          {
            year: "2025",
            name: "Asignación de Lotes 2025",
            spreadsheetId: "x",
            connected: true,
            enabled: true,
            syncStatus: "error",
            lastSyncAt: new Date().toISOString(),
            lastSuccessfulSyncAt: null,
            lastError: "Google Sheets respondió 403.",
            lastRun: null,
          },
          {
            year: "2026",
            name: "Asignación de Lotes 2026",
            spreadsheetId: "y",
            connected: true,
            enabled: true,
            syncStatus: "ok",
            lastSyncAt: new Date().toISOString(),
            lastSuccessfulSyncAt: new Date().toISOString(),
            lastError: null,
            lastRun: { status: "ok", rowsRead: 10, sheetsTotal: 2, ignoredTabsCount: 0 },
          },
        ],
        syncFrequencyMinutes: 10,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<OfficialAsignacionLotesStatusBanner session={session} />);

    expect(await screen.findByText(/Error de sincronización/)).toBeTruthy();
    expect(screen.getByText(/Google Sheets respondió 403\./)).toBeTruthy();
  });

  it("antes de la primera corrida (fuentes aún no conectadas) no muestra un error, muestra estado pendiente", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        sources: [
          {
            year: "2025",
            name: "Asignación de Lotes 2025",
            spreadsheetId: "x",
            connected: false,
            enabled: false,
            syncStatus: "nunca_sincronizado",
            lastSyncAt: null,
            lastSuccessfulSyncAt: null,
            lastError: null,
            lastRun: null,
          },
          {
            year: "2026",
            name: "Asignación de Lotes 2026",
            spreadsheetId: "y",
            connected: false,
            enabled: false,
            syncStatus: "nunca_sincronizado",
            lastSyncAt: null,
            lastSuccessfulSyncAt: null,
            lastError: null,
            lastRun: null,
          },
        ],
        syncFrequencyMinutes: 10,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<OfficialAsignacionLotesStatusBanner session={session} />);

    expect(await screen.findByText(/pendiente de la primera corrida/)).toBeTruthy();
  });

  it("si la API falla (ej. sector sin acceso), no rompe el resto de la pantalla — se oculta en silencio", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<OfficialAsignacionLotesStatusBanner session={session} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="official-asignacion-lotes-status"]')).toBeNull();
  });
});
