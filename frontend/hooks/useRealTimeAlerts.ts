import { useEffect } from 'react';
import { useToast } from '../components/ToastSystem';

export const useRealTimeAlerts = (active: boolean) => {
  const { toast } = useToast();

  useEffect(() => {
    if (!active) return;

    // Simulate random incoming threats
    const interval = setInterval(() => {
      const random = Math.random();
      
      // 30% chance of a toast every cycle
      if (random > 0.7) {
        const isCritical = random > 0.9;
        
        if (isCritical) {
          toast({
            title: "AMENAZA CRÍTICA DETECTADA",
            description: "Tráfico saliente anómalo detectado en puerto 445. Origen: 10.0.4.55",
            variant: "destructive"
          });
        } else {
          toast({
            title: "Nuevo Evento de Seguridad",
            description: "Intento de login sospechoso bloqueado desde IP 192.168.1.105",
            variant: "info"
          });
        }
      }
    }, 15000); // Check every 15 seconds

    return () => clearInterval(interval);
  }, [active, toast]);
};