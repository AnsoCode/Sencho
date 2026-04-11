import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronRight, ChevronLeft, Layers } from 'lucide-react';
import type { StackStatusEntry, MetricPoint } from './types';

interface StackHealthTableProps {
  stackStatuses: Record<string, StackStatusEntry>;
  metrics: MetricPoint[];
  onNavigateToStack: (stackFile: string) => void;
}

const PAGE_SIZE = 8;

const formatMemory = (mb: number): string => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};

export function StackHealthTable({ stackStatuses, metrics, onNavigateToStack }: StackHealthTableProps) {
  const [page, setPage] = useState(0);

  const stackMetrics = useMemo(() => {
    const latestPerContainer: Record<string, Record<string, MetricPoint>> = {};
    for (const m of metrics) {
      if (!m.stack_name) continue;
      const stack = m.stack_name;
      if (!latestPerContainer[stack]) latestPerContainer[stack] = {};
      const existing = latestPerContainer[stack][m.container_id];
      if (!existing || m.timestamp > existing.timestamp) {
        latestPerContainer[stack][m.container_id] = m;
      }
    }

    const result: Record<string, { mem: number }> = {};
    for (const [stack, containers] of Object.entries(latestPerContainer)) {
      let mem = 0;
      for (const m of Object.values(containers)) {
        mem += m.memory_mb;
      }
      result[stack] = { mem };
    }
    return result;
  }, [metrics]);

  const rows = useMemo(() => {
    return Object.entries(stackStatuses)
      .map(([file, entry]) => {
        const name = file.replace(/\.(yml|yaml)$/, '');
        const m = stackMetrics[name];
        return {
          file,
          name,
          status: entry.status,
          memory: m?.mem ?? null,
        };
      })
      .sort((a, b) => {
        const statusOrder = { running: 0, exited: 1, unknown: 2 };
        const diff = statusOrder[a.status] - statusOrder[b.status];
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });
  }, [stackStatuses, stackMetrics]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // Clamp page to valid range (handles node switch reducing the stack count)
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const needsPagination = rows.length > PAGE_SIZE;

  const statusDisplay: Record<string, { label: string; className: string }> = {
    running: { label: 'UP', className: 'text-success' },
    exited: { label: 'DN', className: 'text-destructive' },
    unknown: { label: '--', className: 'text-stat-icon' },
  };

  if (Object.keys(stackStatuses).length === 0) {
    return (
      <Card className="bg-card">
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2 text-stat-subtitle">
            <Layers className="h-8 w-8 text-stat-icon" strokeWidth={1.5} />
            <p className="text-sm">No stacks found. Create one from the sidebar.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-stat-title">Stack Health</CardTitle>
          {needsPagination && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
              <span className="text-xs font-mono tabular-nums text-stat-subtitle min-w-[3rem] text-center">
                {safePage + 1} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs text-stat-icon font-medium h-8">Stack</TableHead>
              <TableHead className="text-xs text-stat-icon font-medium h-8 w-[60px]">Status</TableHead>
              <TableHead className="text-xs text-stat-icon font-medium h-8 w-[90px] text-right">Memory</TableHead>
              <TableHead className="h-8 w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.map(row => {
              const sd = statusDisplay[row.status] || statusDisplay.unknown;
              return (
                <TableRow
                  key={row.file}
                  className="cursor-pointer border-b border-border/50 hover:bg-accent/5"
                  onClick={() => onNavigateToStack(row.file)}
                >
                  <TableCell className="py-2.5">
                    <span className="font-mono text-sm text-stat-value">{row.name}</span>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <span className={`font-mono text-xs font-medium ${sd.className}`}>{sd.label}</span>
                  </TableCell>
                  <TableCell className="py-2.5 text-right">
                    <span className="font-mono text-xs tabular-nums text-stat-subtitle">
                      {row.memory !== null ? formatMemory(row.memory) : '--'}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <ChevronRight className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
