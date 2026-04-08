import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Cpu, MemoryStick, HardDrive, Container, Network } from 'lucide-react';
import {
  CursorProvider,
  Cursor,
  CursorContainer,
  CursorFollow,
} from '@/components/animate-ui/primitives/animate/cursor';
import type { Stats, SystemStats } from './types';

interface ResourceGaugesProps {
  stats: Stats;
  systemStats: SystemStats | null;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const getValueColor = (value: number, warn = 80, crit = 90): string => {
  if (value >= crit) return 'text-destructive/80';
  if (value >= warn) return 'text-warning/80';
  return 'text-stat-value';
};

const getBarColor = (value: number, warn = 80, crit = 90): string => {
  if (value >= crit) return 'var(--destructive)';
  if (value >= warn) return 'var(--warning)';
  return 'var(--brand)';
};

function GaugeBar({ value, warn = 80, crit = 90 }: { value: number; warn?: number; crit?: number }) {
  return (
    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(value, 100)}%`, backgroundColor: getBarColor(value, warn, crit) }}
      />
    </div>
  );
}

export function ResourceGauges({ stats, systemStats }: ResourceGaugesProps) {
  const cpuVal = parseFloat(systemStats?.cpu.usage || '0');
  const ramVal = parseFloat(systemStats?.memory.usagePercent || '0');
  const diskVal = parseFloat(systemStats?.disk?.usagePercent || '0');

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {/* CPU */}
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
          <CardTitle className="text-xs font-medium text-stat-title">CPU</CardTitle>
          <Cpu className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        </CardHeader>
        <CardContent className="pt-0">
          <div className={`text-2xl font-medium font-mono tabular-nums tracking-tight ${systemStats ? getValueColor(cpuVal) : 'text-stat-value'}`}>
            {systemStats ? `${systemStats.cpu.usage}%` : '...'}
          </div>
          <p className="text-xs text-stat-subtitle mt-0.5">
            {systemStats ? `${systemStats.cpu.cores} cores` : '\u00A0'}
          </p>
          {systemStats && <GaugeBar value={cpuVal} />}
        </CardContent>
      </Card>

      {/* RAM */}
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
          <CardTitle className="text-xs font-medium text-stat-title">Memory</CardTitle>
          <MemoryStick className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        </CardHeader>
        <CardContent className="pt-0">
          <div className={`text-2xl font-medium font-mono tabular-nums tracking-tight ${systemStats ? getValueColor(ramVal) : 'text-stat-value'}`}>
            {systemStats ? `${systemStats.memory.usagePercent}%` : '...'}
          </div>
          <p className="text-xs text-stat-subtitle mt-0.5">
            {systemStats ? `${formatBytes(systemStats.memory.used)} / ${formatBytes(systemStats.memory.total)}` : '\u00A0'}
          </p>
          {systemStats && <GaugeBar value={ramVal} />}
        </CardContent>
      </Card>

      {/* Disk */}
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
          <CardTitle className="text-xs font-medium text-stat-title">Disk</CardTitle>
          <HardDrive className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        </CardHeader>
        <CardContent className="pt-0">
          <div className={`text-2xl font-medium font-mono tabular-nums tracking-tight ${systemStats?.disk ? getValueColor(diskVal) : 'text-stat-value'}`}>
            {systemStats?.disk ? `${systemStats.disk.usagePercent}%` : '...'}
          </div>
          <p className="text-xs text-stat-subtitle mt-0.5">
            {systemStats?.disk ? `${formatBytes(systemStats.disk.used)} / ${formatBytes(systemStats.disk.total)}` : '\u00A0'}
          </p>
          {systemStats?.disk && <GaugeBar value={diskVal} />}
        </CardContent>
      </Card>

      {/* Containers */}
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
          <CardTitle className="text-xs font-medium text-stat-title">Containers</CardTitle>
          <Container className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        </CardHeader>
        <CardContent className="pt-0">
          <div className="relative">
            <CursorProvider>
              <CursorContainer className="inline-flex items-baseline">
                <span className="text-2xl font-medium font-mono tabular-nums tracking-tight text-stat-value">{stats.active}</span>
                <span className="text-sm text-stat-subtitle ml-1.5">{stats.active === 1 ? 'active' : 'actives'}</span>
              </CursorContainer>
              <Cursor>
                <div className="h-2 w-2 rounded-full bg-brand" />
              </Cursor>
              <CursorFollow
                side="bottom"
                sideOffset={4}
                align="center"
                transition={{ stiffness: 400, damping: 40, bounce: 0 }}
              >
                <div className="rounded-md border border-card-border bg-popover/95 backdrop-blur-[10px] backdrop-saturate-[1.15] px-2.5 py-1.5 shadow-md">
                  <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                    <span className="text-stat-value">{stats.managed}<span className="text-stat-subtitle ml-1 font-sans">managed</span></span>
                    <span className="text-stat-icon">|</span>
                    <span className="text-stat-value">{stats.unmanaged}<span className="text-stat-subtitle ml-1 font-sans">external</span></span>
                  </div>
                </div>
              </CursorFollow>
            </CursorProvider>
          </div>
          <p className="text-xs text-stat-subtitle mt-0.5">
            <span className="font-mono tabular-nums text-destructive/80">{stats.exited}</span> exited
          </p>
        </CardContent>
      </Card>

      {/* Network */}
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
          <CardTitle className="text-xs font-medium text-stat-title">Network</CardTitle>
          <Network className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1 mt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-stat-icon">RX</span>
              <span className="text-sm font-mono tabular-nums text-stat-value">
                {systemStats?.network ? `${formatBytes(systemStats.network.rxSec)}/s` : '...'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-stat-icon">TX</span>
              <span className="text-sm font-mono tabular-nums text-stat-value">
                {systemStats?.network ? `${formatBytes(systemStats.network.txSec)}/s` : '...'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
