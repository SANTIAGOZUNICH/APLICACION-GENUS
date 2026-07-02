import { Factory } from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import type { EntityCardAction, EntityCardVariant } from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

/** Honest OE card from ELABORACION index — no invented operational fields. */
export interface OeIndexCardProps {
  oeId: string;
  title: string;
  producto: string;
  cliente?: string;
  folderLabel: string;
  modifiedLabel: string;
  status: Status;
  statusLabel?: string;
  primaryAction?: EntityCardAction;
  variant?: EntityCardVariant;
  href?: string;
  className?: string;
}

export function OeIndexCard({
  oeId,
  title,
  producto,
  cliente,
  folderLabel,
  modifiedLabel,
  status,
  statusLabel = "Indexada",
  primaryAction,
  variant,
  href,
  className,
}: OeIndexCardProps) {
  return (
    <EntityCard
      entityId={oeId}
      title={title}
      subtitle={cliente ? `Cliente · ${cliente}` : `Producto · ${producto}`}
      status={status}
      statusLabel={statusLabel}
      identityIcon={Factory}
      metadata={[
        { id: "producto", label: "Producto", value: producto },
        ...(cliente ? [{ id: "cliente", label: "Cliente", value: cliente }] : []),
        { id: "carpeta", label: "Carpeta", value: folderLabel },
        { id: "mod", label: "Última modificación", value: modifiedLabel },
        { id: "origen", label: "Origen", value: "Google Drive · ELABORACION" },
      ]}
      primaryAction={primaryAction ?? { label: "Abrir ficha", href }}
      variant={variant}
      href={href}
      className={className}
    />
  );
}
