/**
 * Códigos de cliente automáticos (GEN-XXXXXX) contra un Postgres de PRUEBA real: alta desde cada flujo real (planificación,
 * pedidos, importación, entregas), reutilización, cambio de nombre, concurrencia, conciliación con fecha de corte, vista previa +
 * confirmación de la generación histórica, acceso deshabilitado por defecto y que NO se envíe ningún correo ni se toque data operativa.
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = randomUUID().slice(0, 6).toUpperCase();
const N = (s: string) => `IT COD ${s} ${RUN}`;
const produccion = { email: `prod-${RUN.toLowerCase()}@laboratoriogenus.com.ar`, sector: "PRODUCCION", displayName: "IT Producción" };
const staff = { email: produccion.email, sector: "PRODUCCION" };
const CODE = /^GEN-[A-Z0-9]{6}$/;

describe.skipIf(Boolean(PROBLEM))(`Códigos de cliente automáticos en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let planning: import("@/lib/planning/planning-service").PlanningService;
  let weekId = "";
  const ident = () => import("@/lib/portal/client-identity");
  const admin = () => import("@/lib/portal/admin-service");
  const byAlias = async (label: string) =>
    (await q(
      `select c.id::text as id, c.public_code, c.display_name, c.access_enabled, c.origin, c.origin_detail, c.status
         from portal_client_aliases a join portal_clients c on c.id = a.client_id
        where a.removed_at is null and a.name_key = $1`,
      [(await import("@/lib/entregas/rules")).clientKey(label)],
    ))[0];
  const operational = async () =>
    JSON.stringify(await Promise.all([
      q("select count(*)::int n from work_items"),
      q("select count(*)::int n from production_pedidos"),
      q("select count(*)::int n from scheduled_deliveries"),
      q("select count(*)::int n from portal_email_outbox"),
    ]));

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-cod-secret-".padEnd(40, "x");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    planning = new PlanningService(new DrizzlePlanningRepository());
    // El servicio de pedidos usa memoria bajo Vitest: acá se necesita el camino REAL de base de datos.
    vi.stubEnv("VITEST", "false");
    const weekStart = "2039-03-07";
    const week = (await planning.listWeeks(weekStart))[0] ?? (await planning.createWeek({ weekStart, label: "IT códigos" }, produccion as never));
    weekId = week.id;
  }, 120_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
  });

  it("cliente nuevo desde Planificación: recibe código GEN-XXXXXX, acceso deshabilitado, origen automático, sin correos", async () => {
    const before = (await q("select count(*)::int n from portal_email_outbox"))[0]!.n;
    const name = N("PLAN");
    await planning.createItem(weekId, { plannedDate: "2039-03-08", client: name, product: "Crema", plannedQuantity: "100", unit: "un", sector: "CODIFICADO" } as never, produccion as never);
    const c = await byAlias(name);
    expect(c).toBeTruthy();
    expect(String(c!.public_code)).toMatch(CODE);
    expect(c!.access_enabled).toBe(false);
    expect(c!.origin).toBe("AUTOMATICO");
    expect(c!.origin_detail).toBe("planificacion");
    expect((await q("select count(*)::int n from portal_email_outbox"))[0]!.n).toBe(before);
    expect((await q("select count(*)::int n from portal_authorized_emails where client_id = $1::uuid", [c!.id]))[0]!.n).toBe(0);
  });

  it("cliente existente: reutiliza el código; variantes de mayúsculas/espacios no crean otro", async () => {
    const name = N("PLAN");
    const first = await byAlias(name);
    await planning.createItem(weekId, { plannedDate: "2039-03-09", client: `  ${name.toLowerCase()}  `, product: "Otra", plannedQuantity: "5", unit: "un", sector: "CODIFICADO" } as never, produccion as never);
    const again = await byAlias(name);
    expect(again!.id).toBe(first!.id);
    expect(again!.public_code).toBe(first!.public_code);
    expect((await q("select count(*)::int n from portal_clients where id = $1::uuid", [first!.id]))[0]!.n).toBe(1);
  });

  it("desde un pedido (alta, edición de cliente y edición por celda): un código por cliente, no por pedido/producto", async () => {
    const { getProductionPedidosService } = await import("@/lib/production-pedidos/service");
    const svc = getProductionPedidosService();
    const actor = { email: produccion.email, sector: "PRODUCCION" };
    const a = N("PED");
    const p1 = await svc.create(actor, { op: `OP-A-${RUN}`, cliente: a, producto: "Shampoo", q: 10, ml: 100, estado: "INGRESO" } as never);
    await svc.create(actor, { op: `OP-B-${RUN}`, cliente: a, producto: "Acondicionador", q: 20, ml: 100, estado: "INGRESO" } as never);
    const c = await byAlias(a);
    expect(String(c!.public_code)).toMatch(CODE);
    expect(c!.origin_detail).toBe("pedido");
    expect((await q("select count(*)::int n from portal_clients c join portal_client_aliases al on al.client_id = c.id where al.name_key = $1", [(await import("@/lib/entregas/rules")).clientKey(a)]))[0]!.n).toBe(1);

    // Cambiar el cliente del pedido a uno nuevo crea ESE cliente (y solo ese).
    const b = N("PED2");
    await svc.update(actor, p1.id, { op: p1.op, cliente: b, producto: p1.producto, q: 10, ml: 100, estado: "INGRESO" } as never);
    expect(String((await byAlias(b))!.public_code)).toMatch(CODE);
    expect((await byAlias(a))!.public_code).toBe(c!.public_code);
  });

  it("importación de pedidos: un código por cliente distinto aunque se repita en varias filas", async () => {
    const { getProductionPedidosService } = await import("@/lib/production-pedidos/service");
    const svc = getProductionPedidosService();
    const actor = { email: produccion.email, sector: "PRODUCCION" };
    const x = N("IMP-X");
    const y = N("IMP-Y");
    const res = await svc.importMany(actor, [
      { op: `IMP1-${RUN}`, cliente: x, producto: "P1", q: 1, ml: 10, estado: "INGRESO" },
      { op: `IMP2-${RUN}`, cliente: x, producto: "P2", q: 1, ml: 10, estado: "INGRESO" },
      { op: `IMP3-${RUN}`, cliente: y, producto: "P3", q: 1, ml: 10, estado: "INGRESO" },
    ] as never, { idempotencyKey: `it-imp-${RUN}-12345` });
    expect(res.inserted).toBe(3);
    const cx = await byAlias(x);
    const cy = await byAlias(y);
    expect(String(cx!.public_code)).toMatch(CODE);
    expect(String(cy!.public_code)).toMatch(CODE);
    expect(cx!.public_code).not.toBe(cy!.public_code);
    expect(cx!.origin_detail).toBe("importacion_pedidos");
  });

  it("desde una entrega programada: código al crear la entrega", async () => {
    const { entregasService } = await import("@/lib/entregas/service");
    const name = N("ENT");
    await entregasService.create({ email: produccion.email, sector: "PRODUCCION" }, { client: name, deliveryDate: "2039-04-12", items: [{ product: "Jabón", quantity: "10", unit: "un" }] } as never);
    const c = await byAlias(name);
    expect(String(c!.public_code)).toMatch(CODE);
    expect(c!.origin_detail).toBe("entrega");
  });

  it("cambio de nombre comercial: el código y el vínculo con pedidos no cambian", async () => {
    const a = N("PED");
    const before = await byAlias(a);
    await (await admin()).renameClient(staff, before!.id as string, N("RENOMBRADO"));
    const after = await byAlias(a);
    expect(after!.public_code).toBe(before!.public_code);
    expect(after!.display_name).toBe(N("RENOMBRADO"));
    // Un pedido nuevo con el nombre viejo sigue vinculado al mismo cliente y no genera otro código.
    const { getProductionPedidosService } = await import("@/lib/production-pedidos/service");
    await getProductionPedidosService().create({ email: produccion.email, sector: "PRODUCCION" }, { op: `OP-C-${RUN}`, cliente: a, producto: "X", q: 1, ml: 1, estado: "INGRESO" } as never);
    expect((await byAlias(a))!.public_code).toBe(before!.public_code);
  });

  it("creación simultánea del mismo cliente: un solo cliente, un solo código, un solo alias", async () => {
    const { ensureClientIdentity } = await ident();
    const name = N("CONC");
    const results = await Promise.all(Array.from({ length: 12 }, () => ensureClientIdentity(name, { source: "pedido", actor: "it" })));
    const codes = new Set(results.map((r) => r!.publicCode));
    expect(codes.size).toBe(1);
    expect(results.filter((r) => r!.created).length).toBe(1);
    const key = (await import("@/lib/entregas/rules")).clientKey(name);
    expect((await q("select count(*)::int n from portal_client_aliases where name_key = $1 and removed_at is null", [key]))[0]!.n).toBe(1);
  });

  it("creaciones simultáneas de clientes distintos: todos con código y sin repetidos", async () => {
    const { ensureClientIdentity } = await ident();
    const names = Array.from({ length: 15 }, (_, i) => N(`PAR${i}`));
    const results = await Promise.all(names.map((n) => ensureClientIdentity(n, { source: "importacion_pedidos", actor: "it" })));
    expect(new Set(results.map((r) => r!.publicCode)).size).toBe(names.length);
    const dup = await q("select public_code, count(*)::int n from portal_clients group by public_code having count(*) > 1");
    expect(dup).toEqual([]);
  });

  it("nombres inválidos (vacío, s/d, solo números) no crean cliente", async () => {
    const { ensureClientIdentity } = await ident();
    const before = (await q("select count(*)::int n from portal_clients"))[0]!.n;
    for (const bad of ["", "   ", "s/d", "N/A", "12345", null, undefined]) expect(await ensureClientIdentity(bad, { source: "pedido" })).toBeNull();
    expect((await q("select count(*)::int n from portal_clients"))[0]!.n).toBe(before);
  });

  it("acceso deshabilitado por defecto: el código + correo autorizado NO permiten pedir ni usar el ingreso hasta habilitarlo", async () => {
    const name = N("ACC");
    const { ensureClientIdentity } = await ident();
    const id = (await ensureClientIdentity(name, { source: "pedido", actor: "it" }))!;
    const email = `acc-${RUN.toLowerCase()}@cliente.test`;
    await q("insert into portal_authorized_emails (client_id, email, added_by) values ($1::uuid, $2, 'it')", [id.clientId, email]);
    const { requestLoginCode } = await import("@/lib/portal/auth-service");
    const challenges = async () => (await q("select count(*)::int n from portal_login_challenges where client_id = $1::uuid", [id.clientId]))[0]!.n;
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });

    const r1 = await requestLoginCode({ code: id.publicCode, email, headers });
    expect(r1.status).toBe("accepted"); // respuesta neutra: no revela si el cliente existe
    expect(await challenges()).toBe(0);

    await (await admin()).setClientAccess(staff, id.clientId, true);
    const r2 = await requestLoginCode({ code: id.publicCode, email, headers: new Headers({ "x-forwarded-for": "198.51.100.8" }) });
    expect(r2.status).toBe("accepted");
    expect(await challenges()).toBe(1);

    // Deshabilitar de nuevo corta el ingreso y el envío de invitaciones.
    await (await admin()).setClientAccess(staff, id.clientId, false);
    await expect((await import("@/lib/portal/notify-service")).sendInvitation({ clientId: id.clientId, email, actor: "it" })).rejects.toMatchObject({ code: "ACCESS_DISABLED" });
  });

  it("alta manual desde el panel sigue habilitada y con origen MANUAL; un alias ya tomado informa el código del dueño", async () => {
    const { createClient, addClientAlias } = await admin();
    const created = await createClient(staff, { displayName: N("MANUAL") });
    const c = await byAlias(N("MANUAL"));
    expect(c!.access_enabled).toBe(true);
    expect(c!.origin).toBe("MANUAL");
    expect(created.publicCode).toBe(c!.public_code);
    await expect(addClientAlias(staff, (await byAlias(N("CONC")))!.id as string, N("MANUAL"))).rejects.toMatchObject({ code: "ALIAS_TAKEN", message: expect.stringContaining(created.publicCode) });
  });

  it("conciliación (cron): atrapa un cliente nuevo no pasado por el alta central y NO genera históricos anteriores al corte", async () => {
    const { reconcileNewClients } = await ident();
    const fresh = N("CONCIL-NUEVO");
    const old = N("CONCIL-VIEJO");
    // Inserciones directas (simulan una sincronización/proceso externo que no usa el servicio).
    await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1,'P',$2,'EN_PROCESO','IT','PRODUCCION')", [`OP-F-${RUN}`, fresh]);
    await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector, created_at) values ($1,'P',$2,'EN_PROCESO','IT','PRODUCCION', now() - interval '30 days')", [`OP-O-${RUN}`, old]);
    const r = await reconcileNewClients();
    expect(r.failed).toBe(0);
    const c = await byAlias(fresh);
    expect(String(c!.public_code)).toMatch(CODE);
    expect(c!.origin_detail).toBe("conciliacion");
    expect(c!.access_enabled).toBe(false);
    expect(await byAlias(old)).toBeUndefined();
    // Idempotente.
    const again = await reconcileNewClients();
    expect(again.created).toBe(0);
  });

  it("generación histórica: la vista previa NO escribe; exige token y cantidad; respeta exclusiones; deja acceso deshabilitado; sin duplicados", async () => {
    const { previewHistoricalClients, generateHistoricalClients } = await ident();
    const keep = N("HIST-A");
    const skip = N("HIST-B");
    const similar = N("HIST-A") + " S.A.";
    for (const n of [keep, skip, similar]) {
      await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector, created_at) values ($1,'P',$2,'EN_PROCESO','IT','PRODUCCION', now() - interval '40 days')", [`OP-H-${randomUUID().slice(0, 8)}`, n]);
    }
    const snapshot = await operational();
    const clientsBefore = (await q("select count(*)::int n from portal_clients"))[0]!.n;
    const prev = await previewHistoricalClients();
    expect((await q("select count(*)::int n from portal_clients"))[0]!.n).toBe(clientsBefore); // la vista previa no crea nada
    const names = prev.items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining([keep, skip, similar]));
    expect(prev.items.find((i) => i.name === keep)!.similarTo).toContain(similar);
    const skipKey = prev.items.find((i) => i.name === skip)!.key;

    // Sin token vigente o con cantidad equivocada: rechaza y no crea nada.
    await expect(generateHistoricalClients("it", { previewToken: "x", expectedCount: prev.total })).rejects.toMatchObject({ code: "PREVIEW_STALE" });
    await expect(generateHistoricalClients("it", { previewToken: prev.previewToken, expectedCount: prev.total + 1 })).rejects.toMatchObject({ code: "COUNT_MISMATCH" });
    expect((await q("select count(*)::int n from portal_clients"))[0]!.n).toBe(clientsBefore);

    const res = await generateHistoricalClients("it", { previewToken: prev.previewToken, expectedCount: prev.total - 1, excludeKeys: [skipKey] });
    expect(res.created).toBe(prev.total - 1);
    expect(res.failed).toBe(0);
    expect(await byAlias(skip)).toBeUndefined();
    for (const n of [keep, similar]) {
      const c = await byAlias(n);
      expect(String(c!.public_code)).toMatch(CODE);
      expect(c!.access_enabled).toBe(false);
      expect(c!.origin).toBe("HISTORICO");
    }
    // Reintento: nada nuevo (idempotente) y sin códigos repetidos.
    const next = await previewHistoricalClients();
    expect(next.items.map((i) => i.name)).not.toContain(keep);
    expect(await q("select public_code from portal_clients group by public_code having count(*) > 1")).toEqual([]);
    // No tocó la data operativa ni mandó correos.
    expect(await operational()).toBe(snapshot);
  });

  it("vinculación: los pedidos del cliente aparecen en su portal por el alias, con un único código", async () => {
    const name = N("LINK");
    const { getProductionPedidosService } = await import("@/lib/production-pedidos/service");
    const actor = { email: produccion.email, sector: "PRODUCCION" };
    const svc = getProductionPedidosService();
    const p1 = await svc.create(actor, { op: `OP-L1-${RUN}`, cliente: name, producto: "Prod 1", q: 1, ml: 1, estado: "INGRESO" } as never);
    await svc.create(actor, { op: `OP-L2-${RUN}`, cliente: name, producto: "Prod 2", q: 1, ml: 1, estado: "INGRESO" } as never);
    const c = (await byAlias(name))!;
    const owners = await q("select distinct client_id::text as id from portal_client_aliases where removed_at is null and name_key = $1", [(await import("@/lib/entregas/rules")).clientKey(p1.cliente ?? name)]);
    expect(owners).toEqual([{ id: c.id }]);
    const { loadPortalOverview } = await import("@/lib/portal/data-service");
    await expect(loadPortalOverview(c.id as string)).resolves.toBeTruthy();
  });
});
