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
      if (waitingSW) {
        // Tell the SW to skip its waiting phase and activate immediately.
        // sw.js also calls self.skipWaiting() on install, so the SW may
        // have already activated by the time the user taps "Reload" — in
        // that case the SKIP_WAITING message is a harmless no-op.
        waitingSW.postMessage({ type: 'SKIP_WAITING' });
      }
      // The controllerchange listener in main.tsx auto-reloads when the SW
      // takes over.  Calling reload() here as well covers the race where
      // controllerchange already fired before this handler ran (i.e. the SW
      // activated itself via self.skipWaiting() on install, then the user
      // saw the toast and clicked Reload).
      window.location.reload();
    }

    const { dismiss } = toast({
      title: "Update available",
      description: "A new version of Taime is ready.",
      duration: Infinity,
      action: createElement(ToastAction, { altText: "Reload to update", onClick: applyUpdate }, "Reload") as any,
    });

    return () => {
      dismiss();
    };
  }, [waitingSW]);
}
