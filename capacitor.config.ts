import type { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT: Set TAIME_PRODUCTION_URL before running `npx cap sync`.
// Default is https://taime.us (production). Override only for local testing:
//   TAIME_PRODUCTION_URL=https://taime.us npx cap sync
const PRODUCTION_URL = process.env.TAIME_PRODUCTION_URL ?? 'https://taime.us';
const productionHost = new URL(PRODUCTION_URL).hostname;

const config: CapacitorConfig = {
  appId: 'com.taime.app',
  appName: 'Taime',
  webDir: 'dist/public',
  server: {
    // Remote URL mode: the WebView loads the deployed backend directly so
    // relative /api/... fetch calls work on physical devices.
    url: PRODUCTION_URL,
    androidScheme: 'https',
    cleartext: false,
    // Allow navigation to the app host AND Replit's auth endpoints.
    // Without replit.com here the Replit OAuth redirect is intercepted by
    // iOS and opened in Safari, breaking the login flow and session cookies.
    allowNavigation: [
      productionHost,
      'replit.com',
      '*.replit.com',
    ],
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
    // Disabled: limitsNavigationsToAppBoundDomains was preventing the Replit
    // auth redirect from staying inside the WebView, forcing it into Safari
    // and breaking the login session. With allowNavigation covering all
    // required domains this restriction is not needed.
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    backgroundColor: '#FFFBF5',
    allowMixedContent: false,
  },
};

export default config;
