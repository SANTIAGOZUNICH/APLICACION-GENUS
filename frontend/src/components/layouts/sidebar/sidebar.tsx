"use client";

import { SidebarBrand } from "./sidebar-brand";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarNav } from "./sidebar-nav";
import { cn } from "@/lib/utils/cn";

interface SidebarProps {
  collapsed?: boolean;
  className?: string;
}

export function Sidebar({ collapsed = false, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]",
        collapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]",
        className
      )}
      aria-label="Navegación principal"
    >
      <SidebarBrand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} />
      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}
