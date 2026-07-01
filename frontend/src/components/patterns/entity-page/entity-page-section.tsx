import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface EntityPageSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/** EntityPageSection — titled content block for entity detail sections. */
export function EntityPageSection({
  title,
  description,
  children,
  className,
}: EntityPageSectionProps) {
  return (
    <Card variant="default" padding="none" className={cn("overflow-hidden", className)}>
      <CardHeader className="border-b border-[var(--border-subtle)] px-5 py-4">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="px-5 py-4">{children}</CardContent>
    </Card>
  );
}
