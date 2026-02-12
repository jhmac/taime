import { useState, useEffect } from "react";
import { WifiOff, Wifi } from "lucide-react";

export default function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showSyncing, setShowSyncing] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      setShowSyncing(false);
    };

    const handleOnline = () => {
      setIsOffline(false);
      setShowSyncing(true);
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SYNC_PENDING' });
      }
      setTimeout(() => setShowSyncing(false), 3000);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline && !showSyncing) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] px-4 py-2 text-center text-sm font-medium transition-all duration-300 ${
        isOffline
          ? "bg-yellow-500 text-yellow-950"
          : "bg-green-500 text-green-950"
      }`}
    >
      <div className="flex items-center justify-center gap-2">
        {isOffline ? (
          <>
            <WifiOff className="h-4 w-4" />
            <span>You're offline. Changes will be saved and synced when you're back online.</span>
          </>
        ) : (
          <>
            <Wifi className="h-4 w-4" />
            <span>Back online! Syncing...</span>
          </>
        )}
      </div>
    </div>
  );
}
