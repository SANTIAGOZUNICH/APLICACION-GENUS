import { describe, expect, it } from "vitest";
import {
  sanitizePublicErrorMessage,
} from "@/lib/planning/sanitize-public-error";

describe("sanitizePublicErrorMessage", () => {
  it("hides Neon/SQL leak messages", () => {
    expect(
      sanitizePublicErrorMessage(
        new Error('Failed query: select * from work_items where id = \'x\'')
      )
    ).toBe("No se pudo completar la operación. Reintentá.");
    expect(
      sanitizePublicErrorMessage(new Error("neon.tech connection refused"))
    ).toBe("No se pudo completar la operación. Reintentá.");
  });

  it("keeps short user-facing validation messages", () => {
    expect(
      sanitizePublicErrorMessage(new Error("Hasta no puede ser anterior a Desde."))
    ).toBe("Hasta no puede ser anterior a Desde.");
  });
});
