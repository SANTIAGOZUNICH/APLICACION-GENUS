import type { Metadata } from "next";
import { ActionableWorkspaceView } from "@/components/patterns/actions/actionable-workspace-view";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { calidadWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Calidad",
};

export default function CalidadPage() {
  return (
    <>
      <MockRoleSwitcher />
      <ActionableWorkspaceView config={calidadWorkspace} />
    </>
  );
}
