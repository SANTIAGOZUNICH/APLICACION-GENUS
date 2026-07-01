"use client";

import { RoleIds, type RoleId } from "@/types/actions";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { cn } from "@/lib/utils/cn";

const ROLES: { id: RoleId; label: string }[] = [
  { id: RoleIds.SU, label: "Supervisor" },
  { id: RoleIds.OP, label: "Operario" },
  { id: RoleIds.CA, label: "Calidad" },
  { id: RoleIds.DT, label: "DT" },
];

/** Mock role switcher — simulates RBAC lens until backend integration. */
export function MockRoleSwitcher() {
  const { roleId, setRoleId } = useOperationsStore();

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2"
      role="group"
      aria-label="Rol mock"
    >
      <span
        className="text-[var(--muted-foreground)]"
        style={{ fontSize: "var(--text-caption)" }}
      >
        Rol:
      </span>
      {ROLES.map((role) => (
        <button
          key={role.id}
          type="button"
          onClick={() => setRoleId(role.id)}
          className={cn(
            "rounded-full px-2.5 py-1 font-medium transition-colors",
            roleId === role.id
              ? "bg-[var(--color-action)]/10 text-[var(--color-action)] ring-1 ring-[var(--color-action)]/30"
              : "text-[var(--muted-foreground)] hover:bg-[var(--sidebar-item-hover)]"
          )}
          style={{ fontSize: "var(--text-caption)" }}
        >
          {role.label}
        </button>
      ))}
    </div>
  );
}
