/**
 * Auditoría estática de migración 0005 (sin tocar Neon Preview).
 * @vitest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL_PATH = path.resolve(
  __dirname,
  "../../../drizzle/0005_avisos_mp_stock_coa.sql"
);

describe("migración 0005 — auditoría estática", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");

  it("no contiene DROP/TRUNCATE/ALTER destructivo sobre tablas existentes", () => {
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+"(operational_orders|inv_|formula_|os_notifications)/i);
  });

  it("usa CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS", () => {
    const creates = sql.match(/CREATE TABLE/gi) ?? [];
    const ifNotExists = sql.match(/CREATE TABLE IF NOT EXISTS/gi) ?? [];
    expect(ifNotExists.length).toBe(creates.length);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "mp_stock_movements_idempotency_uidx"/);
  });

  it("define PK, FK e idempotencia de stock", () => {
    expect(sql).toMatch(/os_internal_messages[\s\S]*PRIMARY KEY/);
    expect(sql).toMatch(
      /os_internal_message_recipients[\s\S]*REFERENCES "os_internal_messages"/
    );
    expect(sql).toMatch(
      /mp_weekly_control_lines[\s\S]*REFERENCES "mp_weekly_controls"/
    );
    expect(sql).toMatch(/"idempotency_key" text NOT NULL/);
    expect(sql).toMatch(/mp_stock_movements_idempotency_uidx/);
    expect(sql).toMatch(/coa_files[\s\S]*drive_file_id/);
    expect(sql).toMatch(/coa_file_versions[\s\S]*UNIQUE \("file_id", "version"\)/);
    expect(sql).toMatch(/feature_audit_events/);
  });

  it("no almacena binarios COA (solo metadata/refs)", () => {
    expect(sql).not.toMatch(/\bbytea\b/i);
    expect(sql).not.toMatch(/\bBLOB\b/i);
    expect(sql).toMatch(/drive_file_id/);
    expect(sql).toMatch(/drive_folder_id/);
  });
});
