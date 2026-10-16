import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ClientPayload } from "@/features/portal/dashboard";
import { ProductDetail } from "@/features/portal/product-detail";
import { resolvePortalSession } from "@/lib/portal/auth-service";
import { PORTAL_COOKIE_NAME, portalContact } from "@/lib/portal/config";
import { listNotifications, loadPortalOverview } from "@/lib/portal/data-service";
import { toClientPayload } from "@/lib/portal/overview";

export const dynamic = "force-dynamic";

export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(PORTAL_COOKIE_NAME)?.value ?? null;
  const session = await resolvePortalSession(token && /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null).catch(() => null);
  // Redirect relativo: nunca expone el host interno cuando el portal se sirve detrás del dominio institucional.
  if (!session) redirect("/entregas");
  const { overview } = await loadPortalOverview(session.clientId);
  const initial: ClientPayload = { ...toClientPayload(overview), client: { name: session.clientName, code: session.publicCode }, notifications: await listNotifications(session.clientId) };
  const c = portalContact();
  return <ProductDetail initial={initial} productId={id} contact={{ email: c.email, whatsappUrl: c.whatsappUrl, whatsappLabel: c.whatsappLabel }} />;
}
