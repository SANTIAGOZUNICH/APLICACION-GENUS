import { EntityCard } from "@/components/cards/entity-card";
import type { TaskCardProps } from "@/types/ui/task-card";

/**
 * TaskCard — standard work card grammar for Bandeja and Object Page headers.
 * Delegates layout to EntityCard; domain cards add GMP-specific fields.
 */
export function TaskCard(props: TaskCardProps) {
  return <EntityCard {...props} />;
}
