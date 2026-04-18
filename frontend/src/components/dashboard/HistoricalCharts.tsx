import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Area, AreaChart, CartesianGrid, ReferenceDot, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import type { MetricPoint, SystemStats } from './types';

interface HistoricalChartsProps {
  metrics: MetricPoint[];
  systemStats: SystemStats | null;
}

const chartConfig = {
  cpu: { label: 'CPU Usage (%)', color: 'var(--chart-1)' },
  ram: { label: 'RAM Usage (GB)', color: 'var(--chart-2)' },
};

export function HistoricalCharts({ metrics, systemStats }: HistoricalChartsProps) {
  const chartData = useMemo(() => {
    const buckets: Record<string, { time: string; timestamp: number; cpu: number; ram: number }> = {};
    const cores = systemStats?.cpu.cores || 1;

    metrics.forEach(m => {
      const date = new Date(m.timestamp);
      date.setSeconds(0, 0);
      const key = date.getTime() + '';

      if (!buckets[key]) {
        buckets[key] = {
          time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: date.getTime(),
          cpu: 0,
          ram: 0,
        };
      }
      buckets[key].cpu += (m.cpu_percent / cores);
      buckets[key].ram += (m.memory_mb / 1024);
    });

    return Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp);
  }, [metrics, systemStats]);

  const hasData = chartData.length > 0;

  const cpuPeak = useMemo(() => {
    if (chartData.length === 0) return null;
    let peak = chartData[0];
    for (const row of chartData) {
      if (row.cpu > peak.cpu) peak = row;
    }
    return peak;
  }, [chartData]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="bg-card shadow-card-bevel">
        <CardHeader className="pb-2">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display italic text-xl leading-none tracking-tight text-stat-value">CPU</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-stat-subtitle">
              last 24h · normalized over cores
            </span>
          </div>
        </CardHeader>
        <CardContent className="h-[250px]">
          {hasData ? (
            <ChartContainer config={chartConfig} className="w-full h-full">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="dash-cpu-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="time" minTickGap={30} tickMargin={8} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <YAxis tickFormatter={(val) => `${Number(val).toFixed(0)}%`} domain={[0, (dataMax: number) => Math.max(100, Math.ceil(dataMax / 10) * 10)]} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stroke="var(--chart-1)"
                  strokeWidth={1.25}
                  fill="url(#dash-cpu-fill)"
                />
                {cpuPeak ? (
                  <ReferenceDot
                    x={cpuPeak.time}
                    y={cpuPeak.cpu}
                    r={3}
                    fill="var(--chart-2)"
                    stroke="var(--background)"
                    strokeWidth={1}
                  />
                ) : null}
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Skeleton className="w-full h-[180px] rounded-md" />
              <span className="text-xs text-stat-icon">Waiting for CPU metrics...</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card shadow-card-bevel">
        <CardHeader className="pb-2">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display italic text-xl leading-none tracking-tight text-stat-value">Memory</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-stat-subtitle">
              last 24h · total allocation
            </span>
          </div>
        </CardHeader>
        <CardContent className="h-[250px]">
          {hasData ? (
            <ChartContainer config={chartConfig} className="w-full h-full">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="dash-ram-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="time" minTickGap={30} tickMargin={8} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <YAxis tickFormatter={(val) => `${Number(val).toFixed(1)} GB`} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="ram"
                  stroke="var(--chart-2)"
                  strokeWidth={1.25}
                  fill="url(#dash-ram-fill)"
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Skeleton className="w-full h-[180px] rounded-md" />
              <span className="text-xs text-stat-icon">Waiting for RAM metrics...</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
