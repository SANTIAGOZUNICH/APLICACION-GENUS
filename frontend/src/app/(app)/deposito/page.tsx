import type { Metadata } from "next";
import { ActionableWorkspaceView } from "@/components/patterns/actions/actionable-workspace-view";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { depositoWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Depósito",
};

export default function DepositoPage() {
  return (
    <>
      <MockRoleSwitcher />
      <ActionableWorkspaceView config={depositoWorkspace} />
    </>
  );
}
