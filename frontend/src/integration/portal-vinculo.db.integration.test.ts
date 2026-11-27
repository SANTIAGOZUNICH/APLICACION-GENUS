/**
 * Portal de Clientes — VÍNCULO POR ID del cliente (migración 0098) contra un Postgres de PRUEBA real, SIN mocks en la vinculación.
 *
 * Reproduce el fallo de producción («GENUS TEST»: pedido asignado desde Producción que no aparece en el portal) y verifica la
 * solución: pedido guardado con el ID del cliente (formulario) o resuelto sin ambigüedad por nombre; el portal lista por ID;
 * históricos por nombre inequívoco; backfill idempotente de solo Dirección (ambiguos/sin coincidencia solo se reportan);
 * firma (ETag) que cambia con pedidos sin trabajos; movimientos entre sectores; cancelación; eventos push idénticos (outbox simulada,
 * envío general APAGADO); y aislamiento estricto entre «GENUS TEST», «GENUS TEST 2» y «GENUS».
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const direccion = { email: "it-pv-direccion@laboratoriogenus.com.ar", sector: "DIRECCION", displayName: "IT Dirección" };
const produccion = { email: "it-pv-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const envasado = { email: "it-pv-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO", displayName: "IT Envasado" };
const RUN = randomUUID().slice(0, 4).toUpperCase();
// Nombres parecidos a propósito: uno es prefijo del otro.
const N_TEST = `GENUS TEST ${RUN}`;
const N_TEST2 = `GENUS TEST ${RUN} 2`;
const N_GENUS = `GENUS ${RUN}`;
const sender = () => vi.fn(async () => undefined);
const VAPID = { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" };

describe.skipIf(Boolean(PROBLEM))(`Portal: vínculo por ID en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let planning: import("@/lib/planning/planning-service").PlanningService;
  let weekId = "";
  let T = { id: "", code: "" };
  let T2 = { id: "", code: "" };
  let G = { id: "", code: "" };
  const ids: Record<string, string> = {};

  const admin = () => import("@/lib/portal/admin-service");
  const data = () => import("@/lib/portal/data-service");
  const link = () => import("@/lib/portal/client-link");
  const push = () => import("@/lib/portal/push/push-service");
  const pedidos = async () => (await import("@/lib/production-pedidos/service")).getProductionPedidosService();
  const payloadOf = async (clientId: string) => {
    const { loadPortalOverview } = await data();
    const { toClientPayload } = await import("@/lib/portal/overview");
    return toClientPayload((await loadPortalOverview(clientId)).overview);
  };
  /** Referencias de pedido (OP) y su estado comercial tal como los ve el cliente. */
  const seenBy = async (clientId: string) => Object.fromEntries((await payloadOf(clientId)).orders.map((o) => [String(o.orderRef), o.status.label]));
  const etag = async (clientId: string) => (await import("@/lib/portal/security")).sha256(JSON.stringify({ ok: true, ...(await payloadOf(clientId)) }));
  const portalIdOf = async (op: string) => String((await q("select portal_client_id::text as id from production_pedidos where op = $1", [op]))[0]?.id ?? "");

  async function mkWork(client: string, product: string, sector: string, over: { status?: string; pedido?: string | null; qty?: string } = {}) {
    const it = await planning.createItem(weekId, { plannedDate: "2039-05-02", client, product, plannedQuantity: over.qty ?? "1000", unit: "un", sector, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }) } as never, produccion as never);
    await q("update work_items set operational_status = $2, production_pedido_id = $3::uuid where id = $1", [it.id, over.status ?? "pendiente", over.pedido ?? null]);
    return it.id;
  }
  const moveTo = (sector: "ELABORACION" | "ENVASADO_MASIVO", workIds: string[]) =>
    q(
      sector === "ENVASADO_MASIVO"
        ? "update work_items set sector = 'ENVASADO_MASIVO', branch_owner = null, line = 'Línea 1' where id = any($1::uuid[])"
        : "update work_items set sector = 'ELABORACION', branch_owner = 'Cristian', line = null where id = any($1::uuid[])",
      [workIds]
    );
  const outboxOf = async (clientId: string, orderRef?: string) =>
    q("select event_type, status, mode, order_ref from portal_push_outbox where client_id = $1::uuid" + (orderRef ? " and order_ref = $2" : "") + " order by created_at", orderRef ? [clientId, orderRef] : [clientId]);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.VITEST = "false"; // camino REAL (Postgres) del servicio de pedidos, no la memoria de pruebas
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.GENUS_FEATURE_MEMORY;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-secret-".padEnd(40, "x");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    planning = new PlanningService(new DrizzlePlanningRepository());
    const weekStart = "2039-05-02";
    const week = (await planning.listWeeks(weekStart))[0] ?? (await planning.createWeek({ weekStart, label: "IT portal vínculo" }, produccion as never));
    weekId = week.id;
    const adm = await admin();
    // Como en producción: el cliente se crea desde el panel (alias = nombre comercial).
    const t = await adm.createClient(direccion, { displayName: N_TEST, aliases: [N_TEST], emails: [] });
    const t2 = await adm.createClient(direccion, { displayName: N_TEST2, aliases: [N_TEST2], emails: [] });
    const g = await adm.createClient(direccion, { displayName: N_GENUS, aliases: [N_GENUS], emails: [] });
    T = { id: t.id, code: t.publicCode };
    T2 = { id: t2.id, code: t2.publicCode };
    G = { id: g.id, code: g.publicCode };
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  // ───────────────────────── 1. Causa raíz ─────────────────────────
  it("REPRODUCCIÓN: variantes de mayúsculas/espacios se vinculan; guion, «S.A.» o sin espacio crean OTRO cliente y el pedido queda huérfano", async () => {
    const svc = await pedidos();
    const seen: Record<string, boolean> = {};
    const owners: Record<string, string> = {};
    const variants: Array<[string, string]> = [
      ["exacto", N_TEST],
      ["minusculas", N_TEST.toLowerCase()],
      ["titulo", `Genus Test ${RUN}`],
      ["doble-espacio", N_TEST.replace(" ", "  ")],
      ["bordes", `  ${N_TEST} `],
      ["guion", `GENUS-TEST ${RUN}`],
      ["sufijo-sa", `${N_TEST} S.A.`],
      ["sin-espacio", `GENUSTEST ${RUN}`],
    ];
    for (const [tag, cliente] of variants) {
      const rec = await svc.create(produccion as never, { op: `OP-VAR-${tag}-${RUN}`, cliente, producto: `PROD ${tag}`, q: 10 } as never);
      seen[tag] = `OP-VAR-${tag}-${RUN}` in (await seenBy(T.id));
      owners[tag] = (await portalIdOf(rec.op!)) === T.id ? "T" : "otro";
    }
    // Lo que se ve y a quién queda vinculado:
    expect(seen).toEqual({ exacto: true, minusculas: true, titulo: true, "doble-espacio": true, bordes: true, guion: false, "sufijo-sa": false, "sin-espacio": false });
    expect(owners).toEqual({ exacto: "T", minusculas: "T", titulo: "T", "doble-espacio": "T", bordes: "T", guion: "otro", "sufijo-sa": "otro", "sin-espacio": "otro" });
    // Los «otros» son clientes AUTOMÁTICOS nuevos (el síntoma de producción): nunca ven los pedidos de T.
    const autos = await q("select display_name, origin from portal_clients where origin = 'AUTOMATICO' and display_name like $1 order by display_name", [`%${RUN}%`]);
    expect(autos.map((a) => a.display_name)).toEqual(expect.arrayContaining([`GENUS-TEST ${RUN}`, `${N_TEST} S.A.`, `GENUSTEST ${RUN}`]));
  });

  it("pedido SIN trabajos con estado distinto de INGRESO (elegido en el formulario) NO se veía; ahora sí, por ID", async () => {
    const svc = await pedidos();
    const rows: Array<[string, string | null]> = [["ingreso", "INGRESO"], ["elab", "EN_ELABORACION"], ["env", "EN_ENVASADO"], ["listo", "LISTO_PARA_ENTREGAR"], ["entregado", "ENTREGADO"]];
    for (const [tag, estado] of rows) {
      await svc.create(produccion as never, { op: `OP-EST-${tag}-${RUN}`, cliente: N_TEST, producto: `P ${tag}`, q: 5, estado, portalClientId: T.id } as never);
    }
    const s = await seenBy(T.id);
    expect(s[`OP-EST-ingreso-${RUN}`]).toBe("Pedido recibido");
    expect(s[`OP-EST-elab-${RUN}`]).toBe("En elaboración");
    expect(s[`OP-EST-env-${RUN}`]).toBe("En envasado");
    expect(s[`OP-EST-listo-${RUN}`]).toBe("En envasado"); // «Listo» exige la confirmación explícita del último sector
    expect(s[`OP-EST-entregado-${RUN}`]).toBeUndefined(); // «Entregado» exige entregas registradas: no se inventa
  });

  // ───────────────────────── 2. Vínculo por ID ─────────────────────────
  it("el ID elegido en el formulario manda sobre el texto: nombre distinto (o con typo) igual aparece y NO crea otro cliente", async () => {
    const svc = await pedidos();
    const before = Number((await q("select count(*)::int as n from portal_clients"))[0]!.n);
    const rec = await svc.create(produccion as never, { op: `OP-ID-${RUN}`, cliente: `Gnus Tset S.A. (typo ${RUN})`, producto: "CREMA ID", q: 20, portalClientId: T.id } as never);
    expect(rec.portalClientId).toBe(T.id);
    expect(await portalIdOf(`OP-ID-${RUN}`)).toBe(T.id);
    expect((await seenBy(T.id))[`OP-ID-${RUN}`]).toBe("Pedido recibido");
    expect(Number((await q("select count(*)::int as n from portal_clients"))[0]!.n)).toBe(before); // sin cliente automático nuevo
    expect(`OP-ID-${RUN}` in (await seenBy(T2.id))).toBe(false);
    expect(`OP-ID-${RUN}` in (await seenBy(G.id))).toBe(false);
  });

  it("un ID inexistente se rechaza (no se guarda un vínculo a la nada)", async () => {
    const svc = await pedidos();
    await expect(svc.create(produccion as never, { op: `OP-BAD-${RUN}`, cliente: N_TEST, producto: "X", portalClientId: randomUUID() } as never)).rejects.toThrow(/ya no existe/);
    await expect(svc.create(produccion as never, { op: `OP-BAD2-${RUN}`, cliente: N_TEST, producto: "X", portalClientId: "no-es-uuid" } as never)).rejects.toThrow(/no es válido/);
    expect(await q("select 1 from production_pedidos where op in ($1, $2)", [`OP-BAD-${RUN}`, `OP-BAD2-${RUN}`])).toEqual([]);
  });

  it("editar otro campo conserva el ID; cambiar el cliente por otro lo reasigna y arrastra sus trabajos", async () => {
    const svc = await pedidos();
    const rec = await svc.create(produccion as never, { op: `OP-EDIT-${RUN}`, cliente: N_TEST, producto: "P EDIT", q: 1, portalClientId: T.id } as never);
    ids.pedEdit = rec.id;
    ids.wEdit = await mkWork(N_TEST, "P EDIT", "ELABORACION", { status: "en_curso", pedido: rec.id });
    await q("update work_items set portal_client_id = null where id = $1", [ids.wEdit]);
    await svc.update(produccion as never, rec.id, { op: rec.op, cliente: N_TEST, producto: "P EDIT", q: 2 } as never); // sin portalClientId en el body
    expect(await portalIdOf(`OP-EDIT-${RUN}`)).toBe(T.id);
    expect((await seenBy(T.id))[`OP-EDIT-${RUN}`]).toBe("En elaboración");
    // Reasignación a «GENUS TEST 2» (selector): el pedido y su trabajo pasan juntos.
    await svc.update(produccion as never, rec.id, { op: rec.op, cliente: N_TEST2, producto: "P EDIT", q: 2, portalClientId: T2.id } as never);
    expect(await portalIdOf(`OP-EDIT-${RUN}`)).toBe(T2.id);
    expect(String((await q("select portal_client_id::text as id from work_items where id = $1", [ids.wEdit]))[0]!.id)).toBe(T2.id);
    expect(`OP-EDIT-${RUN}` in (await seenBy(T.id))).toBe(false);
    expect((await seenBy(T2.id))[`OP-EDIT-${RUN}`]).toBe("En elaboración");
  });

  it("trabajo nuevo: hereda el ID del pedido aunque su nombre difiera (prevalece el pedido)", async () => {
    const svc = await pedidos();
    const rec = await svc.create(produccion as never, { op: `OP-HER-${RUN}`, cliente: "Nombre libre distinto", producto: "P HER", q: 3, portalClientId: T.id } as never);
    const wid = await mkWork("Otro nombre cualquiera", "P HER", "ELABORACION", { status: "en_curso", pedido: rec.id });
    const { linkWorkSafe } = await link();
    await linkWorkSafe(wid, "Otro nombre cualquiera", "asignacion", null);
    expect(String((await q("select portal_client_id::text as id from work_items where id = $1", [wid]))[0]!.id)).toBe(T.id);
    expect((await seenBy(T.id))[`OP-HER-${RUN}`]).toBe("En elaboración");
  });

  // ───────────────────────── 3. Históricos y backfill ─────────────────────────
  it("históricos sin ID: se ven por nombre INEQUÍVOCO; ambiguos no se ven; el backfill solo vincula lo inequívoco y es idempotente", async () => {
    const { runIdBackfill, executeIdBackfill } = await link();
    const adm = await admin();
    // Ambigüedad real: el nombre comercial de X es el alias de Y.
    const x = await adm.createClient(direccion, { displayName: `AMB ${RUN}`, aliases: [`X alias ${RUN}`], emails: [] });
    const y = await adm.createClient(direccion, { displayName: `Y ${RUN}`, aliases: [`AMB ${RUN}`], emails: [] });
    const hist = async (op: string, cliente: string, estado: string | null = null) => {
      const [r] = await q("insert into production_pedidos (op, cliente, producto, estado, created_by, created_by_sector) values ($1, $2, 'HIST', $3, 'IT', 'PRODUCCION') returning id::text as id", [op, cliente, estado]);
      return String(r!.id);
    };
    ids.hUnique = await hist(`OP-H1-${RUN}`, N_TEST2.toLowerCase());
    ids.hAmb = await hist(`OP-H2-${RUN}`, `amb ${RUN}`);
    ids.hNone = await hist(`OP-H3-${RUN}`, `Cliente que no existe ${RUN}`);
    ids.hWork = await mkWork(N_GENUS, "HIST W", "ENVASADO_MASIVO", { status: "en_curso" });
    await q("update work_items set portal_client_id = null where id = $1", [ids.hWork]);
    // Antes del backfill: el único se ve por nombre; el ambiguo no lo ve NADIE.
    expect(`OP-H1-${RUN}` in (await seenBy(T2.id))).toBe(true);
    for (const c of [x.id, y.id, T.id, T2.id, G.id]) expect(`OP-H2-${RUN}` in (await seenBy(c))).toBe(false);

    const dry = await runIdBackfill({ execute: false });
    expect(dry.executed).toBe(false);
    expect(dry.applied).toEqual({ pedidos: 0, works: 0 });
    expect((await q("select portal_client_id from production_pedidos where id = $1", [ids.hUnique]))[0]!.portal_client_id).toBeNull(); // la vista previa no escribe
    const names = (g: Array<{ name: string }>) => g.map((a) => a.name.toLowerCase());
    expect(names(dry.ambiguous)).toContain(`amb ${RUN.toLowerCase()}`);
    expect(dry.ambiguous.find((a) => a.name.toLowerCase() === `amb ${RUN.toLowerCase()}`)!.clients.map((c) => c.id).sort()).toEqual([x.id, y.id].sort());
    expect(names(dry.unmatched)).toContain(`cliente que no existe ${RUN.toLowerCase()}`);

    // Solo Dirección ejecuta.
    await expect(executeIdBackfill(produccion)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(adm.backfillIdLinks(produccion)).rejects.toMatchObject({ status: 403 });
    const preservedId = await portalIdOf(`OP-ID-${RUN}`); // ya vinculado por ID: no se toca
    const run = await executeIdBackfill(direccion);
    expect(run.applied.pedidos).toBeGreaterThanOrEqual(1);
    expect(String((await q("select portal_client_id::text as id from production_pedidos where id = $1", [ids.hUnique]))[0]!.id)).toBe(T2.id);
    expect(String((await q("select portal_client_id::text as id from work_items where id = $1", [ids.hWork]))[0]!.id)).toBe(G.id);
    expect((await q("select portal_client_id from production_pedidos where id = $1", [ids.hAmb]))[0]!.portal_client_id).toBeNull(); // ambiguo: NO se vincula
    expect((await q("select portal_client_id from production_pedidos where id = $1", [ids.hNone]))[0]!.portal_client_id).toBeNull(); // sin coincidencia: NO se vincula
    expect(await portalIdOf(`OP-ID-${RUN}`)).toBe(preservedId);
    // Idempotente: la segunda corrida no cambia nada.
    const again = await executeIdBackfill(direccion);
    expect(again.applied).toEqual({ pedidos: 0, works: 0 });
    expect(names(again.ambiguous)).toContain(`amb ${RUN.toLowerCase()}`);
    // Auditado.
    expect((await q("select 1 from portal_audit_events where event_type = 'VINCULO_ID_BACKFILL' and actor = $1", [direccion.email])).length).toBeGreaterThanOrEqual(2);
    // El reporte llega al panel de problemas (view=problems).
    const problems = await adm.linkingProblems(produccion);
    expect(names(problems.idLinking.ambiguous)).toContain(`amb ${RUN.toLowerCase()}`);
    expect(names(problems.idLinking.unmatched)).toContain(`cliente que no existe ${RUN.toLowerCase()}`);
    expect(problems.idLinking.executed).toBe(false);
  });

  // ───────────────────────── 4. Aislamiento estricto ─────────────────────────
  it("«GENUS TEST», «GENUS TEST 2» y «GENUS»: ninguno ve pedidos del otro (por ID, por nombre histórico ni por prefijo)", async () => {
    const { findClientWorkIds } = await data();
    const db = (await import("@/lib/db/client")).getDb() as never;
    const svc = await pedidos();
    // Con ID
    for (const [tag, cli, name] of [["T", T, N_TEST], ["T2", T2, N_TEST2], ["G", G, N_GENUS]] as const) {
      const rec = await svc.create(produccion as never, { op: `OP-ISO-${tag}-${RUN}`, cliente: name, producto: `ISO ${tag}`, q: 1, portalClientId: cli.id } as never);
      ids[`isoW${tag}`] = await mkWork(name, `ISO ${tag}`, "ENVASADO_MASIVO", { status: "en_curso", pedido: rec.id });
    }
    // Históricos por nombre (sin ID) con prefijos que NO deben cruzarse.
    for (const [tag, name] of [["hT", N_TEST], ["hT2", N_TEST2], ["hG", N_GENUS]] as const) {
      await q("insert into production_pedidos (op, cliente, producto, created_by, created_by_sector) values ($1, $2, 'HISTISO', 'IT', 'PRODUCCION')", [`OP-ISO-${tag}-${RUN}`, name]);
    }
    const sT = await seenBy(T.id);
    const sT2 = await seenBy(T2.id);
    const sG = await seenBy(G.id);
    const own = (s: Record<string, string>) => Object.keys(s).filter((k) => k.startsWith("OP-ISO-"));
    expect(own(sT).sort()).toEqual([`OP-ISO-T-${RUN}`, `OP-ISO-hT-${RUN}`].sort());
    expect(own(sT2).sort()).toEqual([`OP-ISO-T2-${RUN}`, `OP-ISO-hT2-${RUN}`].sort());
    expect(own(sG).sort()).toEqual([`OP-ISO-G-${RUN}`, `OP-ISO-hG-${RUN}`].sort());
    // Trabajos: cada cliente solo recibe los suyos.
    expect(await findClientWorkIds(db, T.id)).toContain(ids.isoWT);
    for (const [c, mine, others] of [[T.id, ids.isoWT, [ids.isoWT2, ids.isoWG]], [T2.id, ids.isoWT2, [ids.isoWT, ids.isoWG]], [G.id, ids.isoWG, [ids.isoWT, ids.isoWT2]]] as const) {
      const w = await findClientWorkIds(db, c);
      expect(w).toContain(mine);
      for (const o of others) expect(w).not.toContain(o);
    }
    // El payload que viaja al navegador no contiene nada ajeno (ni nombres de producto).
    const raw = JSON.stringify(await payloadOf(T.id));
    expect(raw).not.toContain("ISO T2");
    expect(raw).not.toContain("ISO G");
  });

  it("usuarios y sesiones: el usuario de «GENUS TEST 2» jamás obtiene los pedidos de «GENUS TEST» (ni por usuario, correo ni parámetro)", async () => {
    const { createPortalUser } = await import("@/lib/portal/user-admin-service");
    const uauth = await import("@/lib/portal/user-auth-service");
    const auth = await import("@/lib/portal/auth-service");
    const mk = async (client: { id: string }, uname: string) => {
      const u = await createPortalUser(direccion, { clientId: client.id, username: `${uname}${RUN.toLowerCase()}`, password: "Clave-Segura-IT-2026", email: `${uname}-${RUN.toLowerCase()}@example.test` });
      await q("update portal_users set must_change_password = false where id = $1", [u.id]);
      const r = await uauth.passwordLogin({ username: u.username, password: "Clave-Segura-IT-2026", headers: new Headers({ "x-forwarded-for": "203.0.113.77", "user-agent": "vitest" }) });
      if (!r.ok) throw new Error("login");
      return (await auth.resolvePortalSession(r.token))!;
    };
    const sT = await mk(T, "genustest");
    const sT2 = await mk(T2, "genustest2");
    expect(sT.clientId).toBe(T.id);
    expect(sT2.clientId).toBe(T2.id);
    // El usuario «genustest» NO es prefijo-colisionable con «genustest2»: cada sesión resuelve a su propio cliente.
    expect((await seenBy(sT.clientId))[`OP-ISO-T-${RUN}`]).toBeDefined();
    expect((await seenBy(sT2.clientId))[`OP-ISO-T-${RUN}`]).toBeUndefined();
    expect(await auth.resolvePortalSession("token-ajeno-que-no-existe")).toBeNull();
  });

  // ───────────────────────── 5. Tiempo real: firma, sectores y cancelación ─────────────────────────
  it("pedido nuevo → la firma (ETag) cambia aunque no tenga trabajos; cada paso de sector vuelve a cambiarla; cancelar también", async () => {
    const svc = await pedidos();
    const e0 = await etag(T.id);
    const rec = await svc.create(produccion as never, { op: `OP-LIVE-${RUN}`, fecha: "2039-05-03", cliente: N_TEST, producto: "SHAMPOO LIVE", q: 500, portalClientId: T.id } as never);
    const e1 = await etag(T.id);
    expect(e1).not.toBe(e0); // pedido recién asignado, SIN trabajos: ya cambia la firma
    expect((await seenBy(T.id))[`OP-LIVE-${RUN}`]).toBe("Pedido recibido");
    const p1 = (await payloadOf(T.id)).products.find((p) => p.orderRef === `OP-LIVE-${RUN}`)!;
    expect(p1.product).toBe("SHAMPOO LIVE");
    // Programado (trabajo pendiente en elaboración)
    ids.wLive = await mkWork(N_TEST, "SHAMPOO LIVE", "ELABORACION", { status: "pendiente", pedido: rec.id, qty: "500" });
    const e2 = await etag(T.id);
    expect((await seenBy(T.id))[`OP-LIVE-${RUN}`]).toBe("Pedido programado");
    // Elaboración en curso
    await q("update work_items set operational_status = 'en_curso' where id = $1", [ids.wLive]);
    const e3 = await etag(T.id);
    expect((await seenBy(T.id))[`OP-LIVE-${RUN}`]).toBe("En elaboración");
    // Envasado
    await moveTo("ENVASADO_MASIVO", [ids.wLive]);
    await q("update work_items set progress_updated_at = now() where id = $1", [ids.wLive]);
    const e4 = await etag(T.id);
    expect((await seenBy(T.id))[`OP-LIVE-${RUN}`]).toBe("En envasado");
    // Listo para entregar (confirmación explícita del último sector)
    await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [ids.wLive]);
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    await markReadyForDelivery(envasado as never, { workItemId: ids.wLive, idempotencyKey: `it-pv-${RUN}-live` });
    const e5 = await etag(T.id);
    expect((await seenBy(T.id))[`OP-LIVE-${RUN}`]).toBe("Listo para entregar");
    expect(new Set([e0, e1, e2, e3, e4, e5]).size).toBe(6); // cada movimiento cambia la firma
    // Otro cliente no ve cambios ni su firma se altera por movimientos ajenos.
    const t2Before = await etag(T2.id);
    await moveTo("ELABORACION", [ids.wLive]);
    expect(await etag(T2.id)).toBe(t2Before);
    // Cancelación: pedido cancelado visible como tal, nunca como activo.
    await q("update work_items set operational_status = 'cancelado', operational_cancelled_at = now() where id = $1", [ids.wLive]);
    expect((await seenBy(T.id))[`OP-LIVE-${RUN}`]).toBe("Cancelado");
    const cancelled = (await payloadOf(T.id)).orders.find((o) => o.orderRef === `OP-LIVE-${RUN}`)!;
    expect(cancelled.cancelled).toBe(true);
  });

  // ───────────────────────── 6. Push: misma asociación por ID ─────────────────────────
  it("push (simulado, envío general APAGADO, piloto): «Pedido recibido» y cada cambio de sector generan UN evento; sin duplicados ni cruces", async () => {
    const s = await push();
    await s.updatePushSettings(direccion, { globalSendEnabled: false });
    await s.setClientPilot(direccion, T.id, true); // baseline: lo existente no genera avisos retroactivos
    await s.setClientPilot(direccion, T2.id, true);
    const svc = await pedidos();
    const send = sender();
    const run = () => s.runPushWorker({ sender: send, vapid: VAPID });
    await run();
    const base = (await outboxOf(T.id)).length;

    // 1) Pedido recién asignado desde Producción (formulario, por ID) → «Pedido recibido»
    const rec = await svc.create(produccion as never, { op: `OP-PUSH-${RUN}`, cliente: N_TEST, producto: "TONICO PUSH", q: 100, portalClientId: T.id } as never);
    await Promise.all([run(), run(), run()]);
    let rows = await outboxOf(T.id, `OP-PUSH-${RUN}`);
    expect(rows).toEqual([expect.objectContaining({ event_type: "RECIBIDO", status: "SIMULADA", mode: "SIMULADO" })]);
    // 2) Elaboración
    ids.wPush = await mkWork(N_TEST, "TONICO PUSH", "ELABORACION", { status: "en_curso", pedido: rec.id, qty: "100" });
    await run();
    // 3) Envasado
    await moveTo("ENVASADO_MASIVO", [ids.wPush]);
    await run();
    await run();
    rows = await outboxOf(T.id, `OP-PUSH-${RUN}`);
    expect(rows.map((r) => r.event_type)).toEqual(["RECIBIDO", "ELABORACION", "ENVASADO"]);
    expect(rows.every((r) => r.status === "SIMULADA" && r.mode === "SIMULADO")).toBe(true);
    // 4) Listo (confirmación explícita)
    await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [ids.wPush]);
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    await markReadyForDelivery(envasado as never, { workItemId: ids.wPush, idempotencyKey: `it-pv-${RUN}-push` });
    await run();
    rows = await outboxOf(T.id, `OP-PUSH-${RUN}`);
    expect(rows.map((r) => r.event_type)).toEqual(["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"]);
    expect((await outboxOf(T.id)).length).toBeGreaterThan(base);
    // Sin duplicados y 0 envíos reales.
    const dup = await q("select count(*)::int as n from (select 1 from portal_push_outbox group by client_id, order_key, event_type, product_key having count(*) > 1) d");
    expect(dup[0]!.n).toBe(0);
    expect(send).not.toHaveBeenCalled();
    // Aislamiento: «GENUS TEST 2» (también en piloto) no recibe NADA de los pedidos de «GENUS TEST».
    expect(await outboxOf(T2.id, `OP-PUSH-${RUN}`)).toEqual([]);
    expect((await outboxOf(T2.id)).filter((r) => String(r.order_ref).includes("-T-") || String(r.order_ref).includes("OP-PUSH"))).toEqual([]);
  }, 120_000);
});
