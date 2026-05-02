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
    // allowNavigation must cover every domain the WebView may navigate to,
    // including Clerk's authentication pages and social-OAuth providers.
    // Any URL NOT listed here is opened in Safari instead of the WebView,
    // which breaks the auth session cookie (Safari and WKWebView have
    // separate cookie stores).
    allowNavigation: [
      // --- App host ---
      productionHost,       // taime.us

      // --- Replit SSO ---
      'replit.com',
      '*.replit.com',

      // --- Clerk authentication (all environments) ---
      // Production custom domain (set in Clerk Dashboard → Domains)
      'clerk.taime.us',
      // Clerk-hosted accounts pages (dev + staging instances)
      '*.clerk.accounts.dev',
      '*.clerk.com',
      // Wildcard that covers all Clerk FAPI and BAPI subdomains
      '*.clerk.dev',

      // --- Social OAuth providers that Clerk may redirect to ---
      'accounts.google.com',
      '*.google.com',          // Google token endpoint sub-pages
      'oauth2.googleapis.com', // Google OAuth2 token endpoint
      'appleid.apple.com',
      '*.apple.com',
      'github.com',
      '*.github.com',
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
    // Keep limitsNavigationsToAppBoundDomains OFF — the Clerk and social-OAuth
    // redirects span multiple domains that would otherwise be blocked and forced
    // into Safari, breaking the login session.
    limitsNavigationsToAppBoundDomains: false,
    // Custom URL scheme for deep-link OAuth callbacks.
    // iOS will open the app when it receives a URL like com.taimetaime://...
    // This must also be registered in Info.plist under CFBundleURLTypes.
    scheme: 'com.taimetaime',
  },
  android: {
    backgroundColor: '#FFFBF5',
    allowMixedContent: false,
  },
};

export default config;
