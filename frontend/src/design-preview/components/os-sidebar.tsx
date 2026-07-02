"use client";

import {
  Briefcase,
  Calendar,
  Factory,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Package,
  Search,
  Settings,
  Shield,
} from "lucide-react";
import { OS_NAV_ITEMS, OS_NAV_RESTRICTED } from "@/design-preview/config";

const ICONS = {
  briefcase: Briefcase,
  calendar: Calendar,
  search: Search,
  package: Package,
  shield: Shield,
  settings: Settings,
  factory: Factory,
  layout: LayoutDashboard,
} as const;

interface OsSidebarProps {
  sectorLabel: string;
  sectorEmail: string;
  activeNav?: string;
  showRestricted?: boolean;
}

/** F9.1 — Sidebar mínima. Creamy AI abajo, compañera del sistema. */
export function OsSidebar({
  sectorLabel,
  sectorEmail,
  activeNav = "mi-trabajo",
  showRestricted = false,
}: OsSidebarProps) {
  return (
    <aside
      className="flex h-full shrink-0 flex-col bg-[var(--os-sidebar-bg)] text-[var(--os-sidebar-text)]"
      style={{ width: "var(--os-sidebar-width)" }}
    >
      <div className="px-5 py-6">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-5 text-[var(--os-teal)]" aria-hidden="true" />
          <p className="text-sm font-semibold">GENUS OS</p>
        </div>
      </div>

      <div className="mx-4 rounded-[var(--os-radius-sm)] border border-white/10 px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <p className="text-sm font-medium">{sectorLabel}</p>
        </div>
      </div>

      <nav className="mt-5 flex-1 space-y-0.5 px-3" aria-label="Menú">
        {OS_NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.icon];
          const active = activeNav === item.id;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-[var(--os-radius-sm)] px-3 py-2.5 text-sm ${
                active
                  ? "bg-[var(--os-teal-muted)] font-medium text-white"
                  : "text-[var(--os-sidebar-muted)]"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </div>
          );
        })}
        {showRestricted &&
          OS_NAV_RESTRICTED.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-[var(--os-radius-sm)] px-3 py-2.5 text-sm text-[var(--os-sidebar-muted)]"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </div>
            );
          })}
      </nav>

      <div className="mt-auto border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-[var(--os-teal)] text-[10px] font-bold text-white">
            {sectorEmail.slice(0, 2).toUpperCase()}
          </div>
          <p className="truncate text-xs text-[var(--os-sidebar-muted)]">{sectorEmail}</p>
        </div>

        <div className="mt-4 rounded-[var(--os-radius-sm)] border border-white/10 bg-white/5 p-3">
          <p className="text-sm font-medium">Creamy AI</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--os-sidebar-muted)]">
            ¿Necesitás ayuda con este trabajo?
          </p>
          <button
            type="button"
            className="mt-3 w-full rounded-[var(--os-radius-sm)] border border-white/20 py-2 text-xs text-[var(--os-sidebar-text)]"
          >
            Abrir
          </button>
        </div>

        <button
          type="button"
          className="mt-3 flex w-full items-center gap-2 px-1 py-2 text-xs text-[var(--os-sidebar-muted)]"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
