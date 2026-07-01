import { StatusBadge } from "@/components/ui/status-badge";
import { ALL_STATUSES } from "@/lib/tokens/status-map";
import { getStatusToken } from "@/lib/tokens/status-map";
import { Status } from "@/types/ui/status";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

const tokenOrder = ["ok", "attention", "problem", "neutral"] as const;

export function StatusBadgesSection() {
  const grouped = tokenOrder.map((token) => ({
    token,
    statuses: ALL_STATUSES.filter((s) => getStatusToken(s) === token),
  }));

  return (
    <DesignSystemSection
      id="estados"
      title="Estados (StatusBadge)"
      description="Fuente única de verdad: Status enum → status-map.ts. Nunca strings libres."
    >
      <div className="space-y-6">
        {grouped.map(({ token, statuses }) => (
          <div key={token}>
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Token {token}
            </p>
            <DesignSystemPanel>
              <div className="flex flex-wrap gap-2">
                {statuses.map((status) => (
                  <StatusBadge key={status} status={status} />
                ))}
              </div>
            </DesignSystemPanel>
          </div>
        ))}
        <DesignSystemPanel>
          <p className="mb-2 text-sm text-[var(--muted-foreground)]">Uso canónico:</p>
          <code className="block rounded-md bg-[var(--background)] p-3 font-mono text-xs text-[var(--foreground)]">
            {`<StatusBadge status={Status.EN_CURSO} />`}
          </code>
          <div className="mt-3">
            <StatusBadge status={Status.EN_CURSO} />
          </div>
        </DesignSystemPanel>
      </div>
    </DesignSystemSection>
  );
}
