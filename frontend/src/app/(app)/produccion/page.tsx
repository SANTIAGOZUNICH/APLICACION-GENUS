import type { Metadata } from "next";
import { ActionableWorkspaceView } from "@/components/patterns/actions/actionable-workspace-view";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { produccionWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Producción",
};

export default function ProduccionPage() {
  return (
    <>
      <MockRoleSwitcher />
      <ActionableWorkspaceView config={produccionWorkspace} />
    </>
  );
}
