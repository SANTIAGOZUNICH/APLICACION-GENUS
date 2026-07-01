import { AppShell } from "@/components/layouts/app-shell";
import { AppProviders } from "@/providers/app-providers";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
