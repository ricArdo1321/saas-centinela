import { useEffect } from 'react';
import { useToast } from '../components/ToastSystem';

/**
 * Real-time alerts hook - currently disabled until WebSocket/SSE is implemented
 * TODO: Replace with actual real-time connection to backend
 */
export const useRealTimeAlerts = (_active: boolean) => {
  const { toast: _toast } = useToast();

  useEffect(() => {
    // Disabled: No simulated alerts in production
    // Real-time alerts will be implemented via WebSocket or SSE
    // when the backend supports it
  }, []);
};