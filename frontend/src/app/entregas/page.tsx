import { cookies } from "next/headers";
import { Dashboard, type ClientPayload } from "@/features/portal/dashboard";
import { LoginForm } from "@/features/portal/login-form";
import { resolvePortalSession } from "@/lib/portal/auth-service";
import { portalContact } from "@/lib/portal/config";
import { listNotifications, loadPortalOverview } from "@/lib/portal/data-service";
import { PORTAL_COOKIE_NAME } from "@/lib/portal/config";
import { DEMO_COOKIE_NAME } from "@/lib/portal/cookies";
import { demoPayload, resolveDemoSession } from "@/lib/portal/demo-service";
import { toClientPayload } from "@/lib/portal/overview";
import { isDatabaseConfigured } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  if (!isDatabaseConfigured()) return <LoginForm />;
  const jar = await cookies();
  const demoToken = jar.get(DEMO_COOKIE_NAME)?.value ?? null;
  const demo = await resolveDemoSession(demoToken && /^[A-Za-z0-9_-]{20,200}$/.test(demoToken) ? demoToken : null).catch(() => null);
  if (demo) {
    const c = portalContact();
    return <Dashboard initial={(await demoPayload(demo)) as ClientPayload} contact={{ email: c.email, whatsappUrl: c.whatsappUrl, whatsappLabel: c.whatsappLabel }} />;
  }
  const token = jar.get(PORTAL_COOKIE_NAME)?.value ?? null;
  const session = await resolvePortalSession(token && /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null).catch(() => null);
  if (!session) return <LoginForm />;
  const { overview } = await loadPortalOverview(session.clientId);
  const initial: ClientPayload = { ...toClientPayload(overview), client: { name: session.clientName, code: session.publicCode }, notifications: await listNotifications(session.clientId) };
  const c = portalContact();
  return <Dashboard initial={initial} contact={{ email: c.email, whatsappUrl: c.whatsappUrl, whatsappLabel: c.whatsappLabel }} />;
}
