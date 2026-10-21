// Solo para investigación local: siembra 1.400 filas de Stock MP y mantiene el servidor vivo hasta que exista /tmp/planillas-debug-stop.
import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
rmSync("/tmp/planillas-debug-stop", { force: true });
await q(`insert into inv_mp_stock (id, payload, updated_at)
 select g.id, jsonb_build_object('id', g.id::text, 'codigo','ZZE-' || lpad(g.n::text,5,'0'), 'descripcion','Materia ZZE ' || g.n, 'proveedor','Prov ' || g.n, 'lote','L' || g.n, 'cantidadKg',10, 'ubicacion','U' || (g.n % 40), 'vencimiento','2028-01-31','estadoStock','Stock OK','origen','manual','archived',false,'createdBy','zze','updatedBy','zze','createdAt','2026-10-01T00:00:00.000Z','updatedAt','2026-10-01T00:00:00.000Z'), now()
 from (select gen_random_uuid() id, n from generate_series(1, 1400) n) g`);
console.log("HOLD: listo", process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280");
while (!existsSync("/tmp/planillas-debug-stop")) await new Promise((r) => setTimeout(r, 1000));
await pool.end();
