import type { Metadata } from "next";
import { WorkspaceView } from "@/components/patterns/workspace";
import { produccionWorkspace } from "@/config/workspaces";

export const metadata: Metadata = {
  title: "Producción",
};

export default function ProduccionPage() {
  return <WorkspaceView config={produccionWorkspace} />;
}
