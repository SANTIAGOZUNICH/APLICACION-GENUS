import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWorkspaceRegistry,
  getWorkspaceDefinition,
  hasWorkspaceDefinition,
  registerWorkspace,
} from "./workspace-registry";
import {
  buildWorkspaceGreeting,
  extractFirstName,
  resolveWorkspace,
  resolveWorkspaceFromAuthSession,
  resolveWorkspaceOrDefault,
} from "./workspace-resolver";
import { createDefaultWorkspaceDefinition } from "./definitions/default-workspace";
import {
  CALIDAD_WORKSPACE,
  PRODUCCION_WORKSPACE,
  SECTOR_WORKSPACE_DEFINITIONS,
} from "./definitions/sector-workspaces";
import { ensureWorkspaceRegistry, resetWorkspaceBootstrap } from "./bootstrap-workspaces";
import type { OsAuthSession } from "@/features/os/auth/contracts";

describe("WorkspaceRegistry", () => {
  beforeEach(() => {
    clearWorkspaceRegistry();
    resetWorkspaceBootstrap();
  });

  it("registra y recupera definiciones por sector", () => {
    registerWorkspace(PRODUCCION_WORKSPACE);

    expect(hasWorkspaceDefinition("PRODUCCION")).toBe(true);
    expect(getWorkspaceDefinition("PRODUCCION")?.primaryActions).toHaveLength(3);
  });

  it("bootstrap registra workspaces sectoriales", () => {
    ensureWorkspaceRegistry();

    expect(hasWorkspaceDefinition("PRODUCCION")).toBe(true);
    expect(hasWorkspaceDefinition("CALIDAD")).toBe(true);
    expect(hasWorkspaceDefinition("DEPOSITO")).toBe(true);
    expect(hasWorkspaceDefinition("DIRECCION")).toBe(true);
    expect(SECTOR_WORKSPACE_DEFINITIONS.length).toBeGreaterThanOrEqual(4);
  });
});

describe("WorkspaceDefinition", () => {
  beforeEach(() => {
    clearWorkspaceRegistry();
    resetWorkspaceBootstrap();
    ensureWorkspaceRegistry();
  });

  it("Producción expone acciones y widgets mock", () => {
    const definition = getWorkspaceDefinition("PRODUCCION");
    expect(definition?.subtitle).toBe("Tenés 8 órdenes para trabajar hoy.");
    expect(definition?.primaryActions.map((a) => a.label)).toEqual([
      "Iniciar elaboración",
      "Continuar orden",
      "Registrar consumo",
    ]);
    expect(definition?.widgets.map((w) => w.label)).toEqual([
      "Mi trabajo",
      "Prioridades",
      "Producción del día",
    ]);
  });

  it("Calidad expone liberación y análisis", () => {
    const definition = getWorkspaceDefinition("CALIDAD");
    expect(definition?.subtitle).toBe("Tenés 5 lotes esperando liberación.");
    expect(definition?.primaryActions[0]?.label).toBe("Liberar lote");
  });

  it("Depósito expone movimientos pendientes", () => {
    const definition = getWorkspaceDefinition("DEPOSITO");
    expect(definition?.subtitle).toBe("Hay 14 movimientos pendientes.");
  });
});

describe("WorkspaceResolver", () => {
  beforeEach(() => {
    clearWorkspaceRegistry();
    resetWorkspaceBootstrap();
    ensureWorkspaceRegistry();
  });

  it("resuelve workspace de Producción con saludo personalizado", () => {
    const resolved = resolveWorkspace({
      sectorId: "PRODUCCION",
      email: "produccion@laboratoriogenus.com.ar",
    });

    expect(resolved.title).toBe(buildWorkspaceGreeting(extractFirstName("Agustina Zunich")));
    expect(resolved.subtitle).toBe("Tenés 8 órdenes para trabajar hoy.");
    expect(resolved.context.displayName).toBe("Agustina Zunich");
    expect(resolved.navigation).toContain("mi_trabajo");
    expect(resolved.navigation).toContain("plan_semanal");
  });

  it("resuelve workspace desde OsAuthSession", () => {
    const session: OsAuthSession = {
      status: "preview",
      mode: "preview",
      user: {
        email: "calidad@laboratoriogenus.com.ar",
        displayName: "Lucía Calidad",
        jobTitle: "Analista de Calidad",
        company: "Laboratorio Genus",
      },
      sector: { id: "CALIDAD", label: "Calidad" },
      role: { id: "ROL-CA", label: "Calidad" },
      rememberMe: false,
      redirectTo: "/mi-trabajo",
      createdAt: "2026-07-03T12:00:00.000Z",
    };

    const resolved = resolveWorkspaceFromAuthSession(session);

    expect(resolved.context.firstName).toBe("Lucía");
    expect(resolved.subtitle).toBe("Tenés 5 lotes esperando liberación.");
    expect(resolved.definition.sectorId).toBe("CALIDAD");
  });

  it("usa workspace por defecto para sector sin definición registrada", () => {
    clearWorkspaceRegistry();

    const resolved = resolveWorkspaceOrDefault("CODIFICADO", "codificado@laboratoriogenus.com.ar");

    expect(resolved.definition.sectorId).toBe("CODIFICADO");
    expect(resolved.definition.primaryActions.length).toBeGreaterThan(0);
    expect(resolved.subtitle).toContain("Codificado");
  });

  it("usa default cuando el sector no existe en registry (workspace inexistente)", () => {
    clearWorkspaceRegistry();
    registerWorkspace(CALIDAD_WORKSPACE);

    const resolved = resolveWorkspace({
      sectorId: "MATERIA_PRIMA",
      email: "mp@laboratoriogenus.com.ar",
      displayName: "Ana Materia Prima",
    });

    expect(hasWorkspaceDefinition("MATERIA_PRIMA")).toBe(false);
    expect(resolved.definition).toEqual(createDefaultWorkspaceDefinition("MATERIA_PRIMA"));
    expect(resolved.context.firstName).toBe("Ana");
  });
});
