# Taime — Native App Submission Guide

This document covers the full workflow for generating native iOS and Android builds
and submitting them to the App Store and Google Play.

---

## Prerequisites

| Tool | Required For | Notes |
|------|-------------|-------|
| Node.js 20+ | Both | `node --version` |
| Xcode 15+ | iOS only | macOS required |
| Android Studio | Android | Install Android SDK 34+ |
| JDK 17+ | Android | [Adoptium](https://adoptium.net) |
| Apple Developer account | iOS | https://developer.apple.com |
| Google Play Console account | Android | https://play.google.com/console |

---

## Step 1 — Initial Native Project Setup (macOS Only for iOS)

Run this once on a macOS machine with Xcode and Android Studio installed:

```bash
bash scripts/capacitor-setup.sh
```

This script will:
- Install npm dependencies
- Build the web application
- Run `npx cap add ios` (macOS only) and `npx cap add android`
- Patch `ios/App/App/Info.plist` with required permission strings
- Patch `android/app/src/main/AndroidManifest.xml` with required permissions

---

## Step 2 — App Icon & Splash Screen

Placeholder assets are located in `resources/`. Replace them with branded versions:

| File | Size | Purpose |
|------|------|---------|
| `resources/icon.png` | 1024×1024 px | App icon (no transparency) |
| `resources/splash.png` | 2732×2732 px | Splash/launch screen |

After placing final assets, run:

```bash
npx @capacitor/assets generate
```

This generates all required icon and splash variants for both platforms.

---

## Step 3 — Set Production URL

The Capacitor config loads the web app from the deployed Replit URL. Make sure the
production deployment is live before building:

```bash
TAIME_PRODUCTION_URL=https://taime.replit.app ./scripts/build-native.sh
```

The build script will:
1. Build the web app (`npm run build`)
2. Run `npx cap sync` to copy assets and update plugins

---

## Step 4 — iOS App Store Submission

### 4a. Configure Bundle ID & Capabilities in Xcode

1. Open Xcode: `npx cap open ios`
2. Select the **App** target → **Signing & Capabilities**
3. Set **Bundle Identifier** to `com.taime.app`
4. Select your Apple Developer Team
5. Click **+ Capability** and add:
   - **Push Notifications**
   - **Background Modes** → enable *Remote notifications* and *Location updates*

### 4b. Configure APNs (Push Notifications)

1. Go to [Apple Developer → Certificates, Identifiers & Profiles](https://developer.apple.com/account/)
2. Create an **APNs Authentication Key** (`.p8` file) under **Keys**
3. Note the **Key ID** and **Team ID**
4. In your Taime admin panel (Settings → Push Notifications), enter:
   - APNs Key (paste `.p8` content)
   - APNs Key ID
   - APNs Team ID
   - Bundle ID: `com.taime.app`

### 4c. Archive and Upload

1. In Xcode: **Product → Archive**
2. Once archived: **Distribute App → App Store Connect → Upload**
3. In [App Store Connect](https://appstoreconnect.apple.com):
   - Create a new app record (Bundle ID: `com.taime.app`)
   - Fill in metadata, screenshots, description
   - Select the uploaded build and submit for review

### iOS Info.plist Permissions (auto-patched by setup script)

| Key | Reason shown to user |
|-----|----------------------|
| `NSLocationWhenInUseUsageDescription` | Clock-in location verification |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | Background clock-out detection |
| `NSCameraUsageDescription` | Team video updates |
| `NSMicrophoneUsageDescription` | Audio in video updates |
| `NSPhotoLibraryUsageDescription` | Attach photos to work documentation |

---

## Step 5 — Google Play Submission

### 5a. Configure FCM (Push Notifications)

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project
2. Add an **Android app** with package name `com.taime.app`
3. Download `google-services.json` and place it at `android/app/google-services.json`
4. In Firebase Console → **Project Settings → Service Accounts**, generate a private key (JSON)
5. In your Taime admin panel (Settings → Push Notifications), enter the FCM service account JSON

### 5b. Configure Signing Keystore

> **SECURITY WARNING — never commit these files to git:**
> - `taime-release.keystore` / `*.keystore` — if lost or leaked, the Play Store listing
>   cannot be transferred to a new key without going through a lengthy Google support process.
> - `android/app/google-services.json` — contains Firebase project credentials.
> - `ios/App/GoogleService-Info.plist` — iOS equivalent of the above.
>
> All three patterns are listed in `.gitignore`. Store them in a password manager or
> secure secrets vault (e.g. 1Password, Bitwarden, or your CI/CD secret store) and
> share them only through encrypted channels.

1. Generate a release keystore (keep this file safe — it cannot be recovered):

```bash
keytool -genkey -v -keystore taime-release.keystore \
  -alias taime -keyalg RSA -keysize 2048 -validity 10000
```

2. Open Android Studio: `npx cap open android`
3. **Build → Generate Signed Bundle / APK**
4. Select **Android App Bundle (AAB)**, point to your keystore, and build

### 5c. Upload to Google Play

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new application (package: `com.taime.app`)
3. Under **Production → Releases**, upload the signed `.aab` file
4. Fill in store listing, screenshots, content rating, pricing
5. Submit for review

### Android Manifest Permissions (auto-patched by setup script)

| Permission | Purpose |
|-----------|---------|
| `ACCESS_FINE_LOCATION` | Precise clock-in location check |
| `ACCESS_COARSE_LOCATION` | Fallback location |
| `ACCESS_BACKGROUND_LOCATION` | Background clock-out detection |
| `CAMERA` | Team video updates |
| `RECORD_AUDIO` | Audio in video updates |
| `READ_MEDIA_IMAGES` | Attach photos to work docs |
| `READ_MEDIA_VIDEO` | Attach videos to work docs |

---

## Ongoing Rebuild Workflow

After any change to the web app, run the native build pipeline before opening
the native IDE or submitting an update:

```bash
TAIME_PRODUCTION_URL=https://taime.replit.app ./scripts/build-native.sh
```

Then increment the build number in Xcode / `android/app/build.gradle` before
archiving/building again.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cap sync` fails with missing `dist/public` | Run `npm run build` first |
| iOS push notifications not received | Verify APNs key is configured in admin settings |
| Android FCM not working | Ensure `google-services.json` is in `android/app/` and FCM service account is configured |
| Location not working on Android | Check that `ACCESS_BACKGROUND_LOCATION` is granted by user in system settings |
| Capacitor version mismatch | All `@capacitor/*` packages must be on the same major version |
