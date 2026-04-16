import { Capacitor } from '@capacitor/core';
import { NativeSettings, AndroidSettings, IOSSettings } from 'capacitor-native-settings';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { MapPin, Settings, ExternalLink } from 'lucide-react';

interface LocationHelpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Platform =
  | 'native-ios'
  | 'native-android'
  | 'web-ios'
  | 'web-android'
  | 'web-desktop';

function detectPlatform(): Platform {
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'android' ? 'native-android' : 'native-ios';
  }
  // Modern iPadOS (13+) reports a desktop Safari UA — detect via touch capability.
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (isIOS) return 'web-ios';
  if (/Android/.test(navigator.userAgent)) return 'web-android';
  return 'web-desktop';
}

interface StepConfig {
  heading: string;
  description: string;
  steps: string[];
  tip?: string;
}

const PLATFORM_STEPS: Record<Platform, StepConfig> = {
  'native-ios': {
    heading: 'Enable Location on iPhone',
    description: 'Open iPhone Settings and allow Taime to use your location.',
    steps: [
      'Press the Home button or swipe up to leave Taime.',
      'Open the Settings app (grey icon with gears).',
      'Scroll down and tap "Taime".',
      'Tap "Location".',
      'Select "While Using the App".',
      'Switch back to Taime — location is now enabled.',
    ],
    tip: 'Also make sure Location Services is turned on at the top of Settings → Privacy & Security → Location Services.',
  },
  'native-android': {
    heading: 'Enable Location on Android',
    description: 'Open Android Settings and allow Taime to use your location.',
    steps: [
      'Press the Home or Recent Apps button to leave Taime.',
      'Open the Settings app.',
      'Tap "Apps" (or "App Management" on some phones).',
      'Find and tap "Taime" in the list.',
      'Tap "Permissions" then tap "Location".',
      'Choose "Allow only while using the app".',
      'Return to Taime — location is now enabled.',
    ],
    tip: 'If you don\'t see "Location" under Permissions, search for Taime in Settings search.',
  },
  'web-ios': {
    heading: 'Enable Location in Safari (iPhone)',
    description: 'Allow this website to access your location through Safari settings.',
    steps: [
      'Press the Home button or swipe up to leave your browser.',
      'Open the Settings app.',
      'Scroll down and tap "Safari".',
      'Scroll to "Settings for Websites" and tap "Location".',
      'Find this site in the list and tap "Allow".',
      'Return to Safari and refresh the page.',
    ],
    tip: 'If you use Chrome or another browser, go to Settings → [Browser App] → Location instead.',
  },
  'web-android': {
    heading: 'Enable Location in Your Browser',
    description: 'Allow this website to access your location through your browser.',
    steps: [
      'Tap the lock icon (🔒) or info icon (ⓘ) in the address bar at the top.',
      'Tap "Permissions" or "Site settings".',
      'Tap "Location".',
      'Change the setting to "Allow".',
      'The page will reload — location is now enabled.',
    ],
    tip: 'On some Android browsers, tap the three-dot (⋮) menu → Settings → Site settings → Location instead.',
  },
  'web-desktop': {
    heading: 'Enable Location in Your Browser',
    description: 'Allow this website to access your location through your browser settings.',
    steps: [
      'Click the lock icon (🔒) or info icon (ⓘ) at the left side of the address bar.',
      'Find "Location" in the permissions list.',
      'Change the setting from "Blocked" to "Allow".',
      'Refresh the page — location is now enabled.',
    ],
    tip: 'In Firefox: click the crossed-out camera/location icon in the address bar → Blocked Temporarily → Unblock. In Safari: Safari menu → Settings → Websites → Location → set this site to Allow.',
  },
};

export default function LocationHelpSheet({ open, onOpenChange }: LocationHelpSheetProps) {
  const platform = detectPlatform();
  const config = PLATFORM_STEPS[platform];
  const { toast } = useToast();

  async function openDeviceSettings() {
    try {
      if (platform === 'native-ios') {
        await NativeSettings.openIOS({ option: IOSSettings.App });
      } else if (platform === 'native-android') {
        await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
      }
    } catch {
      toast({
        title: 'Could not open Settings',
        description: 'Please open your device Settings app manually and find Taime.',
        variant: 'destructive',
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-8"
      >
        <SheetHeader className="text-left pb-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="rounded-full bg-orange-100 dark:bg-orange-900/30 p-2">
              <MapPin className="h-5 w-5 text-orange-500" />
            </div>
            <SheetTitle className="text-base font-bold">{config.heading}</SheetTitle>
          </div>
          <SheetDescription className="text-sm text-muted-foreground leading-relaxed">
            {config.description}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-3">
          {config.steps.map((step, index) => (
            <div key={index} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-orange-500 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                {index + 1}
              </span>
              <p className="text-sm leading-relaxed text-foreground pt-0.5">{step}</p>
            </div>
          ))}
        </div>

        {config.tip && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
            <Settings className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">{config.tip}</p>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {(platform === 'native-ios' || platform === 'native-android') && (
            <Button
              onClick={() => { void openDeviceSettings(); }}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl"
            >
              <Settings className="h-4 w-4 mr-2" />
              Open Settings
            </Button>
          )}
          <Button
            variant={platform === 'native-ios' || platform === 'native-android' ? 'outline' : 'default'}
            onClick={() => onOpenChange(false)}
            className={
              platform === 'native-ios' || platform === 'native-android'
                ? 'w-full rounded-xl'
                : 'w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl'
            }
          >
            Got it
          </Button>
          {platform === 'web-desktop' && (
            <Button
              variant="outline"
              className="w-full rounded-xl text-sm"
              onClick={() => window.open('https://support.google.com/chrome/answer/142065', '_blank')}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              More browser help
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
