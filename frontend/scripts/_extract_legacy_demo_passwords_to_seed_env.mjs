/**
 * ONE-SHOT Preview helper: reads historically committed demo passwords from a
 * past git revision of mock-preview-users.ts and writes them to a gitignored
 * env file for `npm run auth:seed`. Does not print password values.
 *
 * Usage:
 *   node scripts/_extract_legacy_demo_passwords_to_seed_env.mjs
 *
 * Output: .env.auth.seed.local (gitignored via .env*.local)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(root, "..");
const relativePath = "frontend/src/features/os/auth/lib/mock-preview-users.ts";

const ENV_BY_EMAIL = {
  "elaboracion@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_ELABORACION",
  "emasivo@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_ENVASADO_MASIVO",
  "epremium@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_ENVASADO_PREMIUM",
  "calidad@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_CALIDAD",
  "produccion@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_PRODUCCION",
  "mp@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_MATERIA_PRIMA",
  "codificado@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_CODIFICADO",
  "deposito@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_DEPOSITO",
};

// Last commit known to still contain password literals in that file.
const SOURCE_REF = "ed92295";

const blob = execFileSync("git", ["show", `${SOURCE_REF}:${relativePath}`], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
});

const blockRe =
  /\{\s*email:\s*"([^"]+)",\s*password:\s*"([^"]+)"/g;
const found = new Map();
for (const match of blob.matchAll(blockRe)) {
  found.set(match[1].toLowerCase(), match[2]);
}

const lines = [
  "# Gitignored Preview seed passwords extracted from historical git blob.",
  "# DO NOT COMMIT. Rotate before Production.",
  "APPLY_AUTH_SEED=1",
];

let missing = 0;
for (const [email, envName] of Object.entries(ENV_BY_EMAIL)) {
  const password = found.get(email.toLowerCase());
  if (!password) {
    missing += 1;
    continue;
  }
  lines.push(`${envName}=${password}`);
}

if (missing > 0 || lines.length < 3 + Object.keys(ENV_BY_EMAIL).length) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "Could not extract all legacy demo passwords from git history",
      foundEmails: found.size,
      expected: Object.keys(ENV_BY_EMAIL).length,
      missing,
    })
  );
  process.exit(1);
}

const outPath = path.join(root, ".env.auth.seed.local");
fs.writeFileSync(outPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
console.log(
  JSON.stringify({
    ok: true,
    out: path.basename(outPath),
    accounts: Object.keys(ENV_BY_EMAIL).length,
    sourceRef: SOURCE_REF,
    note: "Password values not printed. Rotate before Production.",
  })
);
