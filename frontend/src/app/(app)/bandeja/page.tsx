import type { Metadata } from "next";
import { PageHeader } from "@/components/layouts/page-header";
import { BandejaView } from "@/components/patterns/bandeja";
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
      <BandejaView />
    </>
  );
}
