import { describe, expect, it } from "vitest";
import { friendlySaveError, friendlyServerMessage } from "./friendly-error";

describe("mensajes de error para el operario", () => {
  it("sin conexión, códigos HTTP y texto técnico se traducen", () => {
    expect(friendlySaveError(new TypeError("Failed to fetch"))).toMatch(/Sin conexión/);
    expect(friendlySaveError(new Error("HTTP 409"))).toMatch(/Otra persona/);
    expect(friendlySaveError(new Error("Error 403 al guardar."))).toMatch(/permiso/);
    expect(friendlySaveError(new Error("Cannot read properties of undefined (reading 'x')"))).not.toMatch(/Cannot|undefined/);
    expect(friendlyServerMessage(500, "Failed query: select * from x")).toMatch(/servidor tuvo un problema/);
  });
  it("lo que el servidor ya explica en castellano se muestra igual", () => {
    expect(friendlySaveError(new Error("Motivo de ajuste obligatorio para «Agua»."))).toBe("Motivo de ajuste obligatorio para «Agua».");
    expect(friendlyServerMessage(409, "Otro usuario modificó este lote. Recargá y reintentá.")).toMatch(/Otro usuario/);
  });
});
