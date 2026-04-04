import { useNodes } from '@/context/NodeContext';
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
}

export default function HomeDashboard({ onNavigateToStack }: HomeDashboardProps) {
  const { activeNode } = useNodes();
  const data = useDashboardData();

  return (
    <div className="flex-1 p-6 space-y-4">
      <HealthStatusBar
        stats={data.stats}
        systemStats={data.systemStats}
        notifications={data.notifications}
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
        notifications={data.notifications}
      />
    </div>
  );
}
