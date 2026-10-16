/**
 * Modo demostración del Portal de Clientes contra un Postgres de PRUEBA real: permisos (solo Producción/Dirección), token de
 * un solo uso con vencimiento y solo hash en base, sesión demo con vencimiento, aislamiento total de GENUS OS (ningún cambio
 * en tablas reales ni avisos reales), confirmación simulada y que el acceso normal de clientes no se altera.
 * NO envía correos. Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = randomUUID().slice(0, 6).toUpperCase();
const prod = { email: `demo-prod-${RUN.toLowerCase()}@laboratoriogenus.com.ar`, sector: "PRODUCCION" };
const dir = { email: `demo-dir-${RUN.toLowerCase()}@laboratoriogenus.com.ar`, sector: "DIRECCION" };
const operario = { email: `demo-op-${RUN.toLowerCase()}@laboratoriogenus.com.ar`, sector: "ENVASADO_MASIVO" };
const REAL_NAME = `REAL SECRETO ${RUN}`;
const hdr = (ip = "203.0.113.50") => new Headers({ "x-forwarded-for": ip, "user-agent": "vitest" });
const tokenOf = (url: string) => new URL(url).hash.replace(/^#t=/, "");

describe.skipIf(Boolean(PROBLEM))(`Modo demostración del portal en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const demo = () => import("@/lib/portal/demo-service");
  const sent: Array<{ to: string; text: string }> = [];
  let realClient = { id: "", code: "" };

  /** Huella de TODO lo real: si la demo toca algo, cambia. */
  const fingerprint = async () =>
    JSON.stringify(await Promise.all([
      q("select count(*)::int n from portal_clients"),
      q("select count(*)::int n from portal_receipt_confirmations"),
      q("select count(*)::int n from portal_notifications"),
      q("select count(*)::int n from portal_email_outbox"),
      q("select count(*)::int n from portal_authorized_emails"),
      q("select id, operational_status, completed_at, planned_quantity from work_items order by id"),
      q("select id, status, quantity from work_item_deliveries order by id"),
      q("select id, status, quantity from work_item_delivery_lines order by id"),
      q("select count(*)::int n, coalesce(sum(quantity),0)::float s from mp_stock_movements"),
      q("select codigo, stock_actual from mp_stock_balances order by codigo"),
      q("select count(*)::int n from os_notifications"),
      q("select count(*)::int n from production_pedidos"),
    ]));

  async function openSession(staff = prod, ip = "203.0.113.50") {
    const d = await demo();
    const { url } = await d.createDemoToken(staff);
    const token = tokenOf(url);
    const r = await d.redeemDemoToken({ token, headers: hdr(ip) });
    if (!r.ok) throw new Error(`no se pudo canjear: ${r.reason}`);
    const session = (await d.resolveDemoSession(r.sessionToken))!;
    return { token, sessionToken: r.sessionToken, session, url };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-demo-secret-".padEnd(40, "x");
    process.env.PORTAL_PUBLIC_BASE_URL = "https://www.laboratoriogenus.com.ar/entregas";
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { setEmailTransportForTests } = await import("@/lib/portal/email");
    setEmailTransportForTests(async (m) => {
      sent.push({ to: m.to, text: m.text });
      return { status: "ENVIADO", provider: "test", providerMessageId: "it" };
    });
    // Un cliente REAL con un pedido real: la demostración jamás debe mostrarlo ni tocarlo.
    const adm = await import("@/lib/portal/admin-service");
    const c = await adm.createClient({ email: "it@x.y", sector: "PRODUCCION" }, { displayName: REAL_NAME, aliases: [REAL_NAME], emails: [`real-${RUN.toLowerCase()}@cliente.test`] });
    realClient = { id: c.id, code: c.publicCode };
    await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1,'PRODUCTO REAL SECRETO',$2,'EN_PROCESO','IT','PRODUCCION')", [`OP-REAL-${RUN}`, REAL_NAME]);
  }, 120_000);

  afterAll(async () => {
    const { setEmailTransportForTests } = await import("@/lib/portal/email");
    setEmailTransportForTests(null);
    delete process.env.PORTAL_DEMO_ENABLED;
    await pool?.end();
  });

  // ───────────────────────── Permisos y token ─────────────────────────
  it("solo Producción y Dirección pueden pedir el token; otros sectores reciben 403 y no se emite nada", async () => {
    const d = await demo();
    const before = (await q("select count(*)::int n from portal_demo_tokens"))[0]!.n;
    await expect(d.createDemoToken(operario)).rejects.toMatchObject({ status: 403 });
    await expect(d.createDemoToken({ email: "x@y.z", sector: "CALIDAD" })).rejects.toMatchObject({ status: 403 });
    expect((await q("select count(*)::int n from portal_demo_tokens"))[0]!.n).toBe(before);
    await expect(d.createDemoToken(prod)).resolves.toMatchObject({ expiresInSeconds: 120 });
    await expect(d.createDemoToken(dir)).resolves.toMatchObject({ expiresInSeconds: 120 });
  });

  it("la URL lleva el token SOLO en el fragmento (no en la consulta) y en la base solo queda su hash", async () => {
    const d = await demo();
    const { url } = await d.createDemoToken(prod);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.laboratoriogenus.com.ar/entregas/demo");
    expect(u.search).toBe("");
    const token = tokenOf(url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{30,100}$/);
    const dump = JSON.stringify([await q("select * from portal_demo_tokens"), await q("select * from portal_audit_events")]);
    expect(dump).not.toContain(token);
    const [row] = await q("select created_by, created_by_sector, expires_at, consumed_at from portal_demo_tokens order by created_at desc limit 1");
    expect(row).toMatchObject({ created_by: prod.email, created_by_sector: "PRODUCCION", consumed_at: null });
    expect(new Date(String(row!.expires_at)).getTime() - Date.now()).toBeLessThanOrEqual(121_000);
  });

  it("el token es de un solo uso: el segundo canje falla; uno vencido o inventado también", async () => {
    const d = await demo();
    const { url } = await d.createDemoToken(prod);
    const token = tokenOf(url);
    expect((await d.redeemDemoToken({ token, headers: hdr("198.51.100.60") })).ok).toBe(true);
    expect(await d.redeemDemoToken({ token, headers: hdr("198.51.100.60") })).toEqual({ ok: false, reason: "invalid" });
    const expired = tokenOf((await d.createDemoToken(prod)).url);
    await q("update portal_demo_tokens set expires_at = now() - interval '1 second' where consumed_at is null");
    expect(await d.redeemDemoToken({ token: expired, headers: hdr("198.51.100.61") })).toEqual({ ok: false, reason: "invalid" });
    for (const bad of ["", "abc", null, 42, "x".repeat(45), "../../etc/passwd", "' or 1=1 --"]) {
      expect((await d.redeemDemoToken({ token: bad, headers: hdr("198.51.100.62") })).ok).toBe(false);
    }
    const audit = await q("select 1 from portal_audit_events where event_type = 'DEMO_TOKEN_RECHAZADO' limit 1");
    expect(audit.length).toBe(1);
  });

  it("el canje se limita por IP (intentos repetidos)", async () => {
    const d = await demo();
    await q("delete from portal_rate_limits where bucket like 'demo-redeem:%'");
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await d.redeemDemoToken({ token: "a".repeat(40), headers: hdr("192.0.2.200") });
      if (!r.ok && r.reason === "rate_limited") limited = true;
    }
    expect(limited).toBe(true);
    await q("delete from portal_rate_limits where bucket like 'demo-redeem:%'");
  });

  it("interruptor PORTAL_DEMO_ENABLED=0: no se emiten tokens ni se canjean ni hay sesión", async () => {
    const d = await demo();
    const s = await openSession();
    process.env.PORTAL_DEMO_ENABLED = "0";
    try {
      await expect(d.createDemoToken(prod)).rejects.toMatchObject({ status: 403, code: "DEMO_DISABLED" });
      expect(await d.redeemDemoToken({ token: "a".repeat(40), headers: hdr() })).toEqual({ ok: false, reason: "disabled" });
      expect(await d.resolveDemoSession(s.sessionToken)).toBeNull();
    } finally {
      delete process.env.PORTAL_DEMO_ENABLED;
    }
    expect(await d.resolveDemoSession(s.sessionToken)).not.toBeNull();
  });

  // ───────────────────────── Sesión ─────────────────────────
  it("sesión demo: vigente, vence a los 60 min, se cierra con «salir» y no acepta cookies adulteradas", async () => {
    const d = await demo();
    const s = await openSession();
    expect(s.session.createdBy).toBe(prod.email);
    const [row] = await q("select expires_at from portal_demo_sessions where id = $1::uuid", [s.session.id]);
    const ttl = new Date(String(row!.expires_at)).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000 + 1000);
    expect(await d.resolveDemoSession(s.sessionToken + "x")).toBeNull();
    expect(await d.resolveDemoSession("a".repeat(43))).toBeNull();
    expect(await d.resolveDemoSession(null)).toBeNull();
    await q("update portal_demo_sessions set expires_at = now() - interval '1 second' where id = $1::uuid", [s.session.id]);
    expect(await d.resolveDemoSession(s.sessionToken)).toBeNull();
    const s2 = await openSession(prod, "203.0.113.51");
    await d.demoLogout(s2.sessionToken);
    expect(await d.resolveDemoSession(s2.sessionToken)).toBeNull();
    const dump = JSON.stringify(await q("select * from portal_demo_sessions"));
    expect(dump).not.toContain(s2.sessionToken);
  });

  // ───────────────────────── Aislamiento ─────────────────────────
  it("los datos son ficticios: no aparece el cliente real ni su pedido, ni ids ni correos reales", async () => {
    const d = await demo();
    const s = await openSession();
    const p = await d.demoPayload(s.session);
    const json = JSON.stringify(p);
    expect(p.demo).toBe(true);
    expect(p.products).toHaveLength(6);
    expect(json).not.toContain(REAL_NAME);
    expect(json).not.toContain("PRODUCTO REAL SECRETO");
    expect(json).not.toContain(realClient.id);
    expect(json).not.toContain(realClient.code);
    expect(json).not.toContain(`real-${RUN.toLowerCase()}`);
    const byName = (n: string) => p.products.find((x) => x.product === n)!;
    expect(byName("Crema facial hidratante").countdown?.remainingDays).toBe(8);
    expect(byName("Shampoo reparador").countdown?.remainingDays).toBe(3);
  });

  it("abrir la demo, navegarla, confirmar y reiniciar NO cambia nada real (ni tablas ni avisos a Producción)", async () => {
    const d = await demo();
    const before = await fingerprint();
    const s = await openSession(dir, "203.0.113.52");
    const p = await d.demoPayload(s.session);
    const tonico = p.products.find((x) => x.product === "Tónico capilar")!;
    const r = await d.demoConfirmReceipt(s.session, tonico.deliveries[0]!.id);
    expect(r.ok).toBe(true);
    await d.demoReset(s.session);
    await d.demoLogout(s.sessionToken);
    const after = await fingerprint();
    // Solo cambiaron las tablas propias de la demo (que no están en la huella) y la auditoría de la demo.
    expect(after).toBe(before);
    expect(await q("select 1 from os_notifications where kind = 'PORTAL_RECEPCION' and message like '%Tónico capilar%'")).toHaveLength(0);
    expect(await q("select 1 from portal_receipt_confirmations where product = 'Tónico capilar'")).toHaveLength(0);
  });

  // ───────────────────────── Confirmación simulada ─────────────────────────
  it("confirmación simulada: una sola vez, persiste entre recargas, es por sesión y se puede reiniciar", async () => {
    const d = await demo();
    const a = await openSession(prod, "203.0.113.53");
    const b = await openSession(prod, "203.0.113.54");
    const pa = await d.demoPayload(a.session);
    const parcial = pa.products.find((x) => x.product === "Acondicionador nutritivo")!;
    const tonico = pa.products.find((x) => x.product === "Tónico capilar")!;
    expect(tonico.deliveries[0]!.canConfirm).toBe(true);
    expect(await d.demoReceiptPreview(a.session, tonico.deliveries[0]!.id)).toMatchObject({ product: "Tónico capilar", quantity: 800 });
    const ok = await d.demoConfirmReceipt(a.session, tonico.deliveries[0]!.id);
    expect(ok).toMatchObject({ ok: true, confirmation: { product: "Tónico capilar", quantity: 800 } });
    // duplicada
    const reloaded = (await d.resolveDemoSession(a.sessionToken))!;
    expect(await d.demoConfirmReceipt(reloaded, tonico.deliveries[0]!.id)).toEqual({ ok: false, reason: "already_confirmed" });
    // persiste al recargar
    const again = await d.demoPayload(reloaded);
    const t2 = again.products.find((x) => x.product === "Tónico capilar")!;
    expect(t2.deliveries[0]!.canConfirm).toBe(false);
    expect(t2.deliveries[0]!.confirmation).not.toBeNull();
    // la entrega parcial y la ya confirmada no cambian
    expect(again.products.find((x) => x.product === "Acondicionador nutritivo")!.deliveries[0]!.canConfirm).toBe(true);
    // otra sesión no ve la confirmación de esta, y no puede usar ids ajenos
    const pb = await d.demoPayload(b.session);
    expect(pb.products.find((x) => x.product === "Tónico capilar")!.deliveries[0]!.canConfirm).toBe(true);
    expect(await d.demoConfirmReceipt(b.session, tonico.deliveries[0]!.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await d.demoConfirmReceipt(b.session, "f".repeat(24))).toEqual({ ok: false, reason: "not_found" });
    // el parcial también se puede confirmar; reiniciar deja todo como al principio
    expect((await d.demoConfirmReceipt(reloaded, parcial.deliveries[0]!.id)).ok).toBe(true);
    await d.demoReset(reloaded);
    const fresh = await d.demoPayload((await d.resolveDemoSession(a.sessionToken))!);
    expect(fresh.products.find((x) => x.product === "Tónico capilar")!.deliveries[0]!.canConfirm).toBe(true);
    expect(fresh.products.find((x) => x.product === "Acondicionador nutritivo")!.deliveries[0]!.canConfirm).toBe(true);
  });

  // ───────────────────────── El acceso real no cambia ─────────────────────────
  it("el acceso normal de clientes sigue igual y las dos sesiones no se pueden intercambiar", async () => {
    const { requestLoginCode, verifyLoginCode, resolvePortalSession } = await import("@/lib/portal/auth-service");
    const d = await demo();
    await q("delete from portal_rate_limits");
    sent.length = 0;
    const email = `real-${RUN.toLowerCase()}@cliente.test`;
    const r = await requestLoginCode({ code: realClient.code, email, headers: hdr("198.51.100.70") });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") await r.deliver();
    const otp = sent.find((m) => m.to === email)?.text.match(/es: (\d{6})/)?.[1];
    expect(otp).toBeTruthy();
    const v = await verifyLoginCode({ code: realClient.code, email, otp, headers: hdr("198.51.100.70") });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect((await resolvePortalSession(v.token))?.clientId).toBe(realClient.id);
    // el token de un cliente real no es una sesión demo, y el de la demo no es una sesión de cliente real
    expect(await d.resolveDemoSession(v.token)).toBeNull();
    const s = await openSession(prod, "203.0.113.55");
    expect(await resolvePortalSession(s.sessionToken)).toBeNull();
    // el código de cliente demo no existe como cliente real
    const fake = await requestLoginCode({ code: "DEMO", email: "demostracion@genus.demo", headers: hdr("198.51.100.71") });
    expect(fake.status).toBe("accepted");
    expect(await q("select 1 from portal_clients where public_code = 'DEMO'")).toHaveLength(0);
  });

  it("queda auditado quién abrió la demostración", async () => {
    const rows = await q("select event_type, actor_kind, actor from portal_audit_events where event_type in ('DEMO_TOKEN_EMITIDO','DEMO_SESION_INICIADA') order by created_at");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.actor_kind === "STAFF" && typeof r.actor === "string" && String(r.actor).endsWith("@laboratoriogenus.com.ar"))).toBe(true);
  });
});
