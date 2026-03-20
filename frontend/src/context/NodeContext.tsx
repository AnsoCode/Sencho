import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';

export interface Node {
  id: number;
  name: string;
  type: 'local' | 'remote';
  compose_dir: string;
  is_default: boolean;
  status: 'online' | 'offline' | 'unknown';
  created_at: number;
  api_url?: string;
  api_token?: string;
}

interface NodeContextType {
  nodes: Node[];
  activeNode: Node | null;
  setActiveNode: (node: Node) => void;
  refreshNodes: () => Promise<void>;
  isLoading: boolean;
}

const NodeContext = createContext<NodeContextType | undefined>(undefined);

export function NodeProvider({ children }: { children: React.ReactNode }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [activeNode, setActiveNodeState] = useState<Node | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Ref lets refreshNodes read current activeNode without being a dep (breaks infinite loop)
  const activeNodeRef = useRef<Node | null>(null);
  activeNodeRef.current = activeNode;

  const refreshNodes = useCallback(async () => {
    try {
      const res = await apiFetch('/nodes');
      if (res.ok) {
        const data = await res.json();
        setNodes(data);

        const currentActive = activeNodeRef.current;
        if (!currentActive) {
          // On initial load, restore from localStorage before falling back to default.
          // This keeps the UI dropdown in sync with the node ID that apiFetch is already
          // injecting via x-node-id (read directly from localStorage on every request).
          const storedId = localStorage.getItem('sencho-active-node');
          const storedNode = storedId ? data.find((n: Node) => n.id === parseInt(storedId, 10)) : null;
          const nodeToActivate = storedNode ?? data.find((n: Node) => n.is_default) ?? data[0] ?? null;
          if (nodeToActivate) {
            setActiveNodeState(nodeToActivate);
            localStorage.setItem('sencho-active-node', String(nodeToActivate.id));
          }
        } else {
          const updatedActive = data.find((n: Node) => n.id === currentActive.id);
          if (updatedActive) {
            setActiveNodeState(updatedActive);
            localStorage.setItem('sencho-active-node', String(updatedActive.id));
          } else {
            const fallback = data.find((n: Node) => n.is_default) ?? data[0] ?? null;
            if (fallback) {
              setActiveNodeState(fallback);
              localStorage.setItem('sencho-active-node', String(fallback.id));
            } else {
              setActiveNodeState(null);
              localStorage.removeItem('sencho-active-node');
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
    } finally {
      setIsLoading(false);
    }
  }, []); // stable - reads activeNode via ref, not closure capture

  const setActiveNode = useCallback((node: Node) => {
    setActiveNodeState(node);
    localStorage.setItem('sencho-active-node', String(node.id));
  }, []);

  useEffect(() => {
    refreshNodes();

    const handleNodeNotFound = () => {
      console.warn('[NodeContext] Active node is unreachable or deleted. Forcing sync...');
      refreshNodes();
    };

    window.addEventListener('node-not-found', handleNodeNotFound);
    return () => window.removeEventListener('node-not-found', handleNodeNotFound);
  }, [refreshNodes]);

  return (
    <NodeContext.Provider value={{ nodes, activeNode, setActiveNode, refreshNodes, isLoading }}>
      {children}
    </NodeContext.Provider>
  );
}

export function useNodes() {
  const context = useContext(NodeContext);
  if (!context) {
    throw new Error('useNodes must be used within a NodeProvider');
  }
  return context;
}
