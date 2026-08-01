/**
 * Seed de Genus Auth — SOLO Preview. NUNCA Production.
 *
 * Requiere APPLY_AUTH_SEED=1 explícito. Aborta si VERCEL_ENV=production o
 * GENUS_ENV=production.
 *
 * Lee las contraseñas EXCLUSIVAMENTE desde variables de entorno — nunca
 * hardcodeadas en este archivo ni en ningún otro lugar del repo:
 *
 *   GENUS_AUTH_PASSWORD_ELABORACION
 *   GENUS_AUTH_PASSWORD_ENVASADO_MASIVO
 *   GENUS_AUTH_PASSWORD_ENVASADO_PREMIUM
 *   GENUS_AUTH_PASSWORD_CALIDAD
 *   GENUS_AUTH_PASSWORD_PRODUCCION
 *   GENUS_AUTH_PASSWORD_MATERIA_PRIMA
 *   GENUS_AUTH_PASSWORD_CODIFICADO
 *   GENUS_AUTH_PASSWORD_DEPOSITO
 *
 * Requiere DATABASE_URL (Neon) con la migración 0016 ya aplicada
 * (drizzle/0016_genus_auth.sql, APPLY_MIGRATION_0016=1) — el script verifica
 * que `genus_auth_users` exista antes de escribir nada. Pensado para usarse
 * junto con GENUS_AUTH_BACKEND=neon (ver src/lib/auth/get-auth-service.ts);
 * si el backend de la app sigue en memoria, el seed en Neon no tiene efecto
 * visible hasta que se active ese flag.
 *
 * Idempotente: si el usuario ya existe, NO pisa password_hash salvo
 * GENUS_AUTH_SEED_FORCE_PASSWORD=1.
 *
 * Nunca imprime contraseñas ni hashes — solo cuenta y emails enmascarados
 * (p***@dominio).
 *
 * Nota: el directorio de abajo está duplicado intencionalmente de
 * src/lib/auth/directory.ts (SECTOR_ACCOUNT_DIRECTORY) porque este script
 * corre con `node` plano (sin loader TS/paths). Mantener ambos
 * sincronizados si cambia el directorio de cuentas.
 */
import { neon } from "@neondatabase/serverless";

if (process.env.APPLY_AUTH_SEED !== "1") {
  console.log("[seed-genus-auth] APPLY_AUTH_SEED!=1 — abortando (no-op, esperado fuera de un seed explícito).");
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production" || process.env.GENUS_ENV === "production") {
  console.error("[seed-genus-auth] VERCEL_ENV/GENUS_ENV=production — abortando por seguridad (seed solo Preview).");
  process.exit(1);
}

const DIRECTORY = [
  {
    email: "elaboracion@laboratoriogenus.com.ar",
    sector: "ELABORACION",
    displayName: "Elaboración",
    role: "ROL-EL",
    roleLabel: "Sector",
    sectorLabel: "Elaboración",
    jobTitle: "Encargado de Elaboración",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_ELABORACION",
  },
  {
    email: "emasivo@laboratoriogenus.com.ar",
    sector: "ENVASADO_MASIVO",
    displayName: "Envasado Masivo",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Masivo",
    jobTitle: "Responsable Envasado Masivo",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_ENVASADO_MASIVO",
  },
  {
    email: "epremium@laboratoriogenus.com.ar",
    sector: "ENVASADO_PREMIUM",
    displayName: "Envasado Premium",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Premium",
    jobTitle: "Responsable Envasado Premium",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_ENVASADO_PREMIUM",
  },
  {
    email: "calidad@laboratoriogenus.com.ar",
    sector: "CALIDAD",
    displayName: "Calidad",
    role: "ROL-CA",
    roleLabel: "Calidad",
    sectorLabel: "Calidad",
    jobTitle: "Responsable de Calidad",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_CALIDAD",
  },
  {
    email: "produccion@laboratoriogenus.com.ar",
    sector: "PRODUCCION",
    displayName: "Producción",
    role: "ROL-SU",
    roleLabel: "Supervisora",
    sectorLabel: "Producción",
    jobTitle: "Supervisora de Planta",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_PRODUCCION",
  },
  {
    email: "mp@laboratoriogenus.com.ar",
    sector: "MATERIA_PRIMA",
    displayName: "Materias Primas",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Materias Primas",
    jobTitle: "Responsable de Materias Primas",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_MATERIA_PRIMA",
  },
  {
    email: "codificado@laboratoriogenus.com.ar",
    sector: "CODIFICADO",
    displayName: "Codificado",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Codificado",
    jobTitle: "Responsable de Codificado",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_CODIFICADO",
  },
  {
    email: "deposito@laboratoriogenus.com.ar",
    sector: "DEPOSITO",
    displayName: "Depósito",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Depósito",
    jobTitle: "Responsable de Depósito (credencial temporal demo)",
    redirectTo: "/mi-trabajo",
    passwordEnv: "GENUS_AUTH_PASSWORD_DEPOSITO",
  },
];

function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const maskedUser = user.length <= 1 ? "*" : `${user[0]}${"*".repeat(Math.max(1, user.length - 1))}`;
  return `${maskedUser}@${domain}`;
}

const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim() ||
  "";

if (!url) {
  console.error("[seed-genus-auth] DATABASE_URL ausente — abortando (requerido para sembrar Neon).");
  process.exit(1);
}

if (process.env.GENUS_AUTH_BACKEND !== "neon") {
  console.warn(
    "[seed-genus-auth] GENUS_AUTH_BACKEND!=neon — el backend en memoria de la app no lee esta tabla; " +
      "el seed queda listo para cuando se active GENUS_AUTH_BACKEND=neon (tras aplicar 0016)."
  );
}

const forcePassword = process.env.GENUS_AUTH_SEED_FORCE_PASSWORD === "1";

const { hash } = await import("bcryptjs");
const sql = neon(url);

async function tableExists(tableName) {
  const rows = await sql`select to_regclass(${`public.${tableName}`}) as reg`;
  return Boolean(rows[0]?.reg);
}

async function main() {
  const usersTableExists = await tableExists("genus_auth_users");
  if (!usersTableExists) {
    console.error(
      "[seed-genus-auth] Tabla genus_auth_users no existe — aplicar la migración 0016 primero " +
        "(APPLY_MIGRATION_0016=1, ver drizzle/0016_genus_auth.sql). Abortando sin escribir nada."
    );
    process.exit(1);
  }

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const maskedCreated = [];
  const maskedUpdated = [];
  const maskedSkipped = [];

  for (const entry of DIRECTORY) {
    const plainPassword = process.env[entry.passwordEnv];
    const emailNormalized = entry.email.trim().toLowerCase();

    const existingRows = await sql`
      select id from genus_auth_users where email_normalized = ${emailNormalized} limit 1
    `;
    const existing = existingRows[0];

    if (existing) {
      if (forcePassword && plainPassword) {
        const passwordHash = await hash(plainPassword, 12);
        await sql`
          update genus_auth_users
          set password_hash = ${passwordHash}, updated_at = now()
          where id = ${existing.id}
        `;
        updatedCount += 1;
        maskedUpdated.push(maskEmail(entry.email));
      } else {
        skippedCount += 1;
        maskedSkipped.push(maskEmail(entry.email));
      }
      continue;
    }

    if (!plainPassword) {
      console.warn(`[seed-genus-auth] Falta ${entry.passwordEnv} — omitiendo ${maskEmail(entry.email)}.`);
      skippedCount += 1;
      maskedSkipped.push(maskEmail(entry.email));
      continue;
    }

    const passwordHash = await hash(plainPassword, 12);
    await sql`
      insert into genus_auth_users (
        email, email_normalized, display_name, sector, role_id, role_label,
        sector_label, job_title, status, password_hash, redirect_to
      ) values (
        ${entry.email}, ${emailNormalized}, ${entry.displayName}, ${entry.sector}, ${entry.role},
        ${entry.roleLabel}, ${entry.sectorLabel}, ${entry.jobTitle}, 'ACTIVO', ${passwordHash}, ${entry.redirectTo}
      )
    `;
    createdCount += 1;
    maskedCreated.push(maskEmail(entry.email));
  }

  console.log("[seed-genus-auth] OK");
  console.log(`  creados: ${createdCount}${maskedCreated.length ? ` (${maskedCreated.join(", ")})` : ""}`);
  console.log(
    `  actualizados (password forzado): ${updatedCount}${maskedUpdated.length ? ` (${maskedUpdated.join(", ")})` : ""}`
  );
  console.log(
    `  omitidos (ya existen o sin password en env): ${skippedCount}${maskedSkipped.length ? ` (${maskedSkipped.join(", ")})` : ""}`
  );
}

main().catch((err) => {
  console.error("[seed-genus-auth] falló:", err?.message ?? err);
  process.exit(1);
});
