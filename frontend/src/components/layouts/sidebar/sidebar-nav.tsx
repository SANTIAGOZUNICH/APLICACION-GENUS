"use client";

import { navigationItems } from "@/config/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarNavItem } from "./sidebar-nav-item";

interface SidebarNavProps {
  collapsed?: boolean;
}

export function SidebarNav({ collapsed = false }: SidebarNavProps) {
  const primaryItems = navigationItems.filter((item) => item.section === "primary");
  const secondaryItems = navigationItems.filter((item) => item.section === "secondary");

  return (
    <nav className="flex flex-1 flex-col gap-1 px-2" aria-label="Workspaces">
      <div className="space-y-0.5">
        {primaryItems.map((item) => (
          <SidebarNavItem key={item.id} item={item} collapsed={collapsed} />
        ))}
      </div>

      <Separator className="my-3" />

      <div className="space-y-0.5">
        {secondaryItems.map((item) => (
          <SidebarNavItem key={item.id} item={item} collapsed={collapsed} />
        ))}
      </div>
    </nav>
  );
}
