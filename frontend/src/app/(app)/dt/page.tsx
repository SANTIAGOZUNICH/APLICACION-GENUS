import type { Metadata } from "next";
import { ActionableWorkspaceView } from "@/components/patterns/actions/actionable-workspace-view";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { dtWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Dirección Técnica",
};

export default function DtPage() {
  return (
    <>
      <MockRoleSwitcher />
      <ActionableWorkspaceView config={dtWorkspace} />
    </>
  );
}
