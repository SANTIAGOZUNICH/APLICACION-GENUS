"use client";

import {
  Beaker,
  Boxes,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  ListPlus,
  LogOut,
  Package,
  PackageCheck,
  PackageSearch,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Tags,
  XCircle,
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
  ordenes_elaboracion: FileText,
  ordenes_acondicionamiento: FileText,
  ordenes: FileText,
  historial: History,
  pendientes: ClipboardCheck,
  aprobados: CheckCircle2,
  rechazados: XCircle,
  stock: Boxes,
  control_mp: PackageSearch,
  mp_ingresos: Package,
  mp_compras: ClipboardCheck,
  ingresos_me: PackageCheck,
  salidas_me: Package,
  avisos_me: Shield,
  semanas_produccion: Calendar,
  asignar_trabajos: ListPlus,
  entregados: PackageCheck,
  asignacion_lotes: Tags,
  ver_elaboracion: Beaker,
  ver_envasado_masivo: Package,
  ver_envasado_premium: Package,
  ver_calidad: ShieldCheck,
  ver_materia_prima: Boxes,
} as const;

export const SIDEBAR_LABELS: Record<SidebarItemId, string> = {
  mi_trabajo: "Mi trabajo",
  plan_semanal: "Plan semanal",
  consulta: "Consulta",
  insumos: "Insumos",
  calidad: "Calidad",
  configuracion: "Configuración",
  produccion: "Producción",
  direccion: "Dirección",
  ordenes_elaboracion: "Órdenes de Elaboración",
  ordenes_acondicionamiento: "Órdenes de Acondicionamiento",
  ordenes: "Órdenes",
  historial: "Historial",
  pendientes: "Pendientes",
  aprobados: "Aprobados",
  rechazados: "Rechazados",
  stock: "Stock",
  control_mp: "Control semanal",
  mp_ingresos: "Ingresos MP",
  mp_compras: "Compras MP",
  ingresos_me: "Ingresos ME",
  salidas_me: "Salidas ME",
  avisos_me: "Avisos",
  semanas_produccion: "Semanas de Producción",
  asignar_trabajos: "Asignar trabajos",
  entregados: "Entregados",
  asignacion_lotes: "Asignación de lotes",
  ver_elaboracion: "Elaboración",
  ver_envasado_masivo: "Envasado Masivo",
  ver_envasado_premium: "Envasado Premium",
  ver_calidad: "Calidad",
  ver_materia_prima: "Materias Primas",
};

interface OsSidebarProps {
  sectorLabel: string;
  sectorEmail: string;
  activeNav?: SidebarItemId;
  sidebarItems: SidebarItemId[];
  labelOverrides?: Partial<Record<SidebarItemId, string>>;
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
  labelOverrides,
  creamyTeaser,
  onNav,
  onLogout,
  onOpenCreamy,
}: OsSidebarProps) {
  return (
    <aside
      className="flex h-full min-h-0 w-full shrink-0 flex-col bg-[var(--os-sidebar-bg)] text-[var(--os-sidebar-text)] md:w-[var(--os-sidebar-width)]"
    >
      <div className="shrink-0 px-5 py-5">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-5 text-[var(--os-teal)]" aria-hidden="true" />
          <p className="text-sm font-semibold">GENUS OS</p>
        </div>
      </div>

      <div className="mx-4 shrink-0 rounded-[var(--os-radius-sm)] border border-white/10 px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <p className="text-sm font-medium">{sectorLabel}</p>
        </div>
      </div>

      {/* Nav scrollea dentro del sidebar si hay muchas opciones — no genera scroll del body. */}
      <nav
        className="mt-4 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-2"
        aria-label="Menú"
      >
        {sidebarItems.map((itemId) => {
          const Icon = ICONS[itemId];
          const active = activeNav === itemId;
          const label = labelOverrides?.[itemId] ?? SIDEBAR_LABELS[itemId];
          return (
            <button
              key={itemId}
              type="button"
              onClick={() => onNav?.(itemId)}
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-[var(--os-radius-sm)] px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--os-sidebar-bg)] ${
                active
                  ? "bg-[var(--os-teal-muted)] font-medium text-white"
                  : "text-[var(--os-sidebar-muted)] hover:bg-[var(--os-sidebar-hover)] hover:text-white"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-[var(--os-teal)] text-[10px] font-bold text-white">
            {sectorEmail.slice(0, 2).toUpperCase()}
          </div>
          <p className="truncate text-xs text-[var(--os-sidebar-muted)]">{sectorEmail}</p>
        </div>

        <button
          type="button"
          onClick={onOpenCreamy}
          className="mt-4 w-full rounded-[var(--os-radius-sm)] border border-white/10 bg-white/5 p-3 text-left transition-colors hover:border-[var(--os-teal)]/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
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
          className="mt-3 flex w-full items-center gap-2 rounded-[var(--os-radius-sm)] px-2 py-2.5 text-sm text-[var(--os-sidebar-muted)] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
