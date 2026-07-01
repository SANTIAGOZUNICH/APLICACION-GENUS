"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/config/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

interface SidebarNavItemProps {
  item: NavItem;
  collapsed?: boolean;
}

export function SidebarNavItem({ item, collapsed = false }: SidebarNavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === item.href;
  const Icon = item.icon;

  const content = (
    <>
      <Icon
        className={cn(
          "size-[18px] shrink-0",
          isActive ? "text-[var(--color-action)]" : "text-[var(--muted-foreground)]"
        )}
        strokeWidth={isActive ? 2.25 : 2}
      />
      {!collapsed && (
        <span
          className={cn(
            "truncate text-[13px] font-medium",
            isActive ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
          )}
        >
          {item.label}
        </span>
      )}
    </>
  );

  const baseClass = cn(
    "group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 transition-colors",
    collapsed && "justify-center px-0",
    isActive && "bg-[var(--sidebar-item-active-bg)]",
    item.enabled && !isActive && "hover:bg-[var(--sidebar-item-hover)]",
    !item.enabled && "cursor-not-allowed opacity-40"
  );

  const activeBorder = isActive && (
    <span
      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--sidebar-item-active-border)]"
      aria-hidden
    />
  );

  if (!item.enabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={baseClass} aria-disabled="true">
            {activeBorder}
            {content}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">Próximamente</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href={item.href} className={baseClass} aria-current={isActive ? "page" : undefined}>
      {activeBorder}
      {content}
    </Link>
  );
}
