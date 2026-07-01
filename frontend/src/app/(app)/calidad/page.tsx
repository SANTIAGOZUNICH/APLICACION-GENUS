import type { Metadata } from "next";
import { WorkspaceView } from "@/components/patterns/workspace";
import { calidadWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Calidad",
};

export default function CalidadPage() {
  return <WorkspaceView config={calidadWorkspace} />;
}
