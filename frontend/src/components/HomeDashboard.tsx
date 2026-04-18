import { useNodes } from '@/context/NodeContext';
import type { NotificationItem } from './dashboard/types';
import {
  HealthStatusBar,
  ResourceGauges,
  StackHealthTable,
  HistoricalCharts,
  RecentAlerts,
  useDashboardData,
} from './dashboard';

interface HomeDashboardProps {
  onNavigateToStack?: (stackFile: string) => void;
  notifications: NotificationItem[];
  onClearNotifications: () => void | Promise<void>;
}

const NOOP = () => {};

export default function HomeDashboard({ onNavigateToStack, notifications, onClearNotifications }: HomeDashboardProps) {
  const { activeNode, nodes } = useNodes();
  const data = useDashboardData();
  const activeNodeName = activeNode?.name || 'Local';

  return (
    <div className="flex-1 p-6 space-y-4">
      <HealthStatusBar
        stats={data.stats}
        systemStats={data.systemStats}
        notifications={notifications}
        activeNodeName={activeNodeName}
        nodeCount={data.nodeCount}
        lastSyncAt={data.lastSyncAt}
      />

      <ResourceGauges
        systemStats={data.systemStats}
        cpuHistory={data.cpuHistory}
        netHistory={data.netHistory}
      />

      <StackHealthTable
        stackStatuses={data.stackStatuses}
        metrics={data.metrics}
        stackCpuSeries={data.stackCpuSeries}
        activeNodeName={activeNodeName}
        onNavigateToStack={onNavigateToStack ?? NOOP}
      />

      <HistoricalCharts
        metrics={data.metrics}
        systemStats={data.systemStats}
      />

      <RecentAlerts
        notifications={notifications}
        nodes={nodes}
        onCleared={onClearNotifications}
      />
    </div>
  );
}
