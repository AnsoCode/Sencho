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

export default function HomeDashboard({ onNavigateToStack, notifications, onClearNotifications }: HomeDashboardProps) {
  const { activeNode, nodes } = useNodes();
  const data = useDashboardData();

  return (
    <div className="flex-1 p-6 space-y-4">
      <HealthStatusBar
        stats={data.stats}
        systemStats={data.systemStats}
        notifications={notifications}
        activeNodeName={activeNode?.name || 'Local'}
        lastUpdated={data.lastUpdated}
      />

      <ResourceGauges
        stats={data.stats}
        systemStats={data.systemStats}
      />

      <StackHealthTable
        stackStatuses={data.stackStatuses}
        metrics={data.metrics}
        systemStats={data.systemStats}
        onNavigateToStack={onNavigateToStack || (() => {})}
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
