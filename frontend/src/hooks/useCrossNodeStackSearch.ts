import { useEffect, useRef, useState } from 'react';
import { useNodes } from '@/context/NodeContext';
import { fetchForNode } from '@/lib/api';

export type StackStatus = 'running' | 'exited' | 'unknown';

export interface StackStatusInfo {
    status: StackStatus;
}

export interface StackHit {
    nodeId: number;
    nodeName: string;
    file: string;
    status: StackStatus;
}

interface Options {
    query: string;
    enabled: boolean;
    excludeNodeId?: number;
}

const DEBOUNCE_MS = 250;

export function useCrossNodeStackSearch({ query, enabled, excludeNodeId }: Options) {
    const { nodes } = useNodes();
    const [hits, setHits] = useState<StackHit[]>([]);
    const [loading, setLoading] = useState(false);

    // Ref avoids re-running the effect on every NodeContext status tick
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;

    useEffect(() => {
        const q = query.trim().toLowerCase();
        if (!enabled || !q) {
            setHits([]);
            setLoading(false);
            return;
        }
        const targets = nodesRef.current.filter(
            n => n.status !== 'offline' && n.id !== excludeNodeId,
        );
        if (targets.length === 0) {
            setHits([]);
            return;
        }
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const perNode = await Promise.all(targets.map(async (node) => {
                    try {
                        const [listRes, statusRes] = await Promise.all([
                            fetchForNode('/stacks', node.id, { signal: controller.signal }),
                            fetchForNode('/stacks/statuses', node.id, { signal: controller.signal }),
                        ]);
                        if (!listRes.ok) return [] as StackHit[];
                        const rawList = await listRes.json();
                        const files: string[] = Array.isArray(rawList) ? rawList : [];
                        const statuses: Record<string, StackStatus> = {};
                        if (statusRes.ok) {
                            const raw = await statusRes.json();
                            for (const [key, val] of Object.entries(raw)) {
                                if (typeof val === 'string') {
                                    statuses[key] = val as StackStatus;
                                } else if (val && typeof val === 'object' && 'status' in val) {
                                    statuses[key] = (val as StackStatusInfo).status;
                                }
                            }
                        }
                        return files
                            .filter(f => f.toLowerCase().includes(q))
                            .map<StackHit>(file => ({
                                nodeId: node.id,
                                nodeName: node.name,
                                file,
                                status: statuses[file] ?? 'unknown',
                            }));
                    } catch {
                        return [] as StackHit[];
                    }
                }));
                if (controller.signal.aborted) return;
                setHits(perNode.flat());
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [enabled, query, excludeNodeId]);

    return { hits, loading };
}
