import { type ReactNode } from 'react';
import { Unplug } from 'lucide-react';
import { useNodes } from '@/context/NodeContext';
import type { Capability } from '@/lib/capabilities';

interface CapabilityGateProps {
  capability: Capability;
  featureName?: string;
  children: ReactNode;
}

export function CapabilityGate({ capability, featureName = 'This feature', children }: CapabilityGateProps) {
  const { hasCapability, activeNode, activeNodeMeta } = useNodes();

  if (hasCapability(capability)) return <>{children}</>;

  const nodeName = activeNode?.name ?? 'this node';
  const hasValidVersion = activeNodeMeta?.version && activeNodeMeta.version !== 'unknown' && activeNodeMeta.version !== '0.0.0-dev';
  const versionHint = hasValidVersion
    ? `${nodeName} is running v${activeNodeMeta.version}`
    : `${nodeName} does not support this capability`;

  return (
    <div className="relative">
      <div className="opacity-40 pointer-events-none select-none blur-[2px]">
        {children}
      </div>
      <div className="absolute inset-0 flex items-start justify-center pt-8">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-muted-foreground text-xs">
          <Unplug className="w-3 h-3" strokeWidth={1.5} />
          {featureName} is not available — {versionHint}
        </div>
      </div>
    </div>
  );
}
