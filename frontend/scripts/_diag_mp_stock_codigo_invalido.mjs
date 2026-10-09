/**
 * SOLO LECTURA: lotes de Stock MP con un código sin letras ni números (p. ej. «..», «-», «.»).
 * Para cada uno muestra de dónde salió: auditoría (quién lo creó y con qué acción), ingresos MP que apuntan al lote
 * (stockLotId) o tienen el mismo código, y movimientos del libro mayor de ese código.
 * No escribe nada. No imprime DATABASE_URL.
 *
 *   DATABASE_URL=postgres://… node scripts/_diag_mp_stock_codigo_invalido.mjs
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("STOP: falta DATABASE_URL");
  process.exit(1);
}
const sql = neon(url);
const INVALID = "^[^[:alnum:]]*$"; // vacío o solo signos

const lots = await sql`
  select id, payload->>'codigo' as codigo, payload->>'descripcion' as descripcion, payload->>'proveedor' as proveedor,
         payload->>'cantidadKg' as kg, payload->>'origen' as origen, payload->>'createdBy' as creado_por,
         payload->>'createdAt' as creado, coalesce((payload->>'archived')::boolean, false) as archivado
  from inv_mp_stock
  where coalesce(payload->>'codigo', '') ~ ${INVALID}
  order by payload->>'createdAt'`;
console.log(`Lotes con código inválido: ${lots.length}`);
for (const l of lots) {
  console.log("\n— Lote", l.id, JSON.stringify({ codigo: l.codigo, descripcion: l.descripcion, proveedor: l.proveedor, kg: l.kg, origen: l.origen, creado_por: l.creado_por, creado: l.creado, archivado: l.archivado }));
  const audit = await sql`
    select payload->>'action' as accion, payload->>'actor' as actor, payload->>'createdAt' as cuando, payload->>'reason' as motivo
    from inv_audit where payload->>'entityId' = ${l.id} order by payload->>'createdAt'`;
  console.log("  auditoría:", audit.length ? audit : "(sin registros: cargado por importación/migración, no desde la app)");
  const ingresos = await sql`
    select id, payload->>'ingresoNro' as nro, payload->>'status' as estado, payload->>'remitoNro' as remito,
           payload->>'cantidad' as cantidad, payload->>'createdBy' as creado_por
    from inv_mp_ingresos
    where payload->>'stockLotId' = ${l.id} or upper(trim(coalesce(payload->>'codigo',''))) = upper(trim(${l.codigo ?? ""}))`;
  console.log("  ingresos MP vinculados:", ingresos.length ? ingresos : "(ninguno)");
  try {
    const movs = await sql`
      select kind, quantity, ref_type, ref_id, actor_email, created_at from mp_stock_movements
      where upper(trim(codigo)) = upper(trim(${l.codigo ?? ""})) order by created_at`;
    console.log("  movimientos del libro mayor:", movs.length ? movs : "(ninguno)");
  } catch {
    console.log("  movimientos del libro mayor: (tabla no disponible)");
  }
}
