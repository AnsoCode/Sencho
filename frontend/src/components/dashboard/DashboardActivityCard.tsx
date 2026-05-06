import { useNodes } from '@/context/NodeContext';
import { FleetHeartbeat } from './FleetHeartbeat';
import { StackRestartMap } from './StackRestartMap';

export function DashboardActivityCard() {
  const { nodes } = useNodes();
  const hasRemoteNodes = nodes.some(n => n.type === 'remote');

  if (hasRemoteNodes) {
    return <FleetHeartbeat />;
  }

  return <StackRestartMap />;
}
