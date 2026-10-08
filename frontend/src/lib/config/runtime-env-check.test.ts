import { describe, expect, it } from "vitest";
import { analyzePrivateKeyFormat, databaseFingerprint } from "./runtime-env-check";

describe("analyzePrivateKeyFormat", () => {
  it("detecta key ausente", () => {
    const result = analyzePrivateKeyFormat(undefined);
    expect(result.present).toBe(false);
    expect(result.format).toBe("missing");
  });

  it("detecta PEM con saltos literales", () => {
    const result = analyzePrivateKeyFormat(
      "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n"
    );
    expect(result.format).toBe("literal_newlines");
    expect(result.appearsValidPem).toBe(true);
  });

  it("detecta PEM con \\n escapados", () => {
    const result = analyzePrivateKeyFormat(
      "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n"
    );
    expect(result.format).toBe("escaped_backslash_n");
    expect(result.appearsValidPem).toBe(true);
  });

  it("detecta PEM sin header", () => {
    const result = analyzePrivateKeyFormat("not-a-key");
    expect(result.format).toBe("missing_pem_header");
    expect(result.appearsValidPem).toBe(false);
  });
});

describe("databaseFingerprint", () => {
  it("es estable, corta y no contiene usuario, contraseña ni host", () => {
    const fp = databaseFingerprint("postgres://user:secret@ep-abc-123.us-east-2.aws.neon.tech/neondb?sslmode=require");
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(fp).toBe(databaseFingerprint("postgres://otro:otra@EP-ABC-123.us-east-2.aws.neon.tech/neondb"));
    expect(fp).not.toContain("ep-abc");
  });
  it("distingue bases distintas (otra rama u otra base)", () => {
    const a = databaseFingerprint("postgres://u:p@ep-main.neon.tech/neondb");
    expect(a).not.toBe(databaseFingerprint("postgres://u:p@ep-preview.neon.tech/neondb"));
    expect(a).not.toBe(databaseFingerprint("postgres://u:p@ep-main.neon.tech/otra"));
  });
  it("null sin URL o con URL inválida", () => {
    expect(databaseFingerprint(undefined)).toBeNull();
    expect(databaseFingerprint("  ")).toBeNull();
    expect(databaseFingerprint("no es url")).toBeNull();
  });
});
