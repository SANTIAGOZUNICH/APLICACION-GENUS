import type { OsNotificationRecord } from "@/lib/orders/types";

/** Claves estables para tombstone por usuario (no regenerar el mismo evento). */
export function notificationEventKeys(
  n: Pick<OsNotificationRecord, "id" | "kind" | "title" | "message" | "href" | "orderId">
): string[] {
  const keys = [`id:${n.id}`];
  if (n.href?.trim()) keys.push(`href:${n.href.trim()}`);
  if (n.orderId) keys.push(`order:${n.kind}:${n.orderId}`);
  keys.push(
    `fp:${n.kind}|${n.title.trim().toLowerCase()}|${n.message.trim().toLowerCase().slice(0, 120)}`
  );
  return [...new Set(keys)];
}

export function localNotificationFingerprint(input: {
  kind: string;
  title: string;
  message: string;
}): string {
  return `fp:${input.kind}|${input.title.trim().toLowerCase()}|${input.message.trim().toLowerCase().slice(0, 120)}`;
}
