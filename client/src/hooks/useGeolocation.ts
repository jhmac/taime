import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export interface GeolocationPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface GeolocationError {
  code: number;
  message: string;
}

function capacitorErrCode(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return 2;
}

function readCachedPermission(): PermissionState | 'unknown' {
  try {
    const v = localStorage.getItem('taime_geo_perm');
    if (v === 'granted' || v === 'denied') return v;
  } catch {}
  return 'unknown';
}

// Module-level Set: tracks which user IDs have already been hydrated this
// session so concurrent mounts skip duplicate fetches, yet an account switch
// (different userId) triggers a fresh hydration for the new user.
const serverHydrationDoneFor = new Set<string>();

async function hydrateFromServer(
  userId: string,
  setPermissionState: (s: PermissionState | 'unsupported' | 'unknown') => void,
  setError: (e: { code: number; message: string } | null) => void,
): Promise<void> {
  // Already hydrated for this user this session — skip.
  if (serverHydrationDoneFor.has(userId)) return;

  // Optimistically claim the slot so concurrent callers don't duplicate the
  // fetch.  We remove it again if the fetch fails so the next mount can retry.
  serverHydrationDoneFor.add(userId);

  try {
    const res = await fetch('/api/location-permission', { credentials: 'include' });
    if (!res.ok) {
      // Non-2xx (e.g. 401 on logout race) — release slot so next mount retries.
      serverHydrationDoneFor.delete(userId);
      return;
    }
    const data = await res.json();
    const serverStatus: string | null = data.status ?? null;

    if (serverStatus !== 'granted' && serverStatus !== 'denied') return;

    // Only write to localStorage when it has no existing value — never overwrite
    // a fresher local choice with a potentially older server value.
    const cached = readCachedPermission();
    if (cached !== 'unknown') return;

    cachePermission(serverStatus as PermissionState);
    setPermissionState(serverStatus as PermissionState);

    if (serverStatus === 'denied') {
      setError({ code: 1, message: getErrorMessage(1) });
    }

    // On Capacitor: verify the OS hasn't silently revoked the permission since
    // we last wrote "granted" to the server.  We do this in the background so
    // it never blocks rendering.
    if (serverStatus === 'granted' && Capacitor.isNativePlatform()) {
      Geolocation.checkPermissions().then((result) => {
        if (result.location === 'denied') {
          cachePermission('denied');
          setPermissionState('denied');
          setError({ code: 1, message: getErrorMessage(1) });
          // Sync the corrected state back to the server (fire-and-forget).
          fetch('/api/location-permission', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'denied' }),
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  } catch {
    // Release the slot on unexpected errors so the next mount can retry.
    serverHydrationDoneFor.delete(userId);
  }
}

function cachePermission(state: PermissionState | 'unsupported' | 'unknown') {
  try {
    if (state === 'granted' || state === 'denied') {
      localStorage.setItem('taime_geo_perm', state);
    }
  } catch {}
}

export function useGeolocation(userId?: string) {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<GeolocationError | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissionState, setPermissionStateRaw] = useState<PermissionState | 'unsupported' | 'unknown'>(
    readCachedPermission
  );
  // Stable flag: was permission ever granted in a previous session?
  // Set once at mount from localStorage — never flips back to false.
  // Used by consumers to suppress the in-app permission nudge banner for
  // returning users who have already agreed to location access.
  const [hadPreviousGrant] = useState(() => readCachedPermission() === 'granted');

  const setPermissionState = (state: PermissionState | 'unsupported' | 'unknown') => {
    cachePermission(state);
    setPermissionStateRaw(state);
  };

  const capacitorWatchIdRef = useRef<string | null>(null);

  const getCurrentPosition = useCallback((): Promise<GeolocationPosition> => {
    if (Capacitor.isNativePlatform()) {
      setLoading(true);
      setError(null);
      return (async () => {
        try {
          // Fast-path for cached permission states so we never call into the OS
          // unnecessarily — requestPermissions() in particular shows the native dialog.
          // - 'denied':  user explicitly denied previously; short-circuit to avoid
          //              any OS interaction.  The user must clear the app's setting
          //              manually (OS-level) for this to change.
          // - 'granted': trust the cache; skip the OS round-trip entirely.
          // - 'unknown': no saved state — query the OS to learn the real state.
          let permLocation: string = readCachedPermission();
          if (permLocation === 'denied') {
            const geoError: GeolocationError = { code: 1, message: getErrorMessage(1) };
            setError(geoError);
            setPermissionState('denied');
            setLoading(false);
            throw geoError;
          }
          if (permLocation !== 'granted') {
            let permStatus = await Geolocation.checkPermissions();
            if (permStatus.location === 'prompt' || permStatus.location === 'prompt-with-rationale') {
              permStatus = await Geolocation.requestPermissions({ permissions: ['location'] });
            }
            permLocation = permStatus.location;
          }
          if (permLocation === 'denied') {
            const geoError: GeolocationError = { code: 1, message: getErrorMessage(1) };
            setError(geoError);
            setPermissionState('denied');
            setLoading(false);
            throw geoError;
          }

          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 5000,
          });

          const result: GeolocationPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          };
          setPosition(result);
          setLoading(false);
          setError(null);
          setPermissionState('granted');
          return result;
        } catch (err) {
          const code = capacitorErrCode(err);
          const geoError: GeolocationError = { code, message: getErrorMessage(code) };
          setError(geoError);
          setLoading(false);
          if (code === 1) setPermissionState('denied');
          throw geoError;
        }
      })();
    }

    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      setLoading(true);
      setError(null);

      const makePos = (p: globalThis.GeolocationPosition): GeolocationPosition => ({
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracy: p.coords.accuracy,
        timestamp: p.timestamp,
      });

      const onSuccess = (p: globalThis.GeolocationPosition) => {
        const pos = makePos(p);
        setPosition(pos);
        setLoading(false);
        setError(null);
        setPermissionState('granted');
        resolve(pos);
      };

      navigator.geolocation.getCurrentPosition(
        onSuccess,
        (highAccErr) => {
          navigator.geolocation.getCurrentPosition(
            onSuccess,
            (fallbackErr) => {
              const geoError: GeolocationError = {
                code: fallbackErr.code,
                message: getErrorMessage(fallbackErr.code),
              };
              setError(geoError);
              setLoading(false);
              if (fallbackErr.code === 1) {
                setPermissionState('denied');
              }
              reject(geoError);
            },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
          );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    });
  }, []);

  const watchPosition = useCallback((callback: (position: GeolocationPosition) => void): number => {
    if (Capacitor.isNativePlatform()) {
      Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
        (pos, err) => {
          if (err) {
            const code = capacitorErrCode(err);
            const geoError: GeolocationError = { code, message: getErrorMessage(code) };
            setError(geoError);
            if (code === 1) setPermissionState('denied');
            return;
          }
          if (pos) {
            const result: GeolocationPosition = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              timestamp: pos.timestamp,
            };
            setPosition(result);
            setError(null);
            setPermissionState('granted');
            callback(result);
          }
        }
      ).then((id) => {
        capacitorWatchIdRef.current = id;
      }).catch(() => {});
      return -1;
    }

    if (!navigator.geolocation) {
      setError({
        code: 0,
        message: 'Geolocation is not supported by this browser',
      });
      return -1;
    }

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    };

    return navigator.geolocation.watchPosition(
      (position) => {
        const pos: GeolocationPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        setPosition(pos);
        setError(null);
        setPermissionState('granted');
        callback(pos);
      },
      (err) => {
        const geoError: GeolocationError = {
          code: err.code,
          message: getErrorMessage(err.code),
        };
        setError(geoError);
        if (err.code === 1) {
          setPermissionState('denied');
        }
      },
      options
    );
  }, []);

  const clearWatch = useCallback((watchId: number) => {
    if (Capacitor.isNativePlatform()) {
      if (capacitorWatchIdRef.current) {
        Geolocation.clearWatch({ id: capacitorWatchIdRef.current }).catch(() => {});
        capacitorWatchIdRef.current = null;
      }
      return;
    }
    if (watchId >= 0) {
      navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionState> => {
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Geolocation.requestPermissions({ permissions: ['location'] });
        const state = result.location as PermissionState;
        setPermissionState(state);
        return state;
      } catch {
        throw new Error('Failed to request geolocation permission');
      }
    }

    if (!navigator.permissions) {
      throw new Error('Permissions API not supported');
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state;
    } catch {
      throw new Error('Failed to request geolocation permission');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    async function init() {
      // Step 1: hydrate localStorage from the server first (non-blocking but
      // awaited so the cached value is populated before the OS check reads it).
      // This prevents the OS check from reading 'unknown' and issuing a
      // redundant checkPermissions() call that would race with the hydrated state.
      await hydrateFromServer(userId ?? '__anon__', setPermissionState, setError);
      if (cancelled) return;

      if (Capacitor.isNativePlatform()) {
        // Skip the OS round-trip when we already have a definitive cached answer
        // ('granted' or 'denied').  checkPermissions() does not show a dialog
        // but could return 'prompt' during OS app-transition edge cases and
        // would incorrectly override a hydrated 'denied' with 'prompt'.
        // - 'granted': revocation guard already ran inside hydrateFromServer.
        // - 'denied':  respect it without re-querying — user explicitly denied.
        // - 'unknown': no saved state — do the OS check to learn the real state.
        if (readCachedPermission() !== 'unknown') {
          return;
        }
        try {
          const result = await Geolocation.checkPermissions();
          if (cancelled) return;
          const loc = result.location;
          if (loc === 'granted') {
            setPermissionState('granted');
          } else if (loc === 'denied') {
            setPermissionState('denied');
            setError({ code: 1, message: getErrorMessage(1) });
          } else {
            setPermissionState('prompt');
          }
        } catch {
          if (!cancelled) setPermissionState('unknown');
        }
        return;
      }

      if (!navigator.geolocation) {
        setPermissionState('unsupported');
        setError({
          code: 0,
          message: 'Geolocation is not supported by this browser',
        });
        return;
      }

      if (navigator.permissions) {
        try {
          const result = await navigator.permissions.query({ name: 'geolocation' });
          if (cancelled) return;
          permissionStatus = result;
          // Don't let the browser's 'prompt' overwrite a definitive cached state.
          // The Permissions API can return 'prompt' when the origin changes
          // (e.g. Replit preview URLs) or the browser session is fresh, even
          // though the user already explicitly allowed or denied access.
          // - Cached 'granted': keep it to suppress the in-app permission nudge.
          // - Cached 'denied':  keep it to prevent re-prompting users who denied.
          // Any non-'prompt' browser result IS the ground truth and should update.
          const cachedPermission = readCachedPermission();
          const hasDefinitiveCachedAnswer = cachedPermission === 'granted' || cachedPermission === 'denied';
          if (result.state !== 'prompt' || !hasDefinitiveCachedAnswer) {
            setPermissionState(result.state);
          }

          if (result.state === 'denied') {
            setError({
              code: 1,
              message: getErrorMessage(1),
            });
          }

          result.onchange = () => {
            setPermissionState(result.state);
            if (result.state === 'denied') {
              setError({
                code: 1,
                message: getErrorMessage(1),
              });
            } else if (result.state === 'granted') {
              setError(null);
            }
          };
        } catch {
          if (!cancelled) setPermissionState('unknown');
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
    // userId is included so the effect re-runs when the user resolves from
    // undefined to an authenticated ID (e.g. on first load).  The module-level
    // Set guard ensures we only fetch once per user per session.
  }, [userId]);

  return {
    position,
    error,
    loading,
    permissionState,
    hadPreviousGrant,
    getCurrentPosition,
    watchPosition,
    clearWatch,
    requestPermission,
  };
}

function getErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Location access denied. Please enable location permissions in your device settings.';
    case 2:
      return 'Location information is unavailable. Please check your device\'s location settings.';
    case 3:
      return 'Location request timed out. Please try again.';
    default:
      return 'An unknown error occurred while retrieving location.';
  }
}
