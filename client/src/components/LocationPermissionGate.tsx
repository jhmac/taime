import { useEffect, useCallback } from "react";
import { MapPin, Settings } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useAuth } from "@/hooks/useAuth";
import { isNativePlatform } from "@/lib/capacitor";

interface LocationPermissionGateProps {
  children: React.ReactNode;
}

function BlockingScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
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
            This app requires location access for clocking in/out and geofence
            compliance. You've denied location permission, so access to the
            dashboard is blocked.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4 text-left space-y-2">
          <p className="text-sm font-medium text-foreground">
            How to enable location access:
          </p>
          {isNativePlatform() ? (
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Tap "Open Settings" below</li>
              <li>Find "Location" or "Location Services"</li>
              <li>Set permission to "While Using the App" or "Always"</li>
              <li>Return to the app</li>
            </ol>
          ) : (
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Click the lock icon in your browser's address bar</li>
              <li>Find "Location" in the site permissions</li>
              <li>Change it to "Allow"</li>
              <li>Reload the page</li>
            </ol>
          )}
        </div>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Settings className="h-4 w-4" />
          {isNativePlatform() ? "Open Settings" : "I've updated permissions — reload"}
        </button>
      </div>
    </div>
  );
}

function LocationPermissionGateInner({ children }: LocationPermissionGateProps) {
  const { permissionState, requestPermission, isHydrated, hadPreviousGrant } = useGeolocation();

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

  if (permissionState === "denied") {
    return <BlockingScreen onOpenSettings={handleOpenSettings} />;
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
