import { useState, useEffect, useCallback } from 'react';
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

export default function TimeClockWidget() {
  const { user } = useAuth();
  const { position, getCurrentPosition, loading: locationLoading } = useGeolocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentTime, setCurrentTime] = useState(new Date());

  const { data: activeTimeEntry, isLoading: activeEntryLoading } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: 30000,
  });

  const { data: workLocations = [] } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

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
        await getCurrentPosition();
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

  const getLocationStatus = () => {
    if (workLocations.length === 0) {
      return {
        icon: 'fas fa-map-marker-alt',
        text: 'No locations configured',
        color: 'text-muted-foreground',
      };
    }

    if (!position) {
      return {
        icon: 'fas fa-map-marker-alt',
        text: 'Location unavailable',
        color: 'text-red-500',
      };
    }

    const nearestLocation = workLocations.find((location: WorkLocation) => {
      if (!location.latitude || !location.longitude) return false;
      const distance = Math.sqrt(
        Math.pow(parseFloat(location.latitude) - position.latitude, 2) +
        Math.pow(parseFloat(location.longitude) - position.longitude, 2)
      ) * 111000;
      return distance <= (location.radius || 100);
    });

    if (nearestLocation) {
      return {
        icon: 'fas fa-map-marker-alt',
        text: `At ${nearestLocation.name}`,
        color: 'text-green-500',
      };
    }

    return {
      icon: 'fas fa-map-marker-alt',
      text: 'Outside work location',
      color: 'text-orange-500',
    };
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

  const locationStatus = getLocationStatus();

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

        {/* Clock In/Out Button */}
        <Button
          onClick={handleClockAction}
          disabled={clockInMutation.isPending || clockOutMutation.isPending || activeEntryLoading}
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
          ) : (
            <>
              <i className="fas fa-play mr-2"></i>
              Clock In
            </>
          )}
        </Button>

        {/* Location Status */}
        <div className="flex items-center justify-center space-x-2 text-sm">
          <i className={`${locationStatus.icon} ${locationStatus.color}`}></i>
          <span className="text-muted-foreground" data-testid="location-status">
            {locationLoading ? 'Getting location...' : locationStatus.text}
          </span>
        </div>

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
