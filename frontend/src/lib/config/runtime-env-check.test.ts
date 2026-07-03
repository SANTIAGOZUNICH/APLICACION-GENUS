import { describe, expect, it } from "vitest";
import { analyzePrivateKeyFormat } from "./runtime-env-check";

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
