import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

const DISMISSED_KEY = "pwa-install-dismissed";
const ACTIVE_DELAY_MS = 30 * 1000;

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const nav = navigator as NavigatorWithStandalone;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      nav.standalone === true;

    if (isStandalone) return;

    if (localStorage.getItem(DISMISSED_KEY)) return;

    let timer: ReturnType<typeof setTimeout>;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      timer = setTimeout(() => {
        setShowBanner(true);
      }, ACTIVE_DELAY_MS);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      clearTimeout(timer);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setShowBanner(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[200] flex items-center gap-3 rounded-xl bg-primary text-primary-foreground px-4 py-3 shadow-lg md:left-auto md:right-4 md:max-w-sm">
      <Download className="h-5 w-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">Add to Home Screen</p>
        <p className="text-xs opacity-80 leading-tight mt-0.5">Install Taime for quick access</p>
      </div>
      <button
        onClick={handleInstall}
        className="shrink-0 rounded-lg bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-semibold transition-colors"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 p-1 rounded-lg hover:bg-white/20 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
