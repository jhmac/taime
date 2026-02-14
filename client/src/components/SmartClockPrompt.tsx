import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useGeolocation } from '@/hooks/useGeolocation';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { MapPin, Clock, X } from 'lucide-react';
import type { TimeEntry, WorkLocation, CompanySettings } from '@shared/schema';

export default function SmartClockPrompt() {
  const { user } = useAuth();
  const { getCurrentPosition } = useGeolocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [nearbyLocation, setNearbyLocation] = useState<{ id: string; name: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings'],
  });

  const { data: activeTimeEntry } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
  });

  const { data: workLocations = [] } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const clockInMutation = useMutation({
    mutationFn: async (data: { locationId: string; latitude: number; longitude: number }) => {
      return await apiRequest('POST', '/api/time-entries', {
        clockInTime: new Date(),
        ...(data.locationId ? { locationId: data.locationId } : {}),
        latitude: data.latitude,
        longitude: data.longitude,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
      setNearbyLocation(null);
      toast({
        title: "Clocked In",
        description: "Successfully clocked in. Have a great workday!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Clock In Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const checkLocation = useCallback(async () => {
    if (checked || checking || !settings?.enableSmartClockPrompt || activeTimeEntry || workLocations.length === 0) {
      return;
    }

    setChecking(true);
    try {
      const position = await getCurrentPosition();
      const locationCheck = await apiRequest('POST', '/api/geofence/check', {
        latitude: position.latitude,
        longitude: position.longitude,
      });
      const result = await locationCheck.json();

      if (result.isInWorkLocation && result.location) {
        setNearbyLocation({ id: result.location.id, name: result.location.name });
      }
    } catch (err) {
    } finally {
      setChecking(false);
      setChecked(true);
    }
  }, [checked, checking, settings?.enableSmartClockPrompt, activeTimeEntry, workLocations.length, getCurrentPosition]);

  useEffect(() => {
    if (settings?.enableSmartClockPrompt && !activeTimeEntry && workLocations.length > 0 && !checked && !dismissed) {
      const timer = setTimeout(() => {
        checkLocation();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [settings?.enableSmartClockPrompt, activeTimeEntry, workLocations.length, checked, dismissed, checkLocation]);

  useEffect(() => {
    if (!settings?.enableSmartClockPrompt) return;

    const handleFocusReturn = () => {
      if (!document.hidden) {
        setChecked(false);
        setDismissed(false);
        setNearbyLocation(null);
      }
    };

    document.addEventListener('visibilitychange', handleFocusReturn);
    return () => document.removeEventListener('visibilitychange', handleFocusReturn);
  }, [settings?.enableSmartClockPrompt]);

  const handleClockIn = async () => {
    if (!nearbyLocation) return;
    try {
      const position = await getCurrentPosition();
      clockInMutation.mutate({
        locationId: nearbyLocation.id,
        latitude: position.latitude,
        longitude: position.longitude,
      });
    } catch {
      toast({
        title: "Location Error",
        description: "Could not get your location. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setNearbyLocation(null);
  };

  if (!settings?.enableSmartClockPrompt || !nearbyLocation || activeTimeEntry || dismissed) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground shadow-lg animate-in slide-in-from-top duration-300">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">You're at {nearbyLocation.name}</p>
          <p className="text-xs opacity-80">Would you like to clock in?</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleClockIn}
          disabled={clockInMutation.isPending}
          className="flex-shrink-0"
        >
          <Clock className="w-4 h-4 mr-1" />
          {clockInMutation.isPending ? 'Clocking in...' : 'Clock In'}
        </Button>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded-full hover:bg-primary-foreground/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
