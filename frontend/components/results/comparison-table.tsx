import { Check } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ComparisonRow, Side } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The "see it yourself" table: each row marks which option wins on that point. */
export function ComparisonTable({ rows, restaurantName }: { rows: ComparisonRow[]; restaurantName?: string }) {
  if (rows.length === 0) return null;
  const tally = (side: Side) => rows.filter((r) => r.winner === side).length;

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Side by side</h3>
        <p className="text-xs text-muted-foreground">
          Cooking wins {tally("cook")} of {rows.length} · ordering wins {tally("order")} of {rows.length}
        </p>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40" />
              <TableHead>Make at home</TableHead>
              <TableHead>Order{restaurantName ? ` (${restaurantName})` : ""}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} data-testid={`row-${row.key}`}>
                <TableCell className="font-medium text-muted-foreground">{row.label}</TableCell>
                <Cell value={row.cook} wins={row.winner === "cook"} />
                <Cell value={row.order} wins={row.winner === "order"} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Cell({ value, wins }: { value: string; wins: boolean }) {
  return (
    <TableCell data-winner={wins ? "true" : "false"} className={cn(wins && "font-medium text-foreground")}>
      <span className="flex items-center gap-2">
        {wins ? (
          <Check className="size-4 shrink-0 text-success" aria-label="Better" />
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        {value}
      </span>
    </TableCell>
  );
}
