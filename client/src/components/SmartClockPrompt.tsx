import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { MapPin, Clock, X } from 'lucide-react';
import type { TimeEntry, WorkLocation } from '@shared/schema';

export default function SmartClockPrompt() {
  const { user } = useAuth();
  const { getCurrentPosition } = useGeolocation();
  const { settings } = useCompanySettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [nearbyLocation, setNearbyLocation] = useState<{ id: string; name: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

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
      setChecked(true);
      sessionStorage.setItem('smartClockLastCheck', String(Date.now()));
    } catch (err) {
      console.warn('[SmartClockPrompt] Location check failed:', err);
    } finally {
      setChecking(false);
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

    const COOLDOWN_KEY = 'smartClockLastCheck';
    const COOLDOWN_MS = 10 * 60 * 1000;

    const handleFocusReturn = () => {
      if (!document.hidden) {
        const lastCheck = sessionStorage.getItem(COOLDOWN_KEY);
        if (lastCheck && Date.now() - parseInt(lastCheck) < COOLDOWN_MS) {
          return;
        }
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
    <div className="fixed top-4 left-0 right-0 z-[70] animate-in slide-in-from-top-5 duration-300 pointer-events-none">
      <div className="max-w-md mx-auto px-4 pointer-events-auto">
        <div className="bg-blue-600 text-white rounded-xl p-4 shadow-xl relative overflow-hidden">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0 pr-6">
              <p className="font-semibold text-[15px] leading-snug">You're at {nearbyLocation.name}</p>
              <p className="text-sm text-white/90 mt-0.5">Would you like to clock in?</p>
            </div>
            <button 
              onClick={handleDismiss}
              className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-white/70" />
            </button>
          </div>
          
          <div className="mt-4 flex gap-3">
            <Button
              onClick={handleClockIn}
              disabled={clockInMutation.isPending}
              className="flex-1 bg-white text-blue-600 hover:bg-white/90 rounded-lg h-10 font-bold flex items-center justify-center gap-2"
            >
              <Clock className="w-4 h-4" />
              {clockInMutation.isPending ? 'Clocking in...' : 'Clock In'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
