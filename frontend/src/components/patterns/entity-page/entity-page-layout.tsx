"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface EntityPageLayoutProps {
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
  sidebar: React.ReactNode;
  className?: string;
}

/**
 * EntityPageLayout — two-column shell for all entity pages.
 * Main column: status flow, header, sections.
 * Sidebar: activity log + related objects.
 */
export function EntityPageLayout({
  backHref = "/bandeja",
  backLabel = "Volver",
  children,
  sidebar,
  className,
}: EntityPageLayoutProps) {
  return (
    <div className={cn("mx-auto w-full max-w-[75rem] space-y-6", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          style={{ fontSize: "var(--text-meta)" }}
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {backLabel}
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">{children}</div>
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">{sidebar}</aside>
      </div>
    </div>
  );
}
