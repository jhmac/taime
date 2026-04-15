import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOffsiteBreadcrumbReporter } from '@/hooks/useOffsiteBreadcrumbReporter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';
import type { TimeEntry, WorkLocation, CompanySettings } from '@shared/schema';
import { MapPin, Shield, AlertTriangle, CheckCircle2, XCircle, Wifi, ExternalLink, Smartphone } from 'lucide-react';

function triggerHaptic(pattern: number | number[] = 200) {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (e) {}
}

export default function TimeClockWidget() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { position, getCurrentPosition, watchPosition, clearWatch, loading: locationLoading, error: locationError } = useGeolocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [locationPermission, setLocationPermission] = useState<string>('unknown');
  const [geofenceStatus, setGeofenceStatus] = useState<{
    isInWorkLocation: boolean;
    location: { id: string; name: string; radius?: number; geofenceType?: string } | null;
    distance: number | null;
    boundaryProximity: number | null;
    nearestLocation: { id: string; name: string; distance: number } | null;
    boundaryWarning: boolean;
    geofenceExitInfo?: {
      autoClockOutTriggered: boolean;
      graceMinutes: number;
      graceRemaining: number | null;
      exitedAt: string | null;
    } | null;
  } | null>(null);
  const previousPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const hasRequestedLocation = useRef(false);
  const exitAlertShown = useRef(false);
  const locationLostReported = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const totalGraceSecondsRef = useRef<number>(0);
  const lastMonitorTimeRef = useRef<number>(0);
  const prevActiveEntryRef = useRef<any>(null);

  const { data: activeTimeEntry, isLoading: activeEntryLoading } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: (query) => (query.state.data ? 10000 : 30000),
  });

  const { data: todayEntries = [] } = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries', 'today'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const res = await fetch(`/api/time-entries?startDate=${today.toISOString()}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: workLocations = [] } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings'],
  });

  const requireMobileClockIn = companySettings?.requireMobileClockIn ?? false;

  const { data: activeOffsiteSession } = useQuery<any>({
    queryKey: ['/api/offsite-sessions/active'],
    enabled: !!activeTimeEntry,
    refetchInterval: 30000,
  });

  const offsiteSessionWithRoute = activeOffsiteSession?.routePolyline ? activeOffsiteSession : null;
  useOffsiteBreadcrumbReporter(offsiteSessionWithRoute?.id ?? null);

  useEffect(() => {
    if (workLocations.length > 0 && !hasRequestedLocation.current) {
      hasRequestedLocation.current = true;
      const requestLocation = () => {
        getCurrentPosition()
          .then(() => setLocationPermission('granted'))
          .catch(() => {});
      };
      if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
          setLocationPermission(result.state);
          result.onchange = () => {
            setLocationPermission(result.state);
            if (result.state === 'granted' && !position) {
              requestLocation();
            }
          };
          if (result.state === 'granted' || result.state === 'prompt') {
            requestLocation();
          }
        }).catch(() => {
          requestLocation();
        });
      } else {
        requestLocation();
      }
    }
  }, [workLocations]);

  const logClockEvent = useCallback(async (eventType: string, timeEntryId?: string, metadata?: any) => {
    try {
      await apiRequest('POST', '/api/clock-events', {
        eventType,
        timeEntryId: timeEntryId || null,
        metadata: metadata || null,
      });
    } catch (e) {}
  }, []);

  const clockInMutation = useMutation({
    mutationFn: async (data: { locationId: string; latitude: number; longitude: number }) => {
      const res = await apiRequest('POST', '/api/time-entries', {
        clockInTime: new Date(),
        clockInSource: 'manual',
        ...(data.locationId ? { locationId: data.locationId } : {}),
        latitude: data.latitude,
        longitude: data.longitude,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
      queryClient.refetchQueries({ queryKey: ['/api/time-entries/active'] });
      logClockEvent('shift-start', data?.id);
      toast({
        title: "Clocked In",
        description: "Successfully clocked in. Have a great workday!",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Clock In Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (timeEntryId: string) => {
      return await apiRequest('PATCH', `/api/time-entries/${timeEntryId}`, {
        clockOutTime: new Date(),
        clockOutSource: 'manual',
      });
    },
    onSuccess: (_data, timeEntryId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
      logClockEvent('shift-end', timeEntryId);
      toast({
        title: "Clocked Out",
        description: "Successfully clocked out. Thanks for your work today!",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Clock Out Failed",
        description: "Failed to clock out. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (geofenceStatus && !geofenceStatus.isInWorkLocation && geofenceStatus.geofenceExitInfo?.graceRemaining != null && geofenceStatus.geofenceExitInfo.graceRemaining > 0) {
      if (totalGraceSecondsRef.current === 0) {
        totalGraceSecondsRef.current = geofenceStatus.geofenceExitInfo.graceRemaining;
      }
      setCountdownSeconds(geofenceStatus.geofenceExitInfo.graceRemaining);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = window.setInterval(() => {
            setCountdownSeconds(prev => {
              if (prev == null || prev <= 1) {
                if (countdownRef.current) {
                  clearInterval(countdownRef.current);
                  countdownRef.current = null;
                }
                console.log("[Geofence] Grace period expired — cleaning up and checking clock-out");
                const cleanupUI = () => {
                  setCountdownSeconds(null);
                  setGeofenceStatus(null);
                  totalGraceSecondsRef.current = 0;
                  exitAlertShown.current = false;
                  queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
                  queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
                };
                (async () => {
                  try {
                    const authHeaders: Record<string, string> = {};
                    if ((window as any).Clerk?.session) {
                      const token = await (window as any).Clerk.session.getToken();
                      if (token) authHeaders.Authorization = `Bearer ${token}`;
                    }
                    const res = await fetch('/api/time-entries/active', {
                      credentials: 'include',
                      headers: authHeaders,
                    });
                    const entry = res.ok ? await res.json() : null;
                    if (entry && entry.id && !entry.clockOutTime) {
                      console.log("[Geofence] Entry still active — forcing client clock-out");
                      clockOutMutation.mutate(entry.id, { onSettled: cleanupUI });
                    } else {
                      console.log("[Geofence] Server already clocked out — cleaning up UI");
                      cleanupUI();
                      triggerHaptic([300, 100, 300, 100, 600]);
                      toast({
                        title: "Auto Clocked Out",
                        description: "You were automatically clocked out because you left the work location.",
                        variant: "destructive",
                      });
                    }
                  } catch (err) {
                    console.error("[Geofence] Error checking active entry, forcing cleanup:", err);
                    if (activeTimeEntry) {
                      clockOutMutation.mutate(activeTimeEntry.id, { onSettled: cleanupUI });
                    } else {
                      cleanupUI();
                    }
                  }
                })();
                return 0;
              }
              return prev - 1;
            });
      }, 1000);
    } else if (geofenceStatus?.isInWorkLocation) {
      setCountdownSeconds(null);
      totalGraceSecondsRef.current = 0;
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [geofenceStatus?.isInWorkLocation, geofenceStatus?.geofenceExitInfo?.graceRemaining]);

  useEffect(() => {
    if (activeTimeEntry && workLocations.length > 0) {
      if (watchIdRef.current == null) {
        const id = watchPosition(() => {});
        if (id != null) watchIdRef.current = id;
      }
    } else {
      if (watchIdRef.current != null) {
        clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    }
    return () => {
      if (watchIdRef.current != null) {
        clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [activeTimeEntry, workLocations]);

  useEffect(() => {
    const wasClocked = prevActiveEntryRef.current != null;
    const isClocked = activeTimeEntry != null;
    prevActiveEntryRef.current = activeTimeEntry;

    if (wasClocked && !isClocked) {
      if (countdownSeconds != null || countdownRef.current) {
        console.log("[Geofence] Active entry disappeared during countdown — cleaning up UI");
        setCountdownSeconds(null);
        setGeofenceStatus(null);
        totalGraceSecondsRef.current = 0;
        exitAlertShown.current = false;
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        triggerHaptic([300, 100, 300, 100, 600]);
        toast({
          title: "Auto Clocked Out",
          description: "You were automatically clocked out because you left the work location.",
          variant: "destructive",
        });
      }
    }
  }, [activeTimeEntry]);

  useEffect(() => {
    if (activeTimeEntry && locationError && !locationLostReported.current) {
      locationLostReported.current = true;
      console.warn('[TimeClockWidget] Location permission lost while clocked in:', locationError);
      triggerHaptic([300, 100, 300, 100, 600]);
      toast({
        title: "Location Access Lost",
        description: "Your location permission was revoked. Re-enable location services to allow geofence tracking.",
        variant: "destructive",
        duration: 15000,
      });
      apiRequest('POST', '/api/geofence/location-lost', {}).catch(err => {
        console.error('Failed to report location lost:', err);
      });
    }
    if (!locationError && activeTimeEntry) {
      locationLostReported.current = false;
    }
    if (!activeTimeEntry) {
      locationLostReported.current = false;
    }
  }, [activeTimeEntry, locationError]);

  useEffect(() => {
    if (!position || workLocations.length === 0) return;

    const checkGeofence = async () => {
      try {
        if (activeTimeEntry) {
          const now = Date.now();
          if (now - lastMonitorTimeRef.current < 3000) {
            return;
          }
          lastMonitorTimeRef.current = now;

          const response = await apiRequest('POST', '/api/geofence/monitor', {
            latitude: position.latitude,
            longitude: position.longitude,
            previousLatitude: previousPositionRef.current?.lat,
            previousLongitude: previousPositionRef.current?.lng,
          });
          const result = await response.json();
          
          if (result.geofenceExitInfo?.autoClockOutTriggered) {
            queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
            queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
            exitAlertShown.current = false;
            setCountdownSeconds(null);
            totalGraceSecondsRef.current = 0;
            if (countdownRef.current) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
            }
            triggerHaptic([300, 100, 300, 100, 600]);
            toast({
              title: "Auto Clocked Out",
              description: "You were automatically clocked out because you left the work location.",
              variant: "destructive",
            });
            setGeofenceStatus(null);
            return;
          }

          if (!result.isInWorkLocation && result.geofenceExitInfo?.graceMinutes === 0 && result.geofenceExitInfo?.graceRemaining == null) {
            console.log("[Geofence] Server reports outside with no grace period — entry likely already clocked out");
            queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
            queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
            setCountdownSeconds(null);
            setGeofenceStatus(null);
            exitAlertShown.current = false;
            totalGraceSecondsRef.current = 0;
            if (countdownRef.current) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
            }
            return;
          }

          const isNearBoundary = result.isInWorkLocation && 
            result.boundaryProximity != null && result.boundaryProximity > 0.8;
          
          if (!result.isInWorkLocation && !exitAlertShown.current) {
            exitAlertShown.current = true;
            triggerHaptic([200, 100, 200, 100, 400]);
            const graceMin = result.geofenceExitInfo?.graceMinutes;
            const graceSeconds = result.geofenceExitInfo?.graceRemaining;
            const timeText = graceMin && graceMin > 0
              ? `${graceMin} minute${graceMin !== 1 ? 's' : ''}`
              : graceSeconds != null ? `${graceSeconds} seconds` : '10 seconds';
            toast({
              title: "You've Left the Work Area",
              description: `Please return or clock out. You will be auto clocked out in ${timeText} if you don't return.`,
              variant: "destructive",
            });
          } else if (result.isInWorkLocation && exitAlertShown.current) {
            exitAlertShown.current = false;
            triggerHaptic(100);
            toast({
              title: "Back in Work Zone",
              description: "You've returned to the work area. Auto clock-out cancelled.",
            });
          }

          setGeofenceStatus({
            isInWorkLocation: result.isInWorkLocation,
            location: result.location,
            distance: result.distance,
            boundaryProximity: result.boundaryProximity,
            nearestLocation: result.nearestLocation,
            boundaryWarning: isNearBoundary,
            geofenceExitInfo: result.geofenceExitInfo,
          });
        } else {
          exitAlertShown.current = false;
          const response = await apiRequest('POST', '/api/geofence/check-detailed', {
            latitude: position.latitude,
            longitude: position.longitude,
          });
          const result = await response.json();
          
          setGeofenceStatus({
            isInWorkLocation: result.isInWorkLocation,
            location: result.location ? { id: result.location.id, name: result.location.name } : null,
            distance: result.distance || null,
            boundaryProximity: null,
            nearestLocation: result.nearestLocation ? {
              id: result.nearestLocation.id,
              name: result.nearestLocation.name,
              distance: result.nearestDistance || 0,
            } : null,
            boundaryWarning: false,
          });
        }

        previousPositionRef.current = { lat: position.latitude, lng: position.longitude };
      } catch (error) {
        console.error("Geofence check failed:", error);
      }
    };

    checkGeofence();
    const interval = setInterval(checkGeofence, activeTimeEntry ? 10000 : 60000);
    return () => clearInterval(interval);
  }, [activeTimeEntry, position, workLocations]);

  const handleClockAction = async () => {
    if (activeTimeEntry) {
      clockOutMutation.mutate(activeTimeEntry.id, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
          queryClient.refetchQueries({ queryKey: ['/api/time-entries/active'] });
        }
      });
    } else {
      if (workLocations.length === 0) {
        clockInMutation.mutate({
          locationId: '',
          latitude: 0,
          longitude: 0,
        });
        return;
      }

      let currentPos = position;
      if (!currentPos) {
        try {
          const acquired = await getCurrentPosition();
          currentPos = acquired ?? null;
        } catch (err: any) {
          toast({
            title: "Location Access Needed",
            description: "Please allow location access in your browser or device settings to clock in. On iPhone: Settings > Privacy > Location Services.",
            variant: "destructive",
          });
          return;
        }
        if (!currentPos) {
          toast({
            title: "Location Not Ready",
            description: "Your location is being acquired. Please tap Clock In again.",
          });
          return;
        }
      }

      try {
        const locationCheck = await apiRequest('POST', '/api/geofence/check', {
          latitude: currentPos.latitude,
          longitude: currentPos.longitude,
        });

        const result = await locationCheck.json();
        
        if (!result.isInWorkLocation) {
          logClockEvent('geofence-denied', undefined, {
            latitude: currentPos.latitude,
            longitude: currentPos.longitude,
          });
          toast({
            title: "Location Required",
            description: "You must be at a work location to clock in.",
            variant: "destructive",
          });
          return;
        }

        clockInMutation.mutate({
          locationId: result.location.id,
          latitude: currentPos.latitude,
          longitude: currentPos.longitude,
        });
      } catch (error) {
        toast({
          title: "Location Check Failed",
          description: "Unable to verify your location. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getActiveWorkDuration = () => {
    if (!activeTimeEntry) return null;
    
    const clockInTime = new Date(activeTimeEntry.clockInTime);
    const now = new Date();
    const durationMs = now.getTime() - clockInTime.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}h ${minutes}m`;
  };

  const getOutsideDuration = () => {
    if (!geofenceStatus?.geofenceExitInfo?.exitedAt) return null;
    const exitTime = new Date(geofenceStatus.geofenceExitInfo.exitedAt);
    const now = new Date();
    const durationMs = now.getTime() - exitTime.getTime();
    const totalMinutes = Math.floor(durationMs / (1000 * 60));
    if (totalMinutes < 1) {
      const seconds = Math.floor(durationMs / 1000);
      return `${seconds}s`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  // Compute today's total hours for the stats line
  const todayTotalDisplay = (() => {
    let totalMs = 0;
    const now = new Date();
    for (const entry of todayEntries) {
      if (activeTimeEntry && entry.id === activeTimeEntry.id) continue;
      const start = new Date(entry.clockInTime);
      const end = entry.clockOutTime ? new Date(entry.clockOutTime) : now;
      totalMs += end.getTime() - start.getTime();
    }
    if (activeTimeEntry) {
      totalMs += now.getTime() - new Date(activeTimeEntry.clockInTime).getTime();
    }
    const hours = Math.floor(totalMs / (1000 * 60 * 60));
    const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  })();

  // Full-screen geofence countdown takeover — shown when outside with a grace timer
  const showCountdown = activeTimeEntry && geofenceStatus && !geofenceStatus.isInWorkLocation && countdownSeconds != null;

  return (
    <Card data-testid="time-clock-widget" className="overflow-hidden">

      {/* ── GEOFENCE COUNTDOWN — full takeover ─────────────── */}
      {showCountdown && (
        <CardContent className="p-6 text-center">
          <div className="flex flex-col items-center gap-5">
            <div className="flex items-center gap-2">
              <XCircle className="h-6 w-6 text-red-500 animate-pulse" />
              <p className="text-xl font-black text-red-700 dark:text-red-300">Outside Work Zone</p>
            </div>

            {/* Circular countdown */}
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 bg-red-500/10 rounded-full animate-ping scale-75" />
              <svg className="w-44 h-44 drop-shadow-xl" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" className="text-red-100 dark:text-red-950" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="54" fill="none" stroke="currentColor"
                  className="text-red-600 dark:text-red-500"
                  strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 54}`}
                  strokeDashoffset={`${2 * Math.PI * 54 * (1 - (countdownSeconds! / Math.max(totalGraceSecondsRef.current || countdownSeconds!, 1)))}`}
                  transform="rotate(-90 60 60)"
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-black tabular-nums text-red-700 dark:text-red-400">
                  {countdownSeconds! >= 60
                    ? `${Math.floor(countdownSeconds! / 60)}:${String(countdownSeconds! % 60).padStart(2, '0')}`
                    : countdownSeconds}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest text-red-500 mt-1">
                  {countdownSeconds! >= 60 ? 'minutes' : 'seconds'}
                </span>
              </div>
            </div>

            <p className="text-sm font-semibold text-red-700 dark:text-red-300">
              Return to the work area or clock out now
            </p>

            {/* Clock out button stays accessible */}
            <Button
              onClick={handleClockAction}
              disabled={clockOutMutation.isPending}
              className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground text-base font-bold py-4"
              data-testid="clock-action-button"
            >
              {clockOutMutation.isPending ? 'Clocking out…' : '■  Clock Out'}
            </Button>
          </div>
        </CardContent>
      )}

      {/* ── NORMAL VIEW ─────────────────────────────────────── */}
      {!showCountdown && (
        <CardContent className="p-5 text-center space-y-4">

          {/* Time — no date (dashboard header already shows it) */}
          <div
            className="text-4xl font-extrabold tabular-nums text-foreground tracking-tight"
            data-testid="current-time"
          >
            {formatTime(currentTime)}
          </div>

          {/* Clocked-in status — single clean line */}
          {activeTimeEntry && (
            <div className="flex items-center justify-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  geofenceStatus?.isInWorkLocation === false ? 'bg-red-500' : 'bg-green-500 animate-pulse'
                }`}
              />
              <span className="text-base font-semibold text-foreground">
                {geofenceStatus?.isInWorkLocation === false
                  ? `Outside zone · ${getOutsideDuration() ?? getActiveWorkDuration()}`
                  : `On shift · ${getActiveWorkDuration()}`}
              </span>
            </div>
          )}

          {/* Location permission error (pre-clock-in only) */}
          {workLocations.length > 0 && (locationPermission === 'denied' || (locationError && !position)) && !activeTimeEntry && (
            <div
              className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl p-3 cursor-pointer text-left"
              onClick={() => {
                getCurrentPosition()
                  .then(() => {
                    setLocationPermission('granted');
                    toast({ title: 'Location enabled', description: 'Location access has been granted.' });
                  })
                  .catch(() => {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                    const isAndroid = /Android/.test(navigator.userAgent);
                    let instructions = isIOS
                      ? 'Settings → Privacy & Security → Location Services → Safari → "While Using"'
                      : isAndroid
                        ? 'Settings → Apps → Browser → Permissions → Location → Allow'
                        : 'Click the lock icon in the address bar → Location → Allow';
                    toast({ title: 'Enable Location', description: instructions, duration: 12000 });
                  });
              }}
            >
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-red-700 dark:text-red-300">Location required</p>
                <p className="text-xs text-red-600 dark:text-red-400">Tap to enable location services</p>
              </div>
              <ExternalLink className="h-4 w-4 text-red-400 shrink-0" />
            </div>
          )}

          {/* Pre-clock-in geofence pill */}
          {!activeTimeEntry && geofenceStatus && workLocations.length > 0 && (
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
              geofenceStatus.isInWorkLocation
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
            }`}>
              {geofenceStatus.isInWorkLocation
                ? <><CheckCircle2 className="h-4 w-4" /> At {geofenceStatus.location?.name || 'Work Location'}</>
                : <><AlertTriangle className="h-4 w-4" /> {geofenceStatus.nearestLocation ? `${Math.round(geofenceStatus.nearestLocation.distance)}m from ${geofenceStatus.nearestLocation.name}` : 'Not at a work location'}</>
              }
            </div>
          )}

          {/* Location loading hint */}
          {!activeTimeEntry && !geofenceStatus && workLocations.length > 0 && (
            <p className="text-sm text-muted-foreground" data-testid="location-status">
              {locationLoading ? 'Getting location…' : !position ? 'Location needed to clock in' : 'Checking location…'}
            </p>
          )}

          {/* Clock In / Out button */}
          {requireMobileClockIn && !isMobile && !activeTimeEntry ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-muted bg-muted/30 p-4" data-testid="mobile-only-message">
              <Smartphone className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Mobile clock-in only</p>
              <p className="text-xs text-muted-foreground">Use your phone to clock in</p>
            </div>
          ) : (
            <Button
              onClick={handleClockAction}
              disabled={clockInMutation.isPending || clockOutMutation.isPending || activeEntryLoading || (locationPermission === 'denied' && workLocations.length > 0 && !activeTimeEntry)}
              className={`w-full text-base font-bold py-4 rounded-2xl ${
                activeTimeEntry
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground'
              }`}
              data-testid="clock-action-button"
            >
              {clockInMutation.isPending || clockOutMutation.isPending
                ? 'Processing…'
                : activeTimeEntry
                  ? '■  Clock Out'
                  : locationLoading
                    ? 'Getting location…'
                    : '▶  Clock In'}
            </Button>
          )}

          {/* Geofence status pill — clocked in, normal */}
          {activeTimeEntry && geofenceStatus && (
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
              !geofenceStatus.isInWorkLocation
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                : geofenceStatus.boundaryWarning
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
            }`}>
              {!geofenceStatus.isInWorkLocation
                ? <><XCircle className="h-4 w-4" /> Outside work zone</>
                : geofenceStatus.boundaryWarning
                  ? <><AlertTriangle className="h-4 w-4" /> Near boundary</>
                  : <><Shield className="h-4 w-4" /> {geofenceStatus.location?.name || 'Work zone'}</>
              }
            </div>
          )}

          {/* Today's hours — single stat, only show break if > 0 */}
          <div className="flex items-center justify-center gap-6 pt-1">
            <div className="text-center">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Today</p>
              <p className="text-xl font-extrabold text-foreground" data-testid="today-hours">{todayTotalDisplay}</p>
            </div>
            {activeTimeEntry && (activeTimeEntry.breakMinutes ?? 0) > 0 && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Break</p>
                <p className="text-xl font-extrabold text-foreground" data-testid="break-time">{activeTimeEntry.breakMinutes}m</p>
              </div>
            )}
          </div>

        </CardContent>
      )}

    </Card>
  );
}
