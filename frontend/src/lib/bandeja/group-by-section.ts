import { sortByUrgency } from "@/lib/bandeja/prioritize";
import {
  BANDEJA_SECTIONS,
  type BandejaSectionId,
} from "@/types/bandeja/bandeja-section";
import type { BandejaTask } from "@/types/bandeja/bandeja-task";

export interface BandejaSectionGroup {
  id: BandejaSectionId;
  label: string;
  description: string;
  defaultCollapsed: boolean;
  alwaysExpanded?: boolean;
  tasks: BandejaTask[];
}

export function groupTasksBySection(tasks: BandejaTask[]): BandejaSectionGroup[] {
  return BANDEJA_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    description: section.description,
    defaultCollapsed: section.defaultCollapsed,
    alwaysExpanded: section.alwaysExpanded,
    tasks: sortByUrgency(tasks.filter((task) => task.sectionId === section.id)),
  }));
}
