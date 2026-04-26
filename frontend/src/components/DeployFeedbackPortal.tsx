import { useEffect, useState } from 'react';
import { useDeployFeedback } from '@/context/DeployFeedbackContext';
import { DeployFeedbackModal } from './DeployFeedbackModal';
import { DeployFeedbackPill } from './DeployFeedbackPill';

export function DeployFeedbackPortal() {
  const [isMinimized, setIsMinimized] = useState(false);
  const { panelState } = useDeployFeedback();

  useEffect(() => {
    if (!panelState.isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMinimized(false);
    }
  }, [panelState.isOpen]);

  return (
    <>
      <DeployFeedbackModal
        isMinimized={isMinimized}
        onMinimize={() => setIsMinimized(true)}
      />
      <DeployFeedbackPill
        isVisible={panelState.isOpen && isMinimized}
        onExpand={() => setIsMinimized(false)}
      />
    </>
  );
}
