/**
 * Imprime la huella (12 hex, no reversible) de una base Postgres, igual que `databaseFingerprint` de /api/v1/env-check.
 * La URL se pasa por variable de entorno para no dejarla en el historial de la terminal:
 *   read -s GENUS_FP_URL && export GENUS_FP_URL && npx tsx scripts/it/db-fingerprint.ts
 */
import { databaseFingerprint } from "../../src/lib/config/db-fingerprint";

const fp = databaseFingerprint(process.env.GENUS_FP_URL);
if (!fp) {
  console.error("Definí GENUS_FP_URL con una URL postgres:// válida.");
  process.exit(1);
}
console.log(fp);
