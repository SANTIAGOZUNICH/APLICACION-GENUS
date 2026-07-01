import { mockUser } from "@/mocks/user.mock";
import { ThemeToggle } from "../theme-toggle";
import { cn } from "@/lib/utils/cn";

interface SidebarFooterProps {
  collapsed?: boolean;
}

export function SidebarFooter({ collapsed = false }: SidebarFooterProps) {
  return (
    <div
      className={cn(
        "mt-auto border-t border-[var(--sidebar-border)] p-3",
        collapsed && "flex flex-col items-center gap-2 px-2"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3",
          collapsed && "flex-col gap-2"
        )}
      >
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-action)] text-xs font-semibold text-white"
          aria-hidden
        >
          {mockUser.initials}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">
              {mockUser.name}
            </p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {mockUser.role}
            </p>
          </div>
        )}
        <ThemeToggle showLabel={!collapsed} />
      </div>
    </div>
  );
}
