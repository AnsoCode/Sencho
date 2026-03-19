import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';

export interface Node {
  id: number;
  name: string;
  type: 'local' | 'remote';
  host: string;
  port: number;
  ssh_port: number;
  compose_dir: string;
  is_default: boolean;
  status: 'online' | 'offline' | 'unknown';
  created_at: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key?: string;
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

  const refreshNodes = useCallback(async () => {
    try {
      const res = await apiFetch('/nodes');
      if (res.ok) {
        const data = await res.json();
        setNodes(data);

        // If no active node is set, select the default node
        if (!activeNode) {
          const defaultNode = data.find((n: Node) => n.is_default);
          if (defaultNode) {
            setActiveNodeState(defaultNode);
          } else if (data.length > 0) {
            setActiveNodeState(data[0]);
          }
        } else {
          // Refresh the active node's data in case its status changed
          const updatedActive = data.find((n: Node) => n.id === activeNode.id);
          if (updatedActive) {
            setActiveNodeState(updatedActive);
          } else {
            // The active node was deleted! Fallback to default
            const defaultNode = data.find((n: Node) => n.is_default);
            if (defaultNode) {
              setActiveNodeState(defaultNode);
            } else if (data.length > 0) {
              setActiveNodeState(data[0]);
            } else {
              setActiveNodeState(null);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeNode]);

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
