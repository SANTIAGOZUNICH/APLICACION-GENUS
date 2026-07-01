import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EntityAuditTable } from "@/types/entity-page";

interface EntityAuditTableViewProps {
  table: EntityAuditTable;
}

/**
 * EntityAuditTableView — tables allowed only for audit data
 * (consumos, movimientos, renglones).
 */
export function EntityAuditTableView({ table }: EntityAuditTableViewProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {table.columns.map((column) => (
            <TableHead key={column.id}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row) => (
          <TableRow key={row.id}>
            {table.columns.map((column) => (
              <TableCell key={column.id}>{row.cells[column.id] ?? "—"}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
