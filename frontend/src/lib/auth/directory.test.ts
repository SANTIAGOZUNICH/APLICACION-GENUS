import { describe, expect, it } from "vitest";
import { findDirectoryEntryByEmail, SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";

describe("SECTOR_ACCOUNT_DIRECTORY", () => {
  it("tiene exactamente 8 cuentas sectoriales", () => {
    expect(SECTOR_ACCOUNT_DIRECTORY).toHaveLength(8);
  });

  it("ninguna entrada tiene la propiedad password", () => {
    for (const entry of SECTOR_ACCOUNT_DIRECTORY) {
      expect(entry).not.toHaveProperty("password");
      expect(Object.keys(entry)).not.toContain("password");
    }
  });

  it("cada entrada tiene los campos públicos requeridos", () => {
    for (const entry of SECTOR_ACCOUNT_DIRECTORY) {
      expect(entry.email).toMatch(/@laboratoriogenus\.com\.ar$/);
      expect(entry.sector).toBeTruthy();
      expect(entry.displayName).toBeTruthy();
      expect(entry.role).toBeTruthy();
      expect(entry.roleLabel).toBeTruthy();
      expect(entry.sectorLabel).toBeTruthy();
      expect(entry.jobTitle).toBeTruthy();
      expect(entry.redirectTo).toBe("/mi-trabajo");
    }
  });

  it("los emails son únicos", () => {
    const emails = SECTOR_ACCOUNT_DIRECTORY.map((e) => e.email.toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("findDirectoryEntryByEmail es case-insensitive", () => {
    const entry = findDirectoryEntryByEmail("ELABORACION@laboratoriogenus.com.ar");
    expect(entry?.sector).toBe("ELABORACION");
  });

  it("findDirectoryEntryByEmail devuelve undefined para email desconocido", () => {
    expect(findDirectoryEntryByEmail("nadie@laboratoriogenus.com.ar")).toBeUndefined();
  });
});
