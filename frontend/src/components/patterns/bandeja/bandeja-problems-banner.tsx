import { Alert } from "@/components/ui/alert";
import type { BandejaTask } from "@/types/bandeja/bandeja-task";

export interface BandejaProblemsBannerProps {
  problems: BandejaTask[];
}

export function BandejaProblemsBanner({ problems }: BandejaProblemsBannerProps) {
  if (problems.length === 0) return null;

  const count = problems.length;
  const label =
    count === 1
      ? "1 problema requiere tu atención"
      : `${count} problemas requieren tu atención`;

  return (
    <Alert variant="problem" title={label}>
      Revisá la sección Problemas — lo bloqueante y lo por vencer aparecen primero.
    </Alert>
  );
}
