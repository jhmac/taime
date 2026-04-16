import type { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT: Set TAIME_PRODUCTION_URL to your deployed Replit app URL before running
// `npx cap sync` or building the native projects.  e.g.
//   TAIME_PRODUCTION_URL=https://taime.replit.app npx cap sync
//
// Using server.url routes ALL webview traffic (frontend + /api/* calls) through
// your deployed backend, so relative /api/... fetch URLs work correctly on device.
// Without this, API calls resolve against the local webview origin and fail.
const PRODUCTION_URL = process.env.TAIME_PRODUCTION_URL ?? 'https://taime.replit.app';

const config: CapacitorConfig = {
  appId: 'com.taime.app',
  appName: 'Taime',
  webDir: 'dist/public',
  server: {
    // Remote URL mode: webview loads frontend + all /api/... calls from the
    // deployed backend, so relative fetch URLs work on physical devices.
    url: PRODUCTION_URL,
    androidScheme: 'https',
    cleartext: false,
    // Allow navigation within the deployed app's hostname.
    allowNavigation: [new URL(PRODUCTION_URL).hostname],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#FFFBF5',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DEFAULT',
      backgroundColor: '#FFFBF5',
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Geolocation: {
      permissions: {
        ios: {
          NSLocationWhenInUseUsageDescription:
            'Taime uses your location to verify that you are at a work location before clocking you in.',
          NSLocationAlwaysAndWhenInUseUsageDescription:
            'Taime uses your location in the background to automatically clock you out when you leave the work area.',
        },
      },
    },
  },
  ios: {
    backgroundColor: '#FFFBF5',
    contentInset: 'automatic',
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    backgroundColor: '#FFFBF5',
    allowMixedContent: false,
  },
};

export default config;
