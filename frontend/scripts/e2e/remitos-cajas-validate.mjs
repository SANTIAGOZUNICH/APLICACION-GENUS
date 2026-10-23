// Validación (API + PDF, build de producción) de las CAJAS en remitos. Base DESCARTABLE; login real.
// Compara 4 fuentes: base de datos, API, borrador (pantalla) y PDF impreso.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-CAJ";
const C1 = "CLIENTE CAJAS UNO SA";
const C2 = "CLIENTE CAJAS DOS SA";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const ExcelJS = require("exceljs");
// El documento del remito es el XLSX (los remitos nuevos no generan PDF). Se leen TODAS las celdas con su valor/resultado.
const xlsxValues = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { const v = c.value; out.push(v && typeof v === "object" && "result" in v ? v.result : v); })));
  return out;
};
const sumCajas = (groups) => (groups ?? []).reduce((s, g) => s + Number(g.cajas), 0);

async function cleanup() {
  await q("delete from remitos where client_display in ($1,$2)", [C1, C2]).catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
}

try {
  await cleanup();
  await q("update work_items set operational_status = 'en_curso' where operational_status = 'revision' and notes not like $1", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error(`login: ${await lg.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E cajas" } })).json()).week.id;
  const ids = {};
  const create = async (key, client, product, qty, groups) => {
    const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client, plannedQuantity: qty, unit: "un", product, sector: "ENVASADO_MASIVO", line: "Línea 1" } });
    if (res.status() !== 201) throw new Error(`crear ${key}: ${await res.text()}`);
    ids[key] = bare((await res.json()).item.id);
    if (groups) await q("update work_items set packing_groups = $2::jsonb where id = $1", [ids[key], JSON.stringify(groups)]);
  };
  // Cajas REGISTRADAS EN EL TRABAJO (Envasado/Codificado): la entrega se hace SIN volver a cargarlas.
  await create("A", C1, "PROD A SIMPLE", "1000", [{ cajas: 10, unidadesPorCaja: 100 }]);
  await create("B", C1, "PROD B VARIAS", "1250", [{ cajas: 12, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
  await create("D", C1, "PROD D PARCIAL", "1000", [{ cajas: 10, unidadesPorCaja: 100 }]);
  await create("F", C2, "PROD F VACIO", "300", null); // sin ningún dato de cajas
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  for (const id of Object.values(ids)) await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = planned_quantity where id = $1", [id]);
  const deliver = async (key, qty, boxes) => {
    const res = await api.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${ids[key]}`, actorSectorId: "PRODUCCION", deliverQuantity: qty, idempotencyKey: `caj-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: "ENVASADO_MASIVO", product: "", deliveryPackingGroups: boxes ?? null } });
    if (!res.ok()) throw new Error(`entregar ${key}: ${res.status()} ${await res.text()}`);
  };
  const lineOf = async (key, seq = 1) => (await q("select id, quantity::float8 q, packing_groups from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [ids[key]]))[seq - 1];
  const eligible = async () => (await (await api.get("/api/v1/remitos/deliveries")).json()).deliveries;

  await deliver("A", null, null);
  await deliver("B", null, null);
  const a = await lineOf("A"); const b = await lineOf("B");
  check("A · entrega sin cargar cajas: queda guardada en la línea la distribución del trabajo (10 × 100)", JSON.stringify(a.packing_groups) === JSON.stringify([{ cajas: 10, unidadesPorCaja: 100 }]), JSON.stringify(a.packing_groups));
  check("C · cajas completas + parcial conservadas por separado (12 × 100 + 1 × 50)", sumCajas(b.packing_groups) === 13 && b.packing_groups.length === 2, JSON.stringify(b.packing_groups));

  // D · parcial: 400 con sus cajas propias y el saldo (600) sin cargar → recibe el resto exacto.
  await deliver("D", 400, [{ cajas: 4, unidadesPorCaja: 100 }]);
  await deliver("D", 600, null);
  const d2 = await lineOf("D", 2);
  check("D · entrega parcial: el saldo toma exactamente las cajas restantes (6 × 100)", JSON.stringify(d2.packing_groups) === JSON.stringify([{ cajas: 6, unidadesPorCaja: 100 }]), JSON.stringify(d2.packing_groups));

  // E/H · histórico: la línea quedó SIN cajas (así se guardaban antes) pero el trabajo las tiene → se recuperan al leer.
  await q("update work_item_delivery_lines set packing_groups = null where id = any($1::uuid[])", [[a.id, b.id]]);
  const el = await eligible();
  const ea = el.find((x) => x.deliveryLineId === a.id); const eb = el.find((x) => x.deliveryLineId === b.id);
  check("E/H · entrega histórica sin cajas propias: la API las recupera del trabajo (sin tocar la entrega)", ea?.packingGroups?.[0]?.cajas === 10 && ea?.packingSource === "TRABAJO" && sumCajas(eb?.packingGroups) === 13);
  check("la lectura NO modifica la entrega guardada (solo lectura)", (await lineOf("A")).packing_groups === null);

  // H · el trabajo perdió sus cajas pero el registro de entrega conserva el snapshot → también se recupera.
  await q("update work_items set packing_groups = null where id = $1", [ids.A]);
  const ea2 = (await eligible()).find((x) => x.deliveryLineId === a.id);
  check("H · sin cajas en el trabajo: se recupera del snapshot del registro de entrega", ea2?.packingGroups?.[0]?.cajas === 10 && ea2?.packingSource === "SNAPSHOT", JSON.stringify(ea2?.packingGroups));

  // B/F · remito con varios productos; las cajas viajan al borrador.
  const mov0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const created = await api.post("/api/v1/remitos/deliveries", { data: { action: "create", lineIds: [a.id, b.id, d2.id] } });
  const cb = await created.json();
  check("B · se crea UN borrador con los productos y las cajas recuperadas", created.status() === 201 && cb.remitos.length === 1 && cb.remitos[0].lines.length === 3 && cb.remitos[0].totalCajas === 10 + 13 + 6, JSON.stringify(cb).slice(0, 220));
  const remId = cb.remitos[0].id;
  const dbLines = await q("select product, cajas1, cajas2, payload from remito_lines where remito_id = $1 order by product", [remId]);
  const dbCajas = dbLines.reduce((s, l) => s + l.cajas1 + l.cajas2 + Number(l.payload?.cajas3 ?? 0) + (l.payload?.extraCajas ?? []).reduce((x, e) => x + Number(e.cajas), 0), 0);
  check("base de datos: las líneas del remito guardan las cajas (A=10, B=12+1, D=6)", dbLines.length === 3 && dbCajas === 29, JSON.stringify(dbLines.map((l) => [l.product, l.cajas1, l.cajas2])));

  // F · borrador creado SIN cajas (entrega de «F» sin ningún dato), luego se cargan en el trabajo → se completa al abrir; las correcciones manuales no se pisan.
  await deliver("F", null, null);
  const f = await lineOf("F");
  check("F · sin datos de cajas: la entrega queda sin cajas (no se inventa nada)", f.packing_groups === null);
  const cF = await (await api.post("/api/v1/remitos/deliveries", { data: { action: "create", lineIds: [f.id] } })).json();
  const remF = cF.remitos[0];
  check("F · el borrador nace con 0 cajas (campo editable), no bloquea la generación", remF.totalCajas === 0 && remF.lines.length === 1);
  await q("update work_items set packing_groups = $2::jsonb where id = $1", [ids.F, JSON.stringify([{ cajas: 3, unidadesPorCaja: 100 }])]);
  const listed = await (await api.get("/api/v1/remitos?tab=borradores")).json();
  const fL = listed.remitos.find((r) => r.id === remF.id);
  check("F · al abrir el borrador se completan las cajas ya registradas (3 × 100)", fL?.totalCajas === 3, JSON.stringify(fL?.lines?.[0]));
  check("F · la base y la API coinciden tras recargar", (await q("select cajas1 from remito_lines where remito_id = $1", [remF.id]))[0].cajas1 === 3 && (await (await api.get(`/api/v1/remitos/${remF.id}`)).json()).remito.totalCajas === 3);
  // G · corrección manual: se conserva y el PDF la respeta.
  const lineF = fL.lines[0];
  const upd = await api.patch(`/api/v1/remitos/${remF.id}`, { data: { action: "update_draft", patch: { lines: [{ id: lineF.id, cajas1: 2, unidades1: 150, cajas2: 0, unidades2: 0, cajas3: 0, unidades3: 0, extraCajas: [] }] } } });
  const reopened = (await (await api.get("/api/v1/remitos?tab=borradores")).json()).remitos.find((r) => r.id === remF.id);
  check("G · la corrección manual (2 × 150) se conserva y no se vuelve a pisar al reabrir", upd.ok() && reopened.totalCajas === 2 && reopened.lines[0].unidades1 === 150, JSON.stringify(reopened?.lines?.[0]));
  const gen = await api.patch(`/api/v1/remitos/${remF.id}`, { data: { action: "generate", displayName: "Remito cajas F" } });
  check("generar el remito con la corrección", gen.ok(), gen.ok() ? "" : (await gen.text()).slice(0, 200));
  if (gen.ok()) {
    const dl = await api.get(`/api/v1/remitos/${remF.id}/download?format=xlsx`);
    const vals = dl.ok() ? await xlsxValues(Buffer.from(await dl.body())) : [];
    check("G · el documento (XLSX) imprime exactamente lo confirmado: 2 cajas × 150 u.", dl.ok() && vals.includes(2) && vals.includes(150) && !vals.includes(3), `${dl.status()} ${JSON.stringify(vals.filter((v) => typeof v === "number"))}`);
    const reopen2 = await (await api.get(`/api/v1/remitos/${remF.id}`)).json();
    check("F · generado → cerrado → reabierto: conserva las cantidades", reopen2.remito.status === "GENERADO" && reopen2.remito.totalCajas === 2);
  }
  // Documento del remito principal: 3 productos, una de ellas con dos configuraciones de caja.
  const genM = await api.patch(`/api/v1/remitos/${remId}`, { data: { action: "generate", displayName: "Remito cajas principal" } });
  if (genM.ok()) {
    const dlM = await api.get(`/api/v1/remitos/${remId}/download?format=xlsx`);
    const vals = dlM.ok() ? await xlsxValues(Buffer.from(await dlM.body())) : [];
    const nums = vals.filter((v) => typeof v === "number");
    check("XLSX = base de datos: 10 × 100, 12 × 100 + 1 × 50, 6 × 100 y total 29 cajas", [10, 12, 6, 100, 50, 29].every((n) => nums.includes(n)), JSON.stringify(nums));
    const pdf = await api.get(`/api/v1/remitos/${remId}/download?format=pdf`);
    const pb = Buffer.from(await pdf.body());
    check("DESCARGAR PDF: PDF real (no vacío), UNA sola hoja A4 vertical", pdf.ok() && pb.subarray(0, 5).toString() === "%PDF-" && pb.length > 2000 && (pb.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length === 1 && /\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/.test(pb.toString("latin1")), `${pdf.status()} ${pb.length} bytes`);
  } else check("generar el remito principal", false, (await genM.text()).slice(0, 200));

  const diag = await api.get("/api/v1/remitos/diagnostico-cajas");
  const dj = diag.ok() ? await diag.json() : {};
  check("diagnóstico de solo lectura disponible (autenticado) y no expone credenciales", diag.ok() && dj.readOnly === true && typeof dj.counts?.total === "number" && !JSON.stringify(dj).match(/password|token|secret|postgres:/i));
  check("nada de esto movió inventario", (await q("select count(*)::int n from mp_stock_movements"))[0].n === mov0);
  const anon = await pwRequest.newContext({ baseURL: BASE });
  check("el diagnóstico exige sesión", (await anon.get("/api/v1/remitos/diagnostico-cajas")).status() >= 400);
} catch (error) {
  console.error(error);
  check("ejecución sin excepciones", false, String(error?.message ?? error));
} finally {
  await cleanup().catch(() => undefined);
  await pool.end().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
