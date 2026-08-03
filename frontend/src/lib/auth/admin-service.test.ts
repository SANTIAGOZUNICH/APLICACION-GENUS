import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthAdminService } from "@/lib/auth/admin-service";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { AuthService } from "@/lib/auth/service";
import {
  AuthConflictError,
  AuthValidationError,
  type AuthActor,
} from "@/lib/auth/types";

const actor: AuthActor = {
  userId: "actor-1",
  email: "admin@laboratoriogenus.com.ar",
  sector: "PRODUCCION",
  displayName: "Admin",
  roleId: "ROL-SU",
  roleLabel: "Supervisora",
  sectorLabel: "Producción",
  jobTitle: "Admin",
  redirectTo: "/mi-trabajo",
};

function make() {
  const repo = new MemoryAuthRepository();
  const auth = new AuthService(repo);
  const admin = new AuthAdminService(repo);
  return { repo, auth, admin };
}

describe("AuthAdminService", () => {
  beforeEach(() => {
    process.env.GENUS_SUPERADMIN_EMAIL = "admin@laboratoriogenus.com.ar";
  });
  afterEach(() => {
    delete process.env.GENUS_SUPERADMIN_EMAIL;
  });

  it("cambia nombre y audita sin secretos", async () => {
    const { auth, admin, repo } = make();
    await auth.ensureUsersSeeded(
      { "ana@laboratoriogenus.com.ar": "clave-segura-1" },
      [
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
      ]
    );
    const users = await repo.listUsers();
    const updated = await admin.updateUser(actor, users[0].id, {
      displayName: "Ana Actualizada",
      reason: "corrección de nombre",
    });
    expect(updated.displayName).toBe("Ana Actualizada");
    expect((updated as { passwordHash?: string }).passwordHash).toBeUndefined();
    const events = await admin.listAuditForUser(users[0].id);
    expect(events[0].eventType).toBe("ADMIN_USER_UPDATE");
    const blob = JSON.stringify(events[0].detail);
    expect(blob).not.toMatch(/password|hash|clave/i);
  });

  it("cambia email conservando userId y rechaza duplicados", async () => {
    const { auth, admin, repo } = make();
    await auth.ensureUsersSeeded(
      {
        "ana@laboratoriogenus.com.ar": "clave-segura-1",
        "beto@laboratoriogenus.com.ar": "clave-segura-2",
      },
      [
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
      ]
    );
    const users = await repo.listUsers();
    const ana = users.find((u) => u.email.startsWith("ana"))!;
    const sameId = await admin.updateUser(actor, ana.id, {
      email: "ana.nueva@laboratoriogenus.com.ar",
      reason: "cambio de correo",
    });
    expect(sameId.id).toBe(ana.id);
    expect(sameId.email).toBe("ana.nueva@laboratoriogenus.com.ar");

    await expect(
      admin.updateUser(actor, ana.id, {
        email: "beto@laboratoriogenus.com.ar",
        reason: "duplicado",
      })
    ).rejects.toBeInstanceOf(AuthConflictError);
  });

  it(
    "reset password invalida la anterior y revoca sesiones",
    async () => {
    const { auth, admin, repo } = make();
    await auth.ensureUsersSeeded(
      { "ana@laboratoriogenus.com.ar": "clave-segura-1" },
      [
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
      ]
    );
    const login = await auth.login("ana@laboratoriogenus.com.ar", "clave-segura-1");
    const before = await auth.resolveSession(login.token);
    expect(before?.email).toBe("ana@laboratoriogenus.com.ar");

    const users = await repo.listUsers();
    const result = await admin.resetPassword(actor, users[0].id, {
      newPassword: "clave-nueva-99",
      reason: "olvido",
    });
    expect(result.sessionsRevoked).toBeGreaterThanOrEqual(1);

    await expect(
      auth.login("ana@laboratoriogenus.com.ar", "clave-segura-1")
    ).rejects.toBeTruthy();
    const again = await auth.login("ana@laboratoriogenus.com.ar", "clave-nueva-99");
    expect(again.user.id).toBe(users[0].id);
    expect(await auth.resolveSession(login.token)).toBeNull();
  },
  20000
  );

  it("protege al último SUPERADMIN activo", async () => {
    const { auth, admin, repo } = make();
    process.env.GENUS_SUPERADMIN_EMAIL = "admin@laboratoriogenus.com.ar";
    await auth.ensureUsersSeeded(
      { "admin@laboratoriogenus.com.ar": "clave-segura-1" },
      [
        {
          email: "admin@laboratoriogenus.com.ar",
          sector: "PRODUCCION",
          displayName: "Admin",
          role: "ROL-SU",
          roleLabel: "Supervisora",
          sectorLabel: "Producción",
          jobTitle: "Admin",
          redirectTo: "/mi-trabajo",
        },
      ]
    );
    const users = await repo.listUsers();
    await expect(
      admin.updateUser(actor, users[0].id, {
        status: "INACTIVO",
        reason: "intento",
      })
    ).rejects.toBeInstanceOf(AuthValidationError);
  });
});
