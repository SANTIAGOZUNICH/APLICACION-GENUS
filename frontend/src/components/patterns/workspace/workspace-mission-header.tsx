import { PageHeader } from "@/components/layouts/page-header";

export interface WorkspaceMissionHeaderProps {
  title: string;
  mission: string;
}

export function WorkspaceMissionHeader({
  title,
  mission,
}: WorkspaceMissionHeaderProps) {
  return <PageHeader title={title} description={mission} />;
}
