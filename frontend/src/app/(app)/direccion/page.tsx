import type { Metadata } from "next";
import { WorkspaceView } from "@/components/patterns/workspace";
import { direccionWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Dirección",
};

export default function DireccionPage() {
  return <WorkspaceView config={direccionWorkspace} />;
}
