"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "../theme-toggle";

interface TopbarProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export function Topbar({
  title,
  subtitle,
  onMenuClick,
  showMenuButton = false,
}: TopbarProps) {
  return (
    <header
      className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:px-6"
      role="banner"
    >
      <div className="flex min-w-0 items-center gap-3">
        {showMenuButton && (
          <Button
            variant="secondary"
            size="sm"
            className="w-9 px-0 lg:hidden"
            onClick={onMenuClick}
            aria-label="Abrir menú"
          >
            <Menu className="size-4" />
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-[var(--foreground)] lg:hidden">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-[var(--muted-foreground)] lg:hidden">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 lg:hidden">
        <ThemeToggle />
      </div>
    </header>
  );
}
