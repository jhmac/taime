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
TAIME_PRODUCTION_URL=https://taime.us ./scripts/build-native.sh
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
TAIME_PRODUCTION_URL=https://taime.us ./scripts/build-native.sh
```

Then increment the build number in Xcode / `android/app/build.gradle` before
archiving/building again.

---

## Pre-commit Security Hook

A pre-commit script at `.husky/pre-commit` blocks any commit that includes the
following secret credential files, regardless of `.gitignore` settings:

| Blocked pattern | Why it's sensitive |
|---|---|
| `*.keystore` | Android release signing key — cannot be replaced on the Play Store without a lengthy Google support process |
| `android/app/google-services.json` | Firebase Android credentials |
| `ios/App/GoogleService-Info.plist` | Firebase iOS credentials |
| `.env`, `.env.<anything>` | Local environment files — typically contain API keys, database URLs, and other runtime secrets |

### Environment files (`.env`, `.env.local`, `.env.production`, …)

Real environment files must never be committed. They are blocked by both the
`.gitignore` (which excludes `.env` and `.env.*`) and the pre-commit hook
(which refuses to stage anything matching `.env` or `.env.<suffix>`).

Two filenames are explicitly allowed because they should only ever contain
**placeholder** values and serve as documentation for new contributors:

- `.env.example`
- `.env.sample`

Anything else — `.env`, `.env.local`, `.env.development`, `.env.production`,
`.env.staging`, `.env.test`, etc. — is rejected. Store the real values in:

- The Replit Secrets manager for the live deployment
- A password manager (1Password, Bitwarden) for shared developer credentials
- Your CI/CD provider's secret store for build-time variables

If the hook blocks a file you believe is safe (for example, a new template
file), rename it to `.env.example` / `.env.sample` so its intent is obvious,
or add a narrow allow entry to `ALLOWED_PATTERNS` in `.husky/pre-commit`.

### One-time developer setup (required per machine)

Every developer who clones this repository must activate the hook before their
first commit. Choose **one** of the methods below.

#### Option A — Project install script (recommended)

```bash
bash scripts/install-hooks.sh
```

This installs all project hooks in one shot. It wires up `.husky/pre-commit`
(credential guard) as the primary entry point, which internally chains to
`scripts/hooks/pre-commit` (migration validation), so both checks run on
every commit.

#### Option B — Husky

```bash
npx husky
```

After running this once, git will automatically execute `.husky/pre-commit`
before every local commit. The hook already chains to the migration validation
script, so no extra wiring is needed.

The repo's `package.json` already declares the right `prepare` script, so a
fresh `npm install` will activate the hook automatically:

```json
"scripts": {
  "prepare": "husky"
}
```

> Note: the husky v8 form `husky install` is deprecated and will be removed
> in husky v10. Always use the bare `husky` command on v9+.

#### Option C — Manual git hook symlink (no extra dependency)

```bash
ln -sf ../../.husky/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Husky version policy

`devDependencies.husky` in `package.json` is pinned to a tilde range
(`~9.1.7`), which only accepts patch updates within husky 9.1. **Do not
loosen this pin without an explicit upgrade pass.**

Why the tight pin:

- Husky v10 is expected to remove more legacy behavior — the `husky.sh` shim
  that older hook files source via `. "$(dirname -- "$0")/_/husky.sh"`, the
  `HUSKY=0` environment variable, and other v8-era affordances. A silent
  upgrade can break `.husky/pre-commit` for every developer on the team
  (including new clones via `npm install`) without any code change in this
  repo.
- Even within v9, a minor bump (9.2.x, 9.3.x, …) could change hook discovery
  or output formatting in ways that affect the credential guard. Patch-only
  updates are safe; minor/major updates need to be reviewed manually.

When you want to upgrade husky:

1. Read the husky changelog for the target version end-to-end.
2. Verify `.husky/pre-commit` does not source any deprecated shim and that
   `npm run prepare` still uses the bare `husky` command (not
   `husky install`).
3. Bump the pin in `package.json`, regenerate `package-lock.json`, and run
   the full unit test suite plus a manual commit that should be blocked
   (e.g. staging a fake `.env`) and one that should succeed.

### What happens when a blocked file is staged

The commit is aborted and a clear error message is printed, e.g.:

```
╔══════════════════════════════════════════════════════════════╗
║           COMMIT BLOCKED — SECRET FILE DETECTED             ║
╠══════════════════════════════════════════════════════════════╣
║  The following sensitive credential file(s) are staged:     ║
║    ✗  android/app/google-services.json                      ║
...
╚══════════════════════════════════════════════════════════════╝
```

To resolve, unstage the file and store it securely instead:

```bash
git reset HEAD android/app/google-services.json
```

Store credential files in a password manager (1Password, Bitwarden) or your
CI/CD secret store and share them only through encrypted channels.

---

## iOS OAuth Sign-In (ASWebAuthenticationSession)

Clerk's social OAuth (Google, Apple, etc.) previously opened the full Safari browser on iOS, breaking
the session because Safari and WKWebView have separate cookie stores.

The fix uses `@capacitor/browser`, which on iOS is backed by Apple's `ASWebAuthenticationSession`
— a sanctioned in-app OAuth overlay that keeps the user inside the app.

### How it works

1. On native platforms, `Landing.tsx` renders `NativeLanding.tsx` instead of the embedded Clerk
   `<SignIn>` component. The native landing shows "Continue with Google" / "Continue with Apple" buttons.
2. Tapping a button calls `useNativeClerkSignIn`, which initiates the Clerk OAuth flow via
   `signIn.create({ strategy, redirectUrl: 'com.taimetaime://oauth-callback', ... })` to obtain the
   external authorization URL, then opens it with `Browser.open()`.
3. After the user completes OAuth, the provider redirects to `com.taimetaime://oauth-callback`.
   iOS intercepts this via the registered custom URL scheme and re-opens the app.
4. `DeepLinkHandler` (in `App.tsx`) listens for `appUrlOpen` events. When the URL matches the scheme,
   it closes the in-app browser overlay and calls `clerk.handleRedirectCallback()` to establish the
   Clerk session.

### Required setup steps

1. **Clerk Dashboard** — Add `com.taimetaime://oauth-callback` as an allowed OAuth redirect URL in
   your Clerk instance settings (Dashboard → Redirect URLs).
2. **Info.plist** — Register the custom URL scheme so iOS routes the deep link back to the app.
   The `scripts/capacitor-setup.sh` script patches this automatically under `CFBundleURLTypes`.
   After running the setup script on macOS, verify the entry in Xcode:
   - Target → Info → URL Types → `com.taimetaime`
3. **`capacitor.config.ts`** — `ios.scheme: 'com.taimetaime'` is already set.

### Relevant files

| File | Purpose |
|------|---------|
| `client/src/hooks/useNativeClerkSignIn.ts` | Hook that opens OAuth URLs via `Browser.open()` |
| `client/src/pages/NativeLanding.tsx` | Native-only sign-in screen (Google + Apple buttons) |
| `client/src/pages/Landing.tsx` | Routes to `NativeLanding` on native, `<SignIn>` on web |
| `client/src/App.tsx` — `DeepLinkHandler` | Handles `appUrlOpen`, closes browser, calls Clerk |
| `capacitor.config.ts` | `ios.scheme`, `allowNavigation` |
| `scripts/capacitor-setup.sh` | Auto-patches `CFBundleURLTypes` in `Info.plist` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cap sync` fails with missing `dist/public` | Run `npm run build` first |
| iOS push notifications not received | Verify APNs key is configured in admin settings |
| Android FCM not working | Ensure `google-services.json` is in `android/app/` and FCM service account is configured |
| Location not working on Android | Check that `ACCESS_BACKGROUND_LOCATION` is granted by user in system settings |
| Capacitor version mismatch | All `@capacitor/*` packages must be on the same major version |
| iOS OAuth opens Safari instead of in-app browser | Verify `com.taimetaime://oauth-callback` is in Clerk Dashboard → Redirect URLs and `CFBundleURLTypes` is in `Info.plist` |
| OAuth callback not received after sign-in | Check that `ios.scheme: 'com.taimetaime'` is in `capacitor.config.ts` and `cap sync ios` was run |
