import type { Metadata } from "next";
import { WorkspaceView } from "@/components/patterns/workspace";
import { dtWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Dirección Técnica",
};

export default function DtPage() {
  return <WorkspaceView config={dtWorkspace} />;
}
