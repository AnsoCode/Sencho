import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Activity } from 'lucide-react';
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center space-x-2 text-sm font-medium text-stat-title">
            <Activity className="w-4 h-4 text-stat-icon" strokeWidth={1.5} />
            <span>CPU Usage</span>
          </CardTitle>
          <CardDescription className="text-xs">Normalized total CPU percentage over host cores (24h).</CardDescription>
        </CardHeader>
        <CardContent className="h-[250px]">
          {hasData ? (
            <ChartContainer config={chartConfig} className="w-full h-full">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="time" minTickGap={30} tickMargin={8} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <YAxis tickFormatter={(val) => `${Number(val).toFixed(0)}%`} domain={[0, 100]} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="cpu" stroke="var(--color-cpu)" fill="var(--color-cpu)" fillOpacity={0.4} />
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

      <Card className="bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center space-x-2 text-sm font-medium text-stat-title">
            <Activity className="w-4 h-4 text-stat-icon" strokeWidth={1.5} />
            <span>RAM Usage</span>
          </CardTitle>
          <CardDescription className="text-xs">Total RAM allocation in GB (24h).</CardDescription>
        </CardHeader>
        <CardContent className="h-[250px]">
          {hasData ? (
            <ChartContainer config={chartConfig} className="w-full h-full">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="time" minTickGap={30} tickMargin={8} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <YAxis tickFormatter={(val) => `${Number(val).toFixed(1)} GB`} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="ram" stroke="var(--color-ram)" fill="var(--color-ram)" fillOpacity={0.4} />
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
