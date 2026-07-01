import type { Metadata } from "next";
import { WorkspaceView } from "@/components/patterns/workspace";
import { comercialWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Comercial",
};

export default function ComercialPage() {
  return <WorkspaceView config={comercialWorkspace} />;
}
