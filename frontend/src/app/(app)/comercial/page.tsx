import type { Metadata } from "next";
import { ActionableWorkspaceView } from "@/components/patterns/actions/actionable-workspace-view";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { comercialWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Comercial",
};

export default function ComercialPage() {
  return (
    <>
      <MockRoleSwitcher />
      <ActionableWorkspaceView config={comercialWorkspace} />
    </>
  );
}
