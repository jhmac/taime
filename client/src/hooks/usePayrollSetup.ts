import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

interface SetupStatus {
  needsSetup: boolean;
  canManagePayroll: boolean;
}

export function usePayrollSetup() {
  const { user } = useAuth();
  const [showSetupModal, setShowSetupModal] = useState(false);

  // Check if user needs to set up payroll
  const { data: setupStatus, isLoading } = useQuery<SetupStatus>({
    queryKey: ["/api/payroll/setup-status"],
    enabled: !!user,
    retry: false,
  });

  // Show setup modal for first-time users
  useEffect(() => {
    if (setupStatus?.needsSetup && !showSetupModal) {
      setShowSetupModal(true);
    }
  }, [setupStatus?.needsSetup, showSetupModal]);

  const closeSetupModal = () => {
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