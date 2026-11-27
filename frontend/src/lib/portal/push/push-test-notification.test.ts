import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PUSH_TEST_BODY, PUSH_TEST_EVENT_TYPE, PUSH_TEST_TITLE, PUSH_TEST_URL, sendTestPush } from "./push-service";

const CLIENT = "11111111-1111-4111-8111-111111111111";
type Q = { queryChunks?: unknown[] };
/** Fake de base: devuelve filas por coincidencia de texto de la consulta y registra todo lo ejecutado. */
function fakeDb(handlers: Array<[RegExp, unknown[]]>) {
  const log: string[] = [];
  return {
    log,
    db: {
      execute: vi.fn(async (q: Q) => {
        const text = JSON.stringify(q.queryChunks ?? q);
        log.push(text);
        const hit = handlers.find(([re]) => re.test(text));
        return { rows: hit ? hit[1] : [] };
      }),
    },
  };
}

describe("sendTestPush — validaciones previas (sin red ni base real)", () => {
  it("el texto de la prueba es exacto y su tipo es «prueba»", () => {
    expect(PUSH_TEST_TITLE).toBe("¡Bienvenido a Laboratorio Genus! 🎉");
    expect(PUSH_TEST_BODY).toBe("Las notificaciones de tu portal funcionan correctamente. A partir de ahora podrás recibir novedades sobre tus pedidos.");
    expect(PUSH_TEST_EVENT_TYPE).toBe("prueba");
    expect(PUSH_TEST_URL).toBe("/entregas");
  });

  it("solo Administración, Producción y Dirección: cualquier otro sector recibe 403 sin tocar la base ni el sender", async () => {
    const { db } = fakeDb([]);
    const sender = vi.fn();
    for (const sector of ["ENVASADO_MASIVO", "COMERCIAL", "DEPOSITO", "CODIFICADO", "CALIDAD"]) {
      await expect(sendTestPush({ email: "x@y.z", sector }, CLIENT, { db, sender })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    }
    expect(db.execute).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it("id de cliente inválido → 400; cliente inexistente → 404; sin piloto → 409 (nunca llama al sender)", async () => {
    const dir = { email: "d@y.z", sector: "DIRECCION" };
    const sender = vi.fn();
    await expect(sendTestPush(dir, "no-uuid", { db: fakeDb([]).db, sender })).rejects.toMatchObject({ status: 400 });
    await expect(sendTestPush(dir, CLIENT, { db: fakeDb([]).db, sender })).rejects.toMatchObject({ status: 404 });
    await expect(sendTestPush(dir, CLIENT, { db: fakeDb([[/from portal_clients/, [{ id: CLIENT }]]]).db, sender })).rejects.toMatchObject({ status: 409, code: "PUSH_NOT_ENABLED" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("sin VAPID (sender null) → 503 y sin dispositivos → 409, sin enviar", async () => {
    const dir = { email: "d@y.z", sector: "DIRECCION" };
    const base: Array<[RegExp, unknown[]]> = [[/from portal_clients/, [{ id: CLIENT }]], [/portal_push_client_pilot/, [{ enabled: true }]]];
    await expect(sendTestPush(dir, CLIENT, { db: fakeDb(base).db, sender: null })).rejects.toMatchObject({ status: 503, code: "PUSH_UNAVAILABLE" });
    const sender = vi.fn();
    await expect(sendTestPush(dir, CLIENT, { db: fakeDb(base).db, sender })).rejects.toMatchObject({ status: 409, code: "PUSH_NO_DEVICES" });
    expect(sender).not.toHaveBeenCalled();
  });
});
