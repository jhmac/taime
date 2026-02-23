import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useGeolocation } from '@/hooks/useGeolocation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';
import type { TimeEntry, WorkLocation } from '@shared/schema';
import { MapPin, Shield, AlertTriangle, CheckCircle2, XCircle, Wifi, ExternalLink } from 'lucide-react';

export default function TimeClockWidget() {
  const { user } = useAuth();
  const { position, getCurrentPosition, loading: locationLoading, error: locationError } = useGeolocation();
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

  const { data: activeTimeEntry, isLoading: activeEntryLoading } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: 30000,
  });

  const { data: workLocations = [] } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  useEffect(() => {
    if (workLocations.length > 0 && !hasRequestedLocation.current) {
      hasRequestedLocation.current = true;
      if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
          setLocationPermission(result.state);
          result.onchange = () => {
            setLocationPermission(result.state);
            if (result.state === 'granted' && !position) {
              getCurrentPosition().catch(() => {});
            }
          };
          if (result.state === 'granted' || result.state === 'prompt') {
            getCurrentPosition().then(() => {
              setLocationPermission('granted');
            }).catch(() => {});
          }
        }).catch(() => {
          getCurrentPosition().then(() => {
            setLocationPermission('granted');
          }).catch(() => {});
        });
      } else {
        getCurrentPosition().then(() => {
          setLocationPermission('granted');
        }).catch(() => {});
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
    if (!position || workLocations.length === 0) return;

    const checkGeofence = async () => {
      try {
        if (activeTimeEntry) {
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
            toast({
              title: "Auto Clocked Out",
              description: "You were automatically clocked out because you left the work location.",
              variant: "destructive",
            });
            setGeofenceStatus(null);
            return;
          }

          const isNearBoundary = result.isInWorkLocation && 
            result.boundaryProximity != null && result.boundaryProximity > 0.8;
          
          if (!result.isInWorkLocation && !exitAlertShown.current) {
            exitAlertShown.current = true;
            const graceMin = result.geofenceExitInfo?.graceMinutes || 5;
            toast({
              title: "You've Left the Work Area",
              description: `Please return or clock out. You will be auto clocked out in ${graceMin} minutes if you don't return.`,
              variant: "destructive",
            });
          } else if (result.isInWorkLocation) {
            exitAlertShown.current = false;
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
      clockOutMutation.mutate(activeTimeEntry.id);
    } else {
      if (workLocations.length === 0) {
        clockInMutation.mutate({
          locationId: '',
          latitude: 0,
          longitude: 0,
        });
        return;
      }

      if (!position) {
        try {
          await getCurrentPosition();
        } catch (err: any) {
          toast({
            title: "Location Access Needed",
            description: "Please allow location access in your browser or device settings to clock in. On iPhone: Settings > Privacy > Location Services.",
            variant: "destructive",
          });
        }
        return;
      }

      try {
        const locationCheck = await apiRequest('POST', '/api/geofence/check', {
          latitude: position.latitude,
          longitude: position.longitude,
        });

        const result = await locationCheck.json();
        
        if (!result.isInWorkLocation) {
          logClockEvent('geofence-denied', undefined, {
            latitude: position.latitude,
            longitude: position.longitude,
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
          latitude: position.latitude,
          longitude: position.longitude,
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

  return (
    <Card className="mb-4" data-testid="time-clock-widget">
      <CardHeader>
        <CardTitle className="text-base flex items-center">
          <i className="fas fa-clock text-primary mr-2"></i>
          Time Clock
        </CardTitle>
      </CardHeader>
      <CardContent className="text-center space-y-4">
        {/* Current Time Display */}
        <div>
          <div className="text-3xl font-bold text-foreground" data-testid="current-time">
            {formatTime(currentTime)}
          </div>
          <div className="text-muted-foreground text-sm" data-testid="current-date">
            {formatDate(currentTime)}
          </div>
        </div>

        {/* Active Session Info */}
        {activeTimeEntry && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm font-medium text-green-800">Currently Clocked In</p>
            <p className="text-xs text-green-700">
              Started at {new Date(activeTimeEntry.clockInTime).toLocaleTimeString('en-US', { hour12: true })}
            </p>
            <p className="text-sm font-bold text-green-800 mt-1">
              Duration: {getActiveWorkDuration()}
            </p>
          </div>
        )}

        {/* Location Permission Notice */}
        {workLocations.length > 0 && (locationPermission === 'denied' || (locationError && !position)) && !activeTimeEntry && (
          <div
            className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 cursor-pointer active:bg-red-100 dark:active:bg-red-950/50 transition-colors"
            onClick={() => {
              getCurrentPosition()
                .then(() => {
                  setLocationPermission('granted');
                  toast({ title: 'Location enabled', description: 'Location access has been granted.' });
                })
                .catch(() => {
                  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                  const isAndroid = /Android/.test(navigator.userAgent);
                  let instructions = '';
                  if (isIOS) {
                    instructions = 'Open your iPhone Settings app → Privacy & Security → Location Services → find your browser (Safari/Chrome) and set to "While Using". Then come back and refresh this page.';
                  } else if (isAndroid) {
                    instructions = 'Open your phone Settings app → Apps → find your browser → Permissions → Location → set to "Allow". Then come back and refresh this page.';
                  } else {
                    instructions = 'Click the lock/info icon in your browser address bar → find Location → set to "Allow", then reload the page.';
                  }
                  toast({
                    title: 'How to Enable Location',
                    description: instructions,
                    duration: 12000,
                  });
                });
            }}
          >
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
              <div className="text-left flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Location Access Required</p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  Tap here to enable location services for clocking in.
                </p>
              </div>
              <ExternalLink className="h-4 w-4 text-red-400 dark:text-red-500 shrink-0" />
            </div>
          </div>
        )}

        {/* Pre Clock-In Geofence Status */}
        {!activeTimeEntry && geofenceStatus && workLocations.length > 0 && (
          <div className={`rounded-lg p-3 text-sm ${
            geofenceStatus.isInWorkLocation
              ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'
              : 'bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800'
          }`}>
            <div className="flex items-center gap-2">
              {geofenceStatus.isInWorkLocation ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
              )}
              <div className="text-left flex-1">
                <p className={`font-medium ${
                  geofenceStatus.isInWorkLocation ? 'text-green-800 dark:text-green-300' : 'text-orange-800 dark:text-orange-300'
                }`}>
                  {geofenceStatus.isInWorkLocation
                    ? `At ${geofenceStatus.location?.name || 'Work Location'}`
                    : 'Outside Work Location'}
                </p>
                <p className={`text-xs ${
                  geofenceStatus.isInWorkLocation ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
                }`}>
                  {geofenceStatus.isInWorkLocation
                    ? 'You are inside the geofence — ready to clock in'
                    : geofenceStatus.nearestLocation
                      ? `Nearest: ${geofenceStatus.nearestLocation.name} (${Math.round(geofenceStatus.nearestLocation.distance)}m away)`
                      : 'You must be at a work location to clock in'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Clock In/Out Button */}
        <Button
          onClick={handleClockAction}
          disabled={clockInMutation.isPending || clockOutMutation.isPending || activeEntryLoading || (locationPermission === 'denied' && workLocations.length > 0 && !activeTimeEntry)}
          className={`w-full py-4 text-lg font-semibold transition-colors ${
            activeTimeEntry
              ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
          data-testid="clock-action-button"
        >
          {clockInMutation.isPending || clockOutMutation.isPending ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              Processing...
            </>
          ) : activeTimeEntry ? (
            <>
              <i className="fas fa-stop mr-2"></i>
              Clock Out
            </>
          ) : locationLoading ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              Getting Location...
            </>
          ) : (
            <>
              <i className="fas fa-play mr-2"></i>
              Clock In
            </>
          )}
        </Button>

        {/* Geofence Status (while clocked in) */}
        {activeTimeEntry && geofenceStatus && (
          <div className={`rounded-lg p-3 text-sm ${
            !geofenceStatus.isInWorkLocation
              ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800'
              : geofenceStatus.boundaryWarning
                ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
                : 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800'
          }`}>
            <div className="flex items-center gap-2">
              {!geofenceStatus.isInWorkLocation ? (
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
              ) : geofenceStatus.boundaryWarning ? (
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
              )}
              <div className="text-left flex-1">
                <p className={`font-medium ${
                  !geofenceStatus.isInWorkLocation ? 'text-red-800 dark:text-red-300' :
                  geofenceStatus.boundaryWarning ? 'text-amber-800 dark:text-amber-300' :
                  'text-blue-800 dark:text-blue-300'
                }`}>
                  {!geofenceStatus.isInWorkLocation ? 'Outside Work Zone — Clock Out Required' :
                   geofenceStatus.boundaryWarning ? 'Near Boundary' :
                   `Inside ${geofenceStatus.location?.name || 'Work Zone'}`}
                </p>
                <p className={`text-xs ${
                  !geofenceStatus.isInWorkLocation ? 'text-red-600 dark:text-red-400' :
                  geofenceStatus.boundaryWarning ? 'text-amber-600 dark:text-amber-400' :
                  'text-blue-600 dark:text-blue-400'
                }`}>
                  {!geofenceStatus.isInWorkLocation
                    ? geofenceStatus.geofenceExitInfo?.graceRemaining != null
                      ? `Auto clock-out in ${Math.ceil(geofenceStatus.geofenceExitInfo.graceRemaining / 60)} min ${geofenceStatus.geofenceExitInfo.graceRemaining % 60}s. Return to work area or clock out now.`
                      : 'You have left the work area. Please return or clock out.'
                    : geofenceStatus.boundaryWarning
                      ? 'You are near the edge of your work area'
                      : 'Geofence verified'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Location Status */}
        {!activeTimeEntry && !geofenceStatus && workLocations.length > 0 && (
          <div className="flex items-center justify-center space-x-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground" data-testid="location-status">
              {locationLoading ? 'Getting location...' : !position ? 'Tap Clock In to enable location' : 'Checking geofence...'}
            </span>
          </div>
        )}
        {!activeTimeEntry && workLocations.length === 0 && (
          <div className="flex items-center justify-center space-x-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground" data-testid="location-status">
              No locations configured
            </span>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-muted-foreground text-xs">Today's Hours</p>
            <p className="text-lg font-bold text-foreground" data-testid="today-hours">
              {getActiveWorkDuration() || '0h 0m'}
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-muted-foreground text-xs">Break Time</p>
            <p className="text-lg font-bold text-foreground" data-testid="break-time">
              {activeTimeEntry ? `${activeTimeEntry.breakMinutes || 0}m` : '0m'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
