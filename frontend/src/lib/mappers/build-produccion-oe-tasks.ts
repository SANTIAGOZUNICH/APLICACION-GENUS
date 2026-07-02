import type { OeListItem } from "@/lib/adapters/drive/types/document.types";
import { buildOeIndexCardData } from "@/lib/mappers/oe-index-display";
import {
  resolveProduccionSectionId,
  sortOesByRecency,
} from "@/lib/mappers/oe-section-utils";
import { BandejaEntityType } from "@/types/bandeja/bandeja-task";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";
import type { WorkspaceId } from "@/types/actions";

const MAX_OES = 200;

/** E7.2 — honest produccion tasks from ELABORACION index only. */
export function buildProduccionOeTasks(oes: OeListItem[]): WorkspaceTask[] {
  const tasks: WorkspaceTask[] = [];

  sortOesByRecency(oes).slice(0, MAX_OES).forEach((entry, index) => {
    const card = buildOeIndexCardData(entry);
    const sectionId = resolveProduccionSectionId(entry);

    tasks.push({
      id: `prod-oe-${entry.fileId}`,
      sectionId,
      urgencyScore: 1000 - index,
      payload: {
        entityType: BandejaEntityType.OE_INDEX,
        data: {
          oeId: card.oeId,
          title: card.title,
          producto: card.producto,
          cliente: card.cliente,
          folderLabel: card.folderLabel,
          modifiedLabel: card.modifiedLabel,
          status: card.status,
          statusLabel: card.statusLabel,
          href: card.href,
          primaryAction: { label: "Abrir ficha", href: card.href },
        },
      },
    });
  });

  return tasks;
}

export function buildE72WorkspaceTasks(
  oes: OeListItem[]
): Record<WorkspaceId, WorkspaceTask[]> {
  return {
    produccion: buildProduccionOeTasks(oes),
    calidad: [],
    comercial: [],
    deposito: [],
    direccion: [],
    dt: [],
  };
}
