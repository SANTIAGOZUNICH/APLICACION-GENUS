import type { LucideIcon } from "lucide-react";
import {
  Factory,
  Inbox,
  LayoutDashboard,
  Package,
  Palette,
  Search,
  ShieldCheck,
  Stamp,
  Warehouse,
} from "lucide-react";

export type WorkspaceId =
  | "bandeja"
  | "produccion"
  | "calidad"
  | "deposito"
  | "comercial"
  | "direccion"
  | "dt"
  | "consulta"
  | "design-system";

export interface NavItem {
  id: WorkspaceId;
  label: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
  section?: "primary" | "secondary";
}

/**
 * Workspaces — /docs/08-workspaces.md
 * Entrega 4: workspaces operativos habilitados.
 */
export const navigationItems: NavItem[] = [
  {
    id: "bandeja",
    label: "Mi Trabajo",
    href: "/bandeja",
    icon: Inbox,
    enabled: true,
    section: "primary",
  },
  {
    id: "produccion",
    label: "Producción",
    href: "/produccion",
    icon: Factory,
    enabled: true,
    section: "primary",
  },
  {
    id: "calidad",
    label: "Calidad",
    href: "/calidad",
    icon: ShieldCheck,
    enabled: true,
    section: "primary",
  },
  {
    id: "deposito",
    label: "Depósito",
    href: "/deposito",
    icon: Warehouse,
    enabled: true,
    section: "primary",
  },
  {
    id: "comercial",
    label: "Comercial",
    href: "/comercial",
    icon: Package,
    enabled: true,
    section: "primary",
  },
  {
    id: "direccion",
    label: "Dirección",
    href: "/direccion",
    icon: LayoutDashboard,
    enabled: true,
    section: "primary",
  },
  {
    id: "dt",
    label: "Dir. Técnica",
    href: "/dt",
    icon: Stamp,
    enabled: true,
    section: "primary",
  },
  {
    id: "consulta",
    label: "Consulta",
    href: "/consulta",
    icon: Search,
    enabled: true,
    section: "secondary",
  },
  {
    id: "design-system",
    label: "Design System",
    href: "/design-system",
    icon: Palette,
    enabled: true,
    section: "secondary",
  },
];

export function getNavItemByHref(href: string): NavItem | undefined {
  return navigationItems.find((item) => item.href === href);
}
