import type { FleetNode } from './types';

export function getNodeCpu(node: FleetNode): number {
    return node.systemStats ? parseFloat(node.systemStats.cpu.usage) : 0;
}

export function getNodeMem(node: FleetNode): number {
    return node.systemStats ? parseFloat(node.systemStats.memory.usagePercent) : 0;
}

export function getNodeDisk(node: FleetNode): number {
    return node.systemStats?.disk ? parseFloat(node.systemStats.disk.usagePercent) : 0;
}

export function isCritical(node: FleetNode): boolean {
    return getNodeCpu(node) > 90 || getNodeDisk(node) > 90;
}
