import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { sampleTableRows } from "@/mocks/design-system-samples";
import {
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function TablesSection() {
  return (
    <DesignSystemSection
      id="tablas"
      title="Table"
      description="Consulta, referencia y auditoría. Nunca superficie de trabajo del operario."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sampleTableRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono text-xs">{row.id}</TableCell>
              <TableCell>{row.producto}</TableCell>
              <TableCell>
                <StatusBadge status={row.estado} size="sm" />
              </TableCell>
              <TableCell className="text-right">{row.saldo}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DesignSystemSection>
  );
}
