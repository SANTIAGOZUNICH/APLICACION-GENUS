/** Helpers responsive — clases Tailwind compartidas para workspace premium. */

export type WorkspaceBreakpoint = "mobile" | "tablet" | "desktop";

export function resolveWorkspaceBreakpoint(width: number): WorkspaceBreakpoint {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export const workspaceContainerClass =
  "mx-auto w-full max-w-5xl space-y-10 pb-12 sm:space-y-12 lg:space-y-16";

export const workspaceHeroClass =
  "rounded-[var(--os-radius)] border border-[var(--os-border-subtle)] bg-[var(--os-surface)] px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12";

export const workspaceWorkGridClass =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-2 xl:gap-5";

export const workspaceAttentionGridClass =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

export const workspaceActionsGridClass =
  "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3";

export const workspaceNextStackClass = "flex flex-col gap-2 sm:gap-3";

export const workspaceActivityClass = "divide-y divide-[var(--os-border-subtle)]";

export function workspaceColumnsForBreakpoint(breakpoint: WorkspaceBreakpoint): number {
  switch (breakpoint) {
    case "mobile":
      return 1;
    case "tablet":
      return 2;
    case "desktop":
      return 2;
  }
}
