import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

interface SetupStatus {
  needsSetup: boolean;
  canManagePayroll: boolean;
}

export function usePayrollSetup() {
  const { user } = useAuth();
  const [showSetupModal, setShowSetupModal] = useState(false);
  // Track dismissal with a ref so closing the modal doesn't re-trigger the effect
  const dismissedRef = useRef(false);

  const { data: setupStatus, isLoading } = useQuery<SetupStatus>({
    queryKey: ["/api/payroll/setup-status"],
    enabled: !!user,
    retry: false,
  });

  // Open modal once when needsSetup becomes true; respect dismissal for the session
  useEffect(() => {
    if (setupStatus?.needsSetup && !dismissedRef.current) {
      setShowSetupModal(true);
    }
  }, [setupStatus?.needsSetup]);

  const closeSetupModal = () => {
    dismissedRef.current = true;
    setShowSetupModal(false);
  };

  return {
    needsSetup: setupStatus?.needsSetup || false,
    canManagePayroll: setupStatus?.canManagePayroll || false,
    showSetupModal,
    closeSetupModal,
    isLoading,
  };
}
