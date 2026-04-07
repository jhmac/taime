import { useState, useEffect, createElement } from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

export function usePWAUpdate() {
  const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let updateInterval: ReturnType<typeof setInterval> | null = null;

    function onUpdateFound() {
      if (!registration) return;
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          setWaitingSW(newWorker);
        }
      });
    }

    navigator.serviceWorker.ready.then((reg) => {
      registration = reg;

      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaitingSW(reg.waiting);
      }

      reg.addEventListener('updatefound', onUpdateFound);

      updateInterval = setInterval(() => {
        reg.update().catch(() => {});
      }, 60 * 60 * 1000);
    });

    return () => {
      if (registration) {
        registration.removeEventListener('updatefound', onUpdateFound);
      }
      if (updateInterval !== null) {
        clearInterval(updateInterval);
      }
    };
  }, []);

  useEffect(() => {
    if (!waitingSW) return;

    function applyUpdate() {
      if (!waitingSW) return;
      waitingSW.postMessage({ type: 'SKIP_WAITING' });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
    }

    const { dismiss } = toast({
      title: "Update available",
      description: "A new version of Taime is ready.",
      duration: Infinity,
      action: createElement(ToastAction, { altText: "Reload to update", onClick: applyUpdate }, "Reload"),
    });

    return () => {
      dismiss();
    };
  }, [waitingSW]);
}
