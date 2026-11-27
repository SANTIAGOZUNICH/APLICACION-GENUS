import { describe, expect, it } from "vitest";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";
import { resolveSectorHome } from "@/lib/role-engine";
import { canManagePortal, PORTAL_MANAGER_SECTORS } from "./portal-access";
import { canManagePush } from "./push/push-service";
import { canManagePortalUsers } from "./user-admin-service";

describe("canManagePortal", () => {
  it("permite Administración, Producción y Dirección (sin mayúsculas/espacios exactos)", () => {
    for (const s of ["ADMINISTRACION", "PRODUCCION", "DIRECCION", " produccion ", "administracion"]) expect(canManagePortal(s)).toBe(true);
  });
  it("rechaza todos los demás sectores y valores vacíos", () => {
    const others = OPERATIONAL_SECTOR_IDS.filter((s) => !(PORTAL_MANAGER_SECTORS as readonly string[]).includes(s));
    expect(others.length).toBeGreaterThan(5);
    for (const s of others) expect(canManagePortal(s), s).toBe(false);
    for (const s of ["", null, undefined, "ADMIN", "DEPOSITO", "ENVASADO_MASIVO", "CODIFICADO"]) expect(canManagePortal(s as string)).toBe(false);
  });
  it("usuarios, push y portal comparten el mismo permiso", () => {
    for (const s of OPERATIONAL_SECTOR_IDS) {
      expect(canManagePush(s)).toBe(canManagePortal(s));
      expect(canManagePortalUsers(s)).toBe(canManagePortal(s));
    }
  });
  it("la pestaña «Portal de Clientes» está en la barra lateral de Administración, Producción y Dirección y de ningún otro sector", () => {
    for (const s of OPERATIONAL_SECTOR_IDS) {
      expect(resolveSectorHome(s).sidebarItems.includes("portal_clientes" as never), s).toBe(canManagePortal(s));
    }
  });
});
