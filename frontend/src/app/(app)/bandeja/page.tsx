import type { Metadata } from "next";
import { PageHeader } from "@/components/layouts/page-header";
import { ActionableBandejaView } from "@/components/patterns/actions/actionable-bandeja-view";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { mockUser } from "@/mocks/user.mock";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Mi Trabajo",
};

export default function BandejaPage() {
  return (
    <>
      <PageHeader
        title="Mi Trabajo"
        description={`${siteConfig.tagline} · ${mockUser.role}`}
      />
      <MockRoleSwitcher />
      <ActionableBandejaView />
    </>
  );
}
