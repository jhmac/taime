import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { MapPin, Clock, X } from 'lucide-react';
import type { TimeEntry, WorkLocation } from '@shared/schema';

const DISMISSED_KEY = 'smartClockDismissed';
const SNOOZE_KEY = 'smartClockSnoozedUntil';
const SNOOZE_DURATION_MS = 15 * 60 * 1000;

function isSnoozed(): boolean {
  const until = sessionStorage.getItem(SNOOZE_KEY);
  if (!until) return false;
  return Date.now() < parseInt(until, 10);
}

export default function SmartClockPrompt() {
  const { user } = useAuth();
  const { getCurrentPosition } = useGeolocation();
  const { settings } = useCompanySettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISSED_KEY) === '1');
  const [snoozed, setSnoozed] = useState(isSnoozed);
  const [nearbyLocation, setNearbyLocation] = useState<{ id: string; name: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const snoozeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      sessionStorage.removeItem(DISMISSED_KEY);
      sessionStorage.removeItem(SNOOZE_KEY);
      setDismissed(false);
      setSnoozed(false);
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
    if (settings?.enableSmartClockPrompt && !activeTimeEntry && workLocations.length > 0 && !checked && !dismissed && !snoozed) {
      const timer = setTimeout(() => {
        checkLocation();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [settings?.enableSmartClockPrompt, activeTimeEntry, workLocations.length, checked, dismissed, snoozed, checkLocation]);

  useEffect(() => {
    if (!settings?.enableSmartClockPrompt) return;

    const COOLDOWN_KEY = 'smartClockLastCheck';
    const COOLDOWN_MS = 10 * 60 * 1000;

    const handleFocusReturn = () => {
      if (!document.hidden) {
        if (sessionStorage.getItem(DISMISSED_KEY) === '1') {
          return;
        }
        if (isSnoozed()) {
          return;
        }
        const lastCheck = sessionStorage.getItem(COOLDOWN_KEY);
        if (lastCheck && Date.now() - parseInt(lastCheck) < COOLDOWN_MS) {
          return;
        }
        setChecked(false);
        setNearbyLocation(null);
      }
    };

    document.addEventListener('visibilitychange', handleFocusReturn);
    return () => document.removeEventListener('visibilitychange', handleFocusReturn);
  }, [settings?.enableSmartClockPrompt]);

  useEffect(() => {
    return () => {
      if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    };
  }, []);

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
    sessionStorage.setItem(DISMISSED_KEY, '1');
    sessionStorage.removeItem(SNOOZE_KEY);
    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    setDismissed(true);
    setNearbyLocation(null);
  };

  const handleSnooze = () => {
    const snoozeUntil = Date.now() + SNOOZE_DURATION_MS;
    sessionStorage.setItem(SNOOZE_KEY, String(snoozeUntil));
    setSnoozed(true);
    setNearbyLocation(null);
    setChecked(false);

    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    snoozeTimerRef.current = setTimeout(() => {
      if (sessionStorage.getItem(DISMISSED_KEY) === '1') return;
      sessionStorage.removeItem(SNOOZE_KEY);
      setSnoozed(false);
    }, SNOOZE_DURATION_MS);
  };

  if (!settings?.enableSmartClockPrompt || !nearbyLocation || activeTimeEntry || dismissed || snoozed) {
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
            <Button
              onClick={handleSnooze}
              disabled={clockInMutation.isPending}
              className="bg-white/20 hover:bg-white/30 text-white rounded-lg h-10 px-4 font-medium"
            >
              Later
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
