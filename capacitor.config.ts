import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.taime.app',
  appName: 'Taime',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
    cleartext: false,
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
