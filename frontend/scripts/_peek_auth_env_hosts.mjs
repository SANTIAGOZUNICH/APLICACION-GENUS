/**
 * Peek env hostnames for auth migration work — never prints secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function describeUrl(label, value) {
  if (!value) return console.log(label, "MISSING");
  if (value === "[SENSITIVE]") return console.log(label, "SENSITIVE_PLACEHOLDER");
  try {
    const u = new URL(value);
    console.log(
      label,
      "host=",
      u.hostname,
      "polished=",
      u.hostname.includes("polished-recipe"),
      "len=",
      value.length
    );
  } catch {
    console.log(label, "INVALID_URL", "len=", value.length);
  }
}

for (const name of [".env.local", ".env.preview.local"]) {
  console.log("===", name, "===");
  const env = loadEnv(path.join(root, name));
  if (!env) {
    console.log("(absent)");
    continue;
  }
  for (const key of Object.keys(env).sort()) {
    if (!/DATABASE|NEON|POSTGRES|GENUS_AUTH|VERCEL_ENV|APPLY_/.test(key)) continue;
    if (/URL|POSTGRES/.test(key) && !key.includes("TOKEN")) describeUrl(key, env[key]);
    else
      console.log(
        key,
        "present",
        "len=",
        String(env[key] ?? "").length,
        "placeholder=",
        env[key] === "[SENSITIVE]"
      );
  }
}

console.log("=== process.env (filtered) ===");
for (const key of Object.keys(process.env).sort()) {
  if (!/DATABASE|NEON|POSTGRES|GENUS_AUTH|VERCEL_ENV|APPLY_/.test(key)) continue;
  const value = process.env[key];
  if (/URL|POSTGRES/.test(key) && !key.includes("TOKEN")) describeUrl(key, value);
  else
    console.log(
      key,
      "present",
      "len=",
      String(value ?? "").length,
      "placeholder=",
      value === "[SENSITIVE]"
    );
}
