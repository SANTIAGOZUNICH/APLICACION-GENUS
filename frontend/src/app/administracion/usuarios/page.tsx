import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AdminUsersPanel } from "@/features/os/admin/admin-users-panel";
import { getAuthService } from "@/lib/auth/get-auth-service";
import { isSuperadminEmail, isSuperadminEmailConfigured } from "@/lib/auth/superadmin";
import { OPERATIONAL_SECTOR_IDS, SECTOR_LABELS } from "@/types/operational/sector";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Administración de usuarios",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  other: {
    "Cache-Control": "no-store",
  },
};

async function assertSuperadminPageAccess(): Promise<void> {
  if (!isSuperadminEmailConfigured()) notFound();
  const jar = await cookies();
  const token = jar.get("genus_session")?.value;
  if (!token) notFound();
  const actor = await getAuthService().resolveSession(token);
  if (!actor || !isSuperadminEmail(actor.email)) notFound();
}

export default async function AdministracionUsuariosPage() {
  await assertSuperadminPageAccess();

  const sectors = OPERATIONAL_SECTOR_IDS.map((id) => ({
    id,
    label: SECTOR_LABELS[id],
  }));

  return (
    <main className="design-preview-root min-h-screen px-4 py-6 md:px-8">
      <AdminUsersPanel sectors={sectors} />
    </main>
  );
}
