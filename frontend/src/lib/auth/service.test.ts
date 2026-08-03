import { describe, expect, it } from "vitest";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { AuthService } from "@/lib/auth/service";
import {
  AuthBlockedError,
  AuthInvalidCredentialsError,
  AuthRateLimitedError,
} from "@/lib/auth/types";
import type { SectorAccountDirectoryEntry } from "@/lib/auth/directory";

const directory: SectorAccountDirectoryEntry[] = [
  {
    email: "ana@laboratoriogenus.com.ar",
    sector: "ELABORACION",
    displayName: "Ana",
    role: "ROL-EL",
    roleLabel: "Sector",
    sectorLabel: "Elaboración",
    jobTitle: "Encargada",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "beto@laboratoriogenus.com.ar",
    sector: "CALIDAD",
    displayName: "Beto",
    role: "ROL-CA",
    roleLabel: "Calidad",
    sectorLabel: "Calidad",
    jobTitle: "Responsable",
    redirectTo: "/mi-trabajo",
  },
];

function makeService() {
  const repo = new MemoryAuthRepository();
  const service = new AuthService(repo);
  return { repo, service };
}

async function seedAna(service: AuthService, password = "clave-segura-1") {
  await service.ensureUsersSeeded({ "ana@laboratoriogenus.com.ar": password }, directory);
}

describe("AuthService — ensureUsersSeeded", () => {
  it("crea usuarios solo si hay password provista, es idempotente y no pisa password_hash por default", async () => {
    const { repo, service } = makeService();

    const first = await service.ensureUsersSeeded(
      { "ana@laboratoriogenus.com.ar": "clave-1" },
      directory
    );
    expect(first.createdCount).toBe(1);
    expect(first.skippedCount).toBe(1); // beto sin password en el mapa

    const second = await service.ensureUsersSeeded(
      { "ana@laboratoriogenus.com.ar": "otra-clave-totalmente-distinta" },
      directory
    );
    expect(second.createdCount).toBe(0);
    expect(second.skippedCount).toBe(2); // ana ya existe, beto sigue sin password

    // La contraseña original de Ana sigue siendo válida (no se pisó).
    const login = await service.login("ana@laboratoriogenus.com.ar", "clave-1");
    expect(login.user.email).toBe("ana@laboratoriogenus.com.ar");

    const users = await repo.listUsers();
    expect(users).toHaveLength(1);
  });

  it("con forcePassword=1 sobreescribe el password_hash de un usuario existente", async () => {
    const { service } = makeService();
    await seedAna(service, "clave-original");

    await service.ensureUsersSeeded(
      { "ana@laboratoriogenus.com.ar": "clave-nueva" },
      directory,
      { forcePassword: true }
    );

    await expect(service.login("ana@laboratoriogenus.com.ar", "clave-original")).rejects.toBeInstanceOf(
      AuthInvalidCredentialsError
    );
    const login = await service.login("ana@laboratoriogenus.com.ar", "clave-nueva");
    expect(login.user.email).toBe("ana@laboratoriogenus.com.ar");
  });
});

describe("AuthService — login", () => {
  it("login OK devuelve user público (sin passwordHash) + token, y setea lastLoginAt", async () => {
    const { service } = makeService();
    await seedAna(service);

    const result = await service.login("ana@laboratoriogenus.com.ar", "clave-segura-1");
    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe("ana@laboratoriogenus.com.ar");
    expect(result.user.sector).toBe("ELABORACION");
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.user.lastLoginAt).toBeTruthy();
  });

  it("login es case-insensitive en el email", async () => {
    const { service } = makeService();
    await seedAna(service);
    const result = await service.login("ANA@LaboratorioGenus.com.ar", "clave-segura-1");
    expect(result.user.email).toBe("ana@laboratoriogenus.com.ar");
  });

  it("password incorrecta lanza AuthInvalidCredentialsError", async () => {
    const { service } = makeService();
    await seedAna(service);
    await expect(service.login("ana@laboratoriogenus.com.ar", "password-incorrecta")).rejects.toBeInstanceOf(
      AuthInvalidCredentialsError
    );
  });

  it("email desconocido lanza el MISMO tipo/mensaje de error que password incorrecta (no filtra si el email existe)", async () => {
    const { service } = makeService();
    await seedAna(service);

    let unknownEmailError: unknown;
    let wrongPasswordError: unknown;
    try {
      await service.login("no-existe@laboratoriogenus.com.ar", "cualquiera");
    } catch (err) {
      unknownEmailError = err;
    }
    try {
      await service.login("ana@laboratoriogenus.com.ar", "password-incorrecta");
    } catch (err) {
      wrongPasswordError = err;
    }

    expect(unknownEmailError).toBeInstanceOf(AuthInvalidCredentialsError);
    expect(wrongPasswordError).toBeInstanceOf(AuthInvalidCredentialsError);
    expect((unknownEmailError as Error).message).toBe((wrongPasswordError as Error).message);
  });

  it("usuario BLOQUEADO no puede loguear (AuthBlockedError) aunque la password sea correcta", async () => {
    const { repo, service } = makeService();
    await seedAna(service);
    const users = await repo.listUsers();
    await repo.updateUser(users[0].id, { status: "BLOQUEADO" });

    await expect(service.login("ana@laboratoriogenus.com.ar", "clave-segura-1")).rejects.toBeInstanceOf(
      AuthBlockedError
    );
  });

  it(
    "rate-limit: bloquea tras 8 intentos fallidos en la ventana, sin afectar a otros emails",
    async () => {
      const { service } = makeService();
      await seedAna(service);

      for (let i = 0; i < 8; i += 1) {
        await expect(
          service.login("ana@laboratoriogenus.com.ar", "password-incorrecta")
        ).rejects.toBeInstanceOf(AuthInvalidCredentialsError);
      }

      await expect(service.login("ana@laboratoriogenus.com.ar", "clave-segura-1")).rejects.toBeInstanceOf(
        AuthRateLimitedError
      );

      // Otro email no está afectado por el rate limit de Ana.
      await service.ensureUsersSeeded({ "beto@laboratoriogenus.com.ar": "clave-beto-1" }, directory);
      const betoLogin = await service.login("beto@laboratoriogenus.com.ar", "clave-beto-1");
      expect(betoLogin.user.email).toBe("beto@laboratoriogenus.com.ar");
    },
    20000
  );

  it(
    "un login exitoso limpia el contador de intentos fallidos previos",
    async () => {
      const { service } = makeService();
      await seedAna(service);

      for (let i = 0; i < 5; i += 1) {
        await expect(
          service.login("ana@laboratoriogenus.com.ar", "password-incorrecta")
        ).rejects.toBeInstanceOf(AuthInvalidCredentialsError);
      }
      await service.login("ana@laboratoriogenus.com.ar", "clave-segura-1");

      // Puede volver a fallar sin quedar rate-limited de entrada.
      await expect(
        service.login("ana@laboratoriogenus.com.ar", "password-incorrecta")
      ).rejects.toBeInstanceOf(AuthInvalidCredentialsError);
    },
    20000
  );
});

describe("AuthService — resolveSession / logout", () => {
  it("resolveSession devuelve el actor para un token de sesión válido", async () => {
    const { service } = makeService();
    await seedAna(service);
    const { token } = await service.login("ana@laboratoriogenus.com.ar", "clave-segura-1");

    const actor = await service.resolveSession(token);
    expect(actor).not.toBeNull();
    expect(actor?.email).toBe("ana@laboratoriogenus.com.ar");
    expect(actor?.sector).toBe("ELABORACION");
  });

  it("resolveSession devuelve null para token inexistente/forjado", async () => {
    const { service } = makeService();
    const actor = await service.resolveSession("token-inventado-no-existe");
    expect(actor).toBeNull();
  });

  it("resolveSession devuelve null sin token", async () => {
    const { service } = makeService();
    expect(await service.resolveSession(null)).toBeNull();
    expect(await service.resolveSession(undefined)).toBeNull();
    expect(await service.resolveSession("")).toBeNull();
  });

  it("logout invalida la sesión: resolveSession pasa a null tras logout", async () => {
    const { service } = makeService();
    await seedAna(service);
    const { token } = await service.login("ana@laboratoriogenus.com.ar", "clave-segura-1");

    expect(await service.resolveSession(token)).not.toBeNull();
    await service.logout(token);
    expect(await service.resolveSession(token)).toBeNull();
  });

  it("logout con token vacío/inexistente no lanza", async () => {
    const { service } = makeService();
    await expect(service.logout(null)).resolves.toBeUndefined();
    await expect(service.logout("no-existe")).resolves.toBeUndefined();
  });
});

describe("AuthService — auditoría nunca guarda passwords", () => {
  it(
    "los eventos de auditoría no incluyen password ni password_hash en el detail",
    async () => {
    const { repo, service } = makeService();
    await seedAna(service);
    await service.login("ana@laboratoriogenus.com.ar", "clave-segura-1").catch(() => {});
    await service
      .login("ana@laboratoriogenus.com.ar", "password-incorrecta")
      .catch(() => {});

    const events = await repo.listAuditEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain("clave-segura-1");
      expect(serialized).not.toContain("password-incorrecta");
      expect(event.detail).not.toHaveProperty("password");
      expect(event.detail).not.toHaveProperty("passwordHash");
    }
  },
  20000
  );
});
