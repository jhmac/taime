import { useState, useEffect, useCallback } from 'react';

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

export function useGeolocation() {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<GeolocationError | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState | 'unsupported' | 'unknown'>('unknown');

  const getCurrentPosition = useCallback((): Promise<GeolocationPosition> => {
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

  const watchPosition = useCallback((callback: (position: GeolocationPosition) => void) => {
    if (!navigator.geolocation) {
      setError({
        code: 0,
        message: 'Geolocation is not supported by this browser',
      });
      return null;
    }

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    };

    const watchId = navigator.geolocation.watchPosition(
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

    return watchId;
  }, []);

  const clearWatch = useCallback((watchId: number) => {
    navigator.geolocation.clearWatch(watchId);
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionState> => {
    if (!navigator.permissions) {
      throw new Error('Permissions API not supported');
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state;
    } catch (error) {
      throw new Error('Failed to request geolocation permission');
    }
  }, []);

  useEffect(() => {
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
        setPermissionState(result.state);

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
    getCurrentPosition,
    watchPosition,
    clearWatch,
    requestPermission,
  };
}

function getErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Location access denied. Please enable location permissions in your browser settings.';
    case 2:
      return 'Location information is unavailable. Please check your device\'s location settings.';
    case 3:
      return 'Location request timed out. Please try again.';
    default:
      return 'An unknown error occurred while retrieving location.';
  }
}
