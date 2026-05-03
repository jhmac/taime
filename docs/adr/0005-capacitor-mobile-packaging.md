# Capacitor for mobile packaging of the PWA

Taime ships to iOS and Android by wrapping the same React PWA build (`dist/public`) with Capacitor, swapping in native plugins for geolocation, haptics, camera, push, status bar, and splash screen when running on-device. We chose Capacitor over React Native or a separate native rewrite because the web app already covers ~100% of the UI and Capacitor lets one codebase serve web, iOS, and Android with native APIs only where they matter (geofencing accuracy, APNs/FCM push); App ID is `com.taime.app` and `npx cap sync` runs after each web build.
