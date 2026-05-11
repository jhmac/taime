import { useEffect, useCallback, useState } from "react";
import { MapPin, Settings, Loader2 } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useAuth } from "@/hooks/useAuth";
import { isNativePlatform } from "@/lib/capacitor";

interface LocationPermissionGateProps {
  children: React.ReactNode;
}

function BlockingScreen({
  onOpenSettings,
  onTryAgain,
  showInstructions,
}: {
  onOpenSettings: () => void;
  onTryAgain: () => Promise<void>;
  showInstructions: boolean;
}) {
  const [isTrying, setIsTrying] = useState(false);
  const native = isNativePlatform();

  const handleTry = async () => {
    setIsTrying(true);
    try {
      await onTryAgain();
    } finally {
      setIsTrying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-5">
            <MapPin className="h-10 w-10 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">
            Location Access Required
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This app needs location access for clocking in/out and geofence
            compliance.
            {showInstructions
              ? " You've denied location permission — please allow it to continue."
              : " Tap the button below to allow access."}
          </p>
        </div>

        {/* Primary action: try to elicit a fresh permission prompt.  On web,
            navigator.geolocation.getCurrentPosition() is the ONLY way to make
            the browser show its native dialog, so this is shown first.  Only
            falls back to manual instructions if the user has already truly
            denied at the OS/browser level. */}
        {!native && (
          <button
            onClick={handleTry}
            disabled={isTrying}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {isTrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            {isTrying ? "Requesting…" : "Allow Location Access"}
          </button>
        )}

        {/* Manual recovery instructions only show if the in-app prompt is
            confirmed blocked at the browser/OS level, or always on native
            (Capacitor sends users to system Settings). */}
        {(native || showInstructions) && (
          <div className="rounded-lg border bg-card p-4 text-left space-y-2">
            <p className="text-sm font-medium text-foreground">
              {native ? "How to enable location access:" : "Still not working? Enable it manually:"}
            </p>
            {native ? (
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Tap "Open Settings" below</li>
                <li>Find "Location" or "Location Services"</li>
                <li>Set permission to "While Using the App" or "Always"</li>
                <li>Return to the app</li>
              </ol>
            ) : (
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Tap the lock or "AA" icon in your browser's address bar</li>
                <li>Find "Location" in the site permissions</li>
                <li>Change it to "Allow"</li>
                <li>Tap the button below to reload</li>
              </ol>
            )}
          </div>
        )}

        <button
          onClick={onOpenSettings}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
            native
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-foreground hover:bg-muted/80"
          }`}
        >
          <Settings className="h-4 w-4" />
          {native ? "Open Settings" : "I've updated permissions — reload"}
        </button>
      </div>
    </div>
  );
}

function LocationPermissionGateInner({ children }: LocationPermissionGateProps) {
  const { permissionState, requestPermission, isHydrated, hadPreviousGrant } = useGeolocation();
  // Tracks whether we've actually attempted to elicit the browser's native
  // permission prompt from inside this gate.  Until we have, "denied" from
  // navigator.permissions.query() may just be a stale Safari/PWA value and
  // we should give the user a Try-Again button before sending them into
  // browser settings.
  const [hasAttemptedPrompt, setHasAttemptedPrompt] = useState(false);

  useEffect(() => {
    // Only ask for permission when:
    //  - hydration from localStorage + server (and the OS on native) has fully
    //    completed, so we know the cached state is the source of truth, AND
    //  - the user has never previously granted access (returning users who
    //    already said Yes must never see the OS dialog again on cold load), AND
    //  - the resolved permission state is genuinely 'unknown' (no cache, no
    //    server record, no OS answer).  We deliberately do NOT trigger on
    //    'prompt' here — a transient 'prompt' during init should be ignored
    //    and the user can press Clock In to elicit the real prompt on demand.
    if (!isHydrated) return;
    if (hadPreviousGrant) return;
    if (permissionState === "unknown") {
      setHasAttemptedPrompt(true);
      requestPermission().catch(() => {});
    }
  }, [permissionState, requestPermission, isHydrated, hadPreviousGrant]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    if (permissionState !== "denied") return;

    let cleanup: (() => void) | undefined;

    import("@capacitor/app").then(({ App: CapApp }) => {
      CapApp.addListener("appStateChange", (state) => {
        if (state.isActive) {
          requestPermission().catch(() => {});
        }
      }).then((handle) => {
        cleanup = () => handle.remove();
      }).catch(() => {});
    }).catch(() => {});

    return () => { cleanup?.(); };
  }, [permissionState, requestPermission]);

  const handleOpenSettings = useCallback(async () => {
    if (isNativePlatform()) {
      try {
        const { NativeSettings, AndroidSettings, IOSSettings } = await import("capacitor-native-settings");
        await NativeSettings.open({
          optionAndroid: AndroidSettings.ApplicationDetails,
          optionIOS: IOSSettings.App,
        });
      } catch {
        try {
          const { App: CapApp } = await import("@capacitor/app");
          await CapApp.openUrl({ url: "app-settings:" });
        } catch (err) {
          console.error("LocationPermissionGate: could not open settings", err);
        }
      }
    } else {
      window.location.reload();
    }
  }, []);

  const handleTryAgain = useCallback(async () => {
    setHasAttemptedPrompt(true);
    try {
      await requestPermission();
    } catch {
      // requestPermission already updates internal state on failure.
    }
  }, [requestPermission]);

  if (permissionState === "denied") {
    return (
      <BlockingScreen
        onOpenSettings={handleOpenSettings}
        onTryAgain={handleTryAgain}
        showInstructions={hasAttemptedPrompt}
      />
    );
  }

  return <>{children}</>;
}

export default function LocationPermissionGate({ children }: LocationPermissionGateProps) {
  const { user, isLoading: authLoading } = useAuth();

  const roleName = user?.role?.name;
  const isAdminOrOwner = roleName === "admin" || roleName === "owner";

  if (authLoading || isAdminOrOwner) {
    return <>{children}</>;
  }

  return <LocationPermissionGateInner>{children}</LocationPermissionGateInner>;
}
