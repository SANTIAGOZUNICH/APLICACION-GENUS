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
import type { SidebarItemId } from "@/lib/role-engine/types";
import type { CreamyTeaser } from "@/features/os/session/preview-context";

const ICONS = {
  mi_trabajo: Briefcase,
  plan_semanal: Calendar,
  consulta: Search,
  insumos: Package,
  calidad: Shield,
  configuracion: Settings,
  produccion: Factory,
  direccion: LayoutDashboard,
} as const;

const SIDEBAR_LABELS: Record<SidebarItemId, string> = {
  mi_trabajo: "Mi trabajo",
  plan_semanal: "Plan semanal",
  consulta: "Consulta",
  insumos: "Insumos",
  calidad: "Calidad",
  configuracion: "Configuración",
  produccion: "Producción",
  direccion: "Dirección",
};

interface OsSidebarProps {
  sectorLabel: string;
  sectorEmail: string;
  activeNav?: SidebarItemId;
  sidebarItems: SidebarItemId[];
  showRestricted?: boolean;
  creamyTeaser?: CreamyTeaser | null;
  onNav?: (itemId: SidebarItemId) => void;
  onLogout?: () => void;
  onOpenCreamy?: () => void;
}

/** Sidebar operativa — navegación real del Digital Twin. */
export function OsSidebar({
  sectorLabel,
  sectorEmail,
  activeNav = "mi_trabajo",
  sidebarItems,
  creamyTeaser,
  onNav,
  onLogout,
  onOpenCreamy,
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
        {sidebarItems.map((itemId) => {
          const Icon = ICONS[itemId];
          const active = activeNav === itemId;
          return (
            <button
              key={itemId}
              type="button"
              onClick={() => onNav?.(itemId)}
              className={`flex w-full items-center gap-3 rounded-[var(--os-radius-sm)] px-3 py-2.5 text-left text-sm transition-colors ${
                active
                  ? "bg-[var(--os-teal-muted)] font-medium text-white"
                  : "text-[var(--os-sidebar-muted)] hover:bg-[var(--os-sidebar-hover)] hover:text-white"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {SIDEBAR_LABELS[itemId]}
            </button>
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

        <button
          type="button"
          onClick={onOpenCreamy}
          className="mt-4 w-full rounded-[var(--os-radius-sm)] border border-white/10 bg-white/5 p-3 text-left transition-colors hover:border-[var(--os-teal)]/40 hover:bg-white/10"
        >
          <p className="text-sm font-medium">Creamy · Copiloto</p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--os-sidebar-muted)]">
            {creamyTeaser?.headline ?? "Siempre presente — contexto de tu trabajo."}
          </p>
          <span className="mt-2 inline-block text-xs text-[var(--os-teal)]">Abrir panel →</span>
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="mt-3 flex w-full items-center gap-2 px-1 py-2 text-xs text-[var(--os-sidebar-muted)] transition-colors hover:text-white"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
