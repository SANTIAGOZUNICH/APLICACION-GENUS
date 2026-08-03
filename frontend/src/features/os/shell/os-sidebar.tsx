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
  Mail,
  Package,
  PackageCheck,
  PackageSearch,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Tags,
  XCircle,
  FolderOpen,
  BarChart3,
} from "lucide-react";
import type { SidebarItemId } from "@/lib/role-engine/types";

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
  inventario_me: Boxes,
  deposito_graneles: FlaskConical,
  avisos: Mail,
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
  remitos: FileText,
  procedimientos: FolderOpen,
  metricas: BarChart3,
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
  inventario_me: "Inventario ME",
  deposito_graneles: "Depósito Graneles",
  avisos: "Avisos",
  avisos_me: "Avisos ME",
  semanas_produccion: "Plan semanal",
  asignar_trabajos: "Asignar trabajos",
  entregados: "Entregados",
  asignacion_lotes: "Asignación de lotes",
  ver_elaboracion: "Elaboración",
  ver_envasado_masivo: "Envasado Masivo",
  ver_envasado_premium: "Envasado Premium",
  ver_calidad: "Calidad",
  ver_materia_prima: "Materias Primas",
  remitos: "Remitos",
  procedimientos: "Procedimientos",
  metricas: "Métricas",
};

interface OsSidebarProps {
  sectorLabel: string;
  sectorEmail: string;
  activeNav?: SidebarItemId;
  sidebarItems: SidebarItemId[];
  labelOverrides?: Partial<Record<SidebarItemId, string>>;
  showRestricted?: boolean;
  onNav?: (itemId: SidebarItemId) => void;
}

/** Sidebar operativa — navegación real del Digital Twin (sin Creamy card ni logout). */
export function OsSidebar({
  sectorLabel,
  sectorEmail,
  activeNav = "mi_trabajo",
  sidebarItems,
  labelOverrides,
  onNav,
}: OsSidebarProps) {
  return (
    <aside
      className="flex h-full min-h-0 w-full shrink-0 flex-col bg-[var(--os-sidebar-bg)] text-[var(--os-sidebar-text)] md:w-[var(--os-sidebar-width)]"
      style={{
        background:
          "linear-gradient(180deg, var(--os-sidebar-bg) 0%, var(--os-sidebar-bg-2) 100%)",
      }}
    >
      <div className="shrink-0 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-[var(--os-radius-sm)] bg-[var(--os-teal-muted)]">
            <FlaskConical className="size-3.5 text-[var(--os-teal-glow)]" aria-hidden="true" />
          </span>
          <p className="text-[13px] font-semibold tracking-wide">GENUS OS</p>
        </div>
      </div>

      <div className="mx-3 shrink-0 rounded-[var(--os-radius-sm)] border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--os-teal)]" aria-hidden="true" />
          <p className="text-[13px] font-medium">{sectorLabel}</p>
        </div>
      </div>

      <div className="os-scroll-fade os-scroll-fade-sidebar relative mt-3 min-h-0 flex-1">
        <nav
          className="os-scroll-sidebar h-full space-y-0.5 overflow-y-scroll overscroll-contain px-2.5 pb-2"
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
                className={`os-nav-item flex w-full items-center gap-2.5 rounded-[var(--os-radius-sm)] px-2.5 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--os-sidebar-bg)] ${
                  active
                    ? "bg-[var(--os-teal-muted)] font-medium text-white"
                    : "text-[var(--os-sidebar-muted)] hover:bg-[var(--os-sidebar-hover)] hover:text-white"
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 transition-transform duration-[var(--genus-duration-hover,140ms)] ${
                    active ? "scale-105" : ""
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="shrink-0 border-t border-white/[0.08] px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--os-teal)] text-[10px] font-bold text-[var(--os-navy)]">
            {sectorEmail.slice(0, 2).toUpperCase()}
          </div>
          <p
            className="min-w-0 flex-1 truncate text-xs text-[var(--os-sidebar-muted)]"
            title={sectorEmail}
          >
            {sectorEmail}
          </p>
        </div>
      </div>
    </aside>
  );
}
