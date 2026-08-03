import type { LifecycleAction } from "@/lib/lifecycle";
import type { LifecycleMenuItem } from "./lifecycle-actions-menu";

/** Ítem de menú sintético para confirmación con motivo (sin policy server-side). */
export function syntheticLifecycleItem(
  action: LifecycleAction,
  label: string,
  reason: string
): LifecycleMenuItem {
  return {
    action,
    label,
    decision: {
      action,
      allowed: true,
      requireReason: true,
      requireDoubleConfirm: false,
      reason,
    },
  };
}
