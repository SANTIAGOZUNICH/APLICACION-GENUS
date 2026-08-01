import { describe, expect, it } from "vitest";
import { MOCK_PREVIEW_USERS } from "./mock-preview-users";

describe("MOCK_PREVIEW_USERS", () => {
  it("expone solo metadatos de directorio, nunca contraseñas demo", () => {
    const serialized = JSON.stringify(MOCK_PREVIEW_USERS).toLowerCase();

    for (const user of MOCK_PREVIEW_USERS) {
      expect(Object.keys(user).some((key) => /password|passwd|clave/i.test(key))).toBe(false);
    }
    expect(serialized).not.toMatch(/password|contraseñ|clave[-_ ]?(demo|test|123)/i);
  });
});
