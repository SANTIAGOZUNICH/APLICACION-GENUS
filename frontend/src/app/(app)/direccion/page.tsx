import type { Metadata } from "next";
import { ActionableWorkspaceView } from "@/components/patterns/actions/actionable-workspace-view";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { direccionWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Dirección",
};

export default function DireccionPage() {
  return (
    <>
      <MockRoleSwitcher />
      <ActionableWorkspaceView config={direccionWorkspace} />
    </>
  );
}
