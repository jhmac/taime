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

function cachePermission(state: PermissionState | 'unsupported' | 'unknown') {
  try {
    if (state === 'granted' || state === 'denied') {
      localStorage.setItem('taime_geo_perm', state);
    }
  } catch {}
}

export function useGeolocation() {
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
          // If we already have a cached grant, skip the OS permission check so
          // we don't flash a redundant dialog on every call.  Only query the OS
          // when the cached state is unknown/prompt (first-time or revoked).
          let permLocation: string = readCachedPermission();
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
    if (Capacitor.isNativePlatform()) {
      // Skip the OS round-trip entirely when we already have a cached grant —
      // checkPermissions() does not show a dialog, but skipping it avoids any
      // timing edge-case where the OS returns 'prompt' during app transitions
      // (while the real state is still granted).  On denial or first-launch
      // the cache is empty/denied, so we still ask the OS.
      if (readCachedPermission() === 'granted') {
        return;
      }
      Geolocation.checkPermissions().then((result) => {
        const loc = result.location;
        if (loc === 'granted') {
          setPermissionState('granted');
        } else if (loc === 'denied') {
          setPermissionState('denied');
          setError({ code: 1, message: getErrorMessage(1) });
        } else {
          setPermissionState('prompt');
        }
      }).catch(() => {
        setPermissionState('unknown');
      });
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

    let permissionStatus: PermissionStatus | null = null;

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        permissionStatus = result;
        // Don't downgrade a previously-cached 'granted' to 'prompt'.
        // The Permissions API can return 'prompt' when the origin changes
        // (e.g. Replit preview URLs) or when the browser session is fresh,
        // even though the user already explicitly allowed access.  Keeping
        // the cached 'granted' prevents the in-app permission nudge banner
        // from appearing; the actual browser grant is confirmed the next
        // time the user triggers Clock In.
        if (result.state !== 'prompt' || readCachedPermission() !== 'granted') {
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
      }).catch(() => {
        setPermissionState('unknown');
      });
    }

    return () => {
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

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
