import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";

interface SidebarBrandProps {
  collapsed?: boolean;
}

export function SidebarBrand({ collapsed = false }: SidebarBrandProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-3 py-4",
        collapsed && "justify-center px-0"
      )}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)] text-sm font-bold text-white"
        aria-hidden
      >
        G
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
            {siteConfig.name}
          </p>
          <p className="truncate text-[11px] text-[var(--muted-foreground)]">
            Operaciones
          </p>
        </div>
      )}
    </div>
  );
}
