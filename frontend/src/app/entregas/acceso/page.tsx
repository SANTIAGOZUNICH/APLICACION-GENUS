import { LinkLanding } from "@/features/portal/link-landing";

export const dynamic = "force-dynamic";

export default async function Acceso({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const t = (await searchParams).t;
  return <LinkLanding token={typeof t === "string" ? t : ""} />;
}
