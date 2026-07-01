import type { Metadata } from "next";
import { WorkspaceView } from "@/components/patterns/workspace";
import { depositoWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Depósito",
};

export default function DepositoPage() {
  return <WorkspaceView config={depositoWorkspace} />;
}
