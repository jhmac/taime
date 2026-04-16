# Taime — App Store Submission Guide

Step-by-step walkthrough for submitting Taime to the **Apple App Store** and **Google Play Store**.
Every field that the stores ask for is pre-filled below. Work through each section in order.

---

## Quick Reference

| Field | Value |
|-------|-------|
| App name | `Taime` |
| Bundle / Package ID | `com.taime.app` |
| Version | `1.0.0` |
| Build number (iOS) | `1` |
| Version code (Android) | `1` |
| Production URL | `https://taime.us` |
| Support URL | `https://taime.us/support` |
| Marketing URL | `https://taime.us` |
| Privacy Policy URL | `https://taime.us/privacy` |

---

## Prerequisites

| Requirement | Platform | Notes |
|-------------|----------|-------|
| macOS 14+ with Xcode 15+ | iOS | Linux cannot generate iOS native projects |
| Xcode Command Line Tools | iOS | `xcode-select --install` |
| Apple Developer account ($99/yr) | iOS | https://developer.apple.com |
| Android Studio (Hedgehog or later) | Android | Includes Android SDK 34+ |
| JDK 17+ | Android | https://adoptium.net |
| Google Play Developer account ($25 one-time) | Android | https://play.google.com/console |
| Node.js 20+ | Both | `node --version` to verify |

---

## Part 1 — Build the Native App

Run once on a macOS machine:

```bash
# 1. Clone / pull latest code
git pull

# 2. Initial platform setup (adds ios/ and android/ directories)
bash scripts/capacitor-setup.sh

# 3. For every subsequent release, run the native build pipeline:
TAIME_PRODUCTION_URL=https://taime.us ./scripts/build-native.sh
```

> **Important:** The native WebView loads all content (frontend + API calls) from
> `https://taime.us`. The app must be deployed before building native binaries.

---

## Part 2 — App Icon & Splash Screen

Replace placeholder assets before submission:

| File | Size | Rules |
|------|------|-------|
| `resources/icon.png` | 1024×1024 px | No alpha channel, no rounded corners, no transparency |
| `resources/splash.png` | 2732×2732 px | Keep important content in center 1200×1200 px safe zone |

Generate all platform variants after placing final assets:

```bash
npx @capacitor/assets generate
```

---

## Part 3 — Apple App Store

### 3.1 Register the App ID

1. Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
2. Click **+** → **App IDs** → **App**
3. Fill in:
   - **Description:** `Taime`
   - **Bundle ID (Explicit):** `com.taime.app`
4. Enable these **Capabilities**:
   - ✅ Push Notifications
   - ✅ Background Modes *(check "Remote notifications" and "Location updates")*
   - ✅ Associated Domains *(if using universal links later)*
5. Click **Continue → Register**

### 3.2 Create a Distribution Certificate

1. **Certificates → +** → **Apple Distribution**
2. Follow the CSR wizard (Keychain Access → Certificate Assistant)
3. Download and double-click to install in Keychain
4. This certificate is used to sign the App Store build

### 3.3 Create an App Store Provisioning Profile

1. **Profiles → +** → **App Store Connect**
2. Select the `com.taime.app` App ID
3. Select your Distribution certificate
4. Name it `Taime App Store`
5. Download and double-click to install

### 3.4 Set Up APNs Auth Key (Push Notifications)

1. **Keys → +**
2. Key name: `Taime APNs Key`
3. Enable **Apple Push Notifications service (APNs)**
4. Click **Continue → Register → Download**

> ⚠️ The `.p8` file can only be downloaded once. Store it securely.

5. Note these three values:
   - **Key ID** (10-character code shown on the key detail page)
   - **Team ID** (shown in top-right of developer portal under your name)
   - **Bundle ID:** `com.taime.app`

6. In the Taime admin panel → **Settings → Push Notifications**, enter all three values
   plus paste the full contents of the `.p8` file.

### 3.5 Build & Archive in Xcode

```bash
# Open Xcode
npx cap open ios
```

In Xcode:

1. Select target **App** → **Signing & Capabilities**
2. Set **Bundle Identifier:** `com.taime.app`
3. Select your Apple Developer **Team**
4. Confirm **Provisioning Profile:** Taime App Store
5. Set scheme to **Any iOS Device (arm64)** (not a simulator)
6. **Product → Archive**
7. When complete: **Distribute App → App Store Connect → Upload**
8. Accept defaults through the upload wizard

### 3.6 Create the App Record in App Store Connect

Go to [App Store Connect → My Apps → +](https://appstoreconnect.apple.com/apps)

Fill in **New App**:

| Field | Value |
|-------|-------|
| Platforms | iOS |
| Name | `Taime` |
| Primary Language | English (U.S.) |
| Bundle ID | `com.taime.app` (select from dropdown) |
| SKU | `taime-app-001` |
| User Access | Full Access |

### 3.7 App Information

| Field | Value |
|-------|-------|
| Name | `Taime` |
| Subtitle | `AI Boutique Manager` |
| Primary Category | Business |
| Secondary Category | Productivity |
| Content Rights | Does not contain third-party content |
| Age Rating | 4+ (no objectionable content) |
| Copyright | `© 2026 Taime` |

### 3.8 Pricing & Availability

- Price: **Free**
- Availability: **All territories** (or limit to United States initially)
- Pre-order: No

### 3.9 App Store Listing — Version 1.0.0

#### Promotional Text (170 chars max — shown above description, can change without resubmit)

```
AI-powered workforce management built for boutique and retail teams. Smart scheduling, geofenced clock-in, and real-time team insights.
```

#### Description (4000 chars max)

```
Taime is the AI-powered boutique manager your team has been waiting for — purpose-built for retail stores, boutiques, and small businesses that need real workforce management without the enterprise price tag.

SMART TIME TRACKING
Clock in and out with geofenced location verification. Taime confirms employees are actually at the store before registering a clock-in, eliminating buddy punching and time theft. Managers get real-time visibility into who is on shift and where.

AI SCHEDULING
Claude AI analyzes your team's availability, sales patterns, and historical traffic data to generate optimized weekly schedules in seconds. Adjust shifts with drag-and-drop, approve swaps, and push the final schedule to your entire team instantly.

TEAM TASK MANAGEMENT
Turn daily priorities into assigned, trackable tasks with due dates and completion tracking. Built-in GTD-style inbox processing helps managers stay on top of store operations without getting buried in messages.

MORNING HUDDLE
Start every shift with an AI-generated morning briefing that surfaces yesterday's performance highlights, today's priorities, pending tasks, and scheduled arrivals. Your team shows up informed and ready.

AI ASSISTANT (CLAUDE)
Ask anything about your business operations. Get instant answers on team performance, schedule optimization, SOP clarification, or inventory status. Your AI manager is available 24/7.

STANDARD OPERATING PROCEDURES
Build, manage, and track step-by-step SOPs directly in the app. Employees execute procedures on-device with progress tracking, and managers can see completion rates in real time.

SHIFT HANDOFFS
Replace the end-of-shift notebook with structured digital handoffs. Outgoing employees document key events, pending tasks, and notes for the incoming team — searchable, timestamped, and always accessible.

PAY PERIOD MANAGEMENT
Generate pay period summaries and timesheet exports automatically. Review hours, flag discrepancies, and prepare payroll data without spreadsheets.

REAL-TIME ANALYTICS
Track attendance patterns, on-time rates, schedule adherence, and team performance over time. Identify trends before they become problems.

PUSH NOTIFICATIONS
Get instant alerts for clock-in requests, missed clock-outs, schedule changes, task assignments, and important team updates — even when the app is in the background.

BUILT FOR BOUTIQUES
Designed specifically for Libby Story and boutique-scale retail operations: lean teams, fast-paced environments, high expectations for customer experience.

---
Taime requires location permission for geofenced clock-in verification. Location is only accessed when you initiate a clock-in action and is not tracked continuously in the background except where background clock-out detection is explicitly enabled.
```

#### Keywords (100 chars max — comma-separated, no spaces after commas)

```
time tracking,scheduling,team management,boutique,clock in,geofence,shifts,staff
```

#### Support URL

```
https://taime.us/support
```

#### Marketing URL

```
https://taime.us
```

#### Privacy Policy URL

```
https://taime.us/privacy
```

### 3.10 Screenshot Requirements

As of 2024, **6.9-inch and 13-inch iPad Pro** screenshots are required. All others are optional but strongly recommended.

| Device | Size | Required |
|--------|------|----------|
| iPhone 6.9" (iPhone 16 Pro Max) | 1320×2868 px or 1290×2796 px | ✅ Required |
| iPhone 5.5" (iPhone 8 Plus) | 1242×2208 px | Optional (fills older devices) |
| iPad Pro 13" | 2064×2752 px | ✅ Required |
| iPad Pro 11" | 1668×2388 px | Optional |

**Screenshot rules:**
- PNG or JPEG, RGB, no alpha channel
- No device frames required (Apple generates them)
- Minimum 2 screenshots per device size, maximum 10
- First screenshot is used as the primary store thumbnail

**Recommended screenshot subjects (in order):**
1. Morning Huddle / Dashboard — "Your team, at a glance"
2. Clock In with geofence — "Location-verified time tracking"
3. AI Schedule view — "AI-optimized scheduling"
4. Task Management — "Keep your team on task"
5. AI Chat — "Ask your AI boutique manager anything"

### 3.11 App Review Information

| Field | Value |
|-------|-------|
| Sign-in required | Yes |
| Demo username | Create a manager account at https://taime.us — use the sign-up flow |
| Demo password | Set a memorable test password |
| Notes for reviewer | "Taime is a workforce management app for retail boutiques. Sign in with the provided manager account to explore scheduling, clock-in/out (location permission required), task management, and the AI assistant. Location access is requested only when the Clock In button is tapped." |
| Contact first name | (Your name) |
| Contact last name | (Your last name) |
| Contact phone | (Your phone number) |
| Contact email | (Your email) |

### 3.12 Privacy Nutrition Labels

In App Store Connect → **App Privacy**, declare the following:

| Data Type | Collected | Linked to Identity | Used for Tracking |
|-----------|-----------|-------------------|-------------------|
| Precise Location | Yes | Yes | No |
| User ID | Yes | Yes | No |
| Device ID | Yes | Yes | No |
| Usage Data (crash logs) | Yes | No | No |

**For each location data item**, select purpose: **App Functionality** (clock-in verification).

### 3.13 Export Compliance

- **Does your app use encryption?** → **No** (the app uses standard HTTPS/TLS provided by iOS; no custom encryption algorithms are implemented)

### 3.14 Version Release

- **Manually release this version** (recommended for first submission — gives you control over timing)
- OR **Automatically release after approval**

### 3.15 Common iOS Rejection Reasons — How to Avoid Them

| Rejection Reason | How Taime Avoids It |
|-----------------|---------------------|
| Background location without justification | Location is only used when employee taps Clock In. Background detection is opt-in and explained in the app description and permission dialog. |
| Push notifications not justified | Push is used for clock-in approvals, schedule changes, and task assignments — all directly useful to users. Explain this in the App Review notes. |
| Missing privacy policy | Privacy policy is at https://taime.us/privacy |
| Demo account not working | Always test the demo account before submitting. Use a stable manager account with sample data. |
| Crashes on review device | Test on a real device (not just simulator) before submitting. |
| 4+ age rating violated | No user-generated content visible to others, no social features, no objectionable content. |

### 3.16 Submit for Review

1. In App Store Connect, select your version build
2. Complete all required fields (shown with red indicators)
3. Click **Add for Review → Submit to App Review**
4. Typical review time: **1–3 business days**
5. Monitor status in App Store Connect and via email

---

## Part 4 — Google Play Store

### 4.1 Set Up Firebase & FCM

1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project**
   - Project name: `Taime`
   - Disable Google Analytics (optional)
2. In the project: **Add app → Android**
   - Android package name: `com.taime.app`
   - App nickname: `Taime Android`
   - Debug signing certificate SHA-1: (optional for now)
3. Download **`google-services.json`** → place at `android/app/google-services.json`
4. In Firebase Console → **Project Settings → Cloud Messaging**:
   - Note the **Sender ID** (numeric)
   - Note the **Server Key** (legacy) or generate a service account for HTTP v1

5. In the Taime admin panel → **Settings → Push Notifications**, enter the FCM service account credentials.

### 4.2 Generate a Signing Keystore

> ⚠️ **CRITICAL:** The keystore file is required for every future update. If lost, you cannot update the app. Back it up to multiple secure locations.

```bash
keytool -genkey -v \
  -keystore taime-release.keystore \
  -alias taime \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Fill in the prompts:

| Prompt | Value |
|--------|-------|
| Keystore password | (create a strong password — save it) |
| First and last name | Taime |
| Organizational unit | Engineering |
| Organization | Taime |
| City or Locality | Ridgeland |
| State or Province | MS |
| Country code | US |
| Key password | (same as keystore password or different — save it) |

Store `taime-release.keystore` in a **password manager and secure cloud backup**. Never commit it to git.

### 4.3 Build the Signed AAB

```bash
# Open Android Studio
npx cap open android
```

In Android Studio:

1. **Build → Generate Signed Bundle / APK**
2. Select **Android App Bundle**
3. **Key store path:** browse to `taime-release.keystore`
4. Enter keystore password, key alias (`taime`), key password
5. Select **Release** build variant
6. Click **Finish** — the `.aab` file is generated at `android/app/release/app-release.aab`

### 4.4 Create the App in Google Play Console

Go to [Google Play Console → Create app](https://play.google.com/console)

| Field | Value |
|-------|-------|
| App name | `Taime` |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |
| Developer Program Policies | ✅ Accept |
| US export laws | ✅ Accept |

### 4.5 Store Listing

#### Main Store Listing

| Field | Value |
|-------|-------|
| App name | `Taime` |
| Short description (80 chars) | `AI-powered team management for boutique & retail businesses` |
| Package name | `com.taime.app` |

#### Full Description (4000 chars max — same content as iOS, pasted below)

```
Taime is the AI-powered boutique manager your team has been waiting for — purpose-built for retail stores, boutiques, and small businesses that need real workforce management without the enterprise price tag.

SMART TIME TRACKING
Clock in and out with geofenced location verification. Taime confirms employees are actually at the store before registering a clock-in, eliminating buddy punching and time theft. Managers get real-time visibility into who is on shift and where.

AI SCHEDULING
Claude AI analyzes your team's availability, sales patterns, and historical traffic data to generate optimized weekly schedules in seconds. Adjust shifts with drag-and-drop, approve swaps, and push the final schedule to your entire team instantly.

TEAM TASK MANAGEMENT
Turn daily priorities into assigned, trackable tasks with due dates and completion tracking. Built-in GTD-style inbox processing helps managers stay on top of store operations without getting buried in messages.

MORNING HUDDLE
Start every shift with an AI-generated morning briefing that surfaces yesterday's performance highlights, today's priorities, pending tasks, and scheduled arrivals. Your team shows up informed and ready.

AI ASSISTANT (CLAUDE)
Ask anything about your business operations. Get instant answers on team performance, schedule optimization, SOP clarification, or inventory status. Your AI manager is available 24/7.

STANDARD OPERATING PROCEDURES
Build, manage, and track step-by-step SOPs directly in the app. Employees execute procedures on-device with progress tracking, and managers can see completion rates in real time.

SHIFT HANDOFFS
Replace the end-of-shift notebook with structured digital handoffs. Outgoing employees document key events, pending tasks, and notes for the incoming team — searchable, timestamped, and always accessible.

PAY PERIOD MANAGEMENT
Generate pay period summaries and timesheet exports automatically. Review hours, flag discrepancies, and prepare payroll data without spreadsheets.

REAL-TIME ANALYTICS
Track attendance patterns, on-time rates, schedule adherence, and team performance over time. Identify trends before they become problems.

PUSH NOTIFICATIONS
Get instant alerts for clock-in requests, missed clock-outs, schedule changes, task assignments, and important team updates — even when the app is in the background.

---
Taime requires location permission for geofenced clock-in verification. Location is only accessed when you initiate a clock-in action and is not tracked continuously in the background except where background clock-out detection is explicitly enabled.
```

#### Categorization

| Field | Value |
|-------|-------|
| App category | Business |
| Tags | `Time Tracking`, `Scheduling`, `Team Management` |
| Email address | (your support email) |
| Phone | (optional) |
| Website | `https://taime.us` |
| Privacy Policy | `https://taime.us/privacy` |

### 4.6 Screenshot Requirements

| Surface | Minimum size | Required count |
|---------|-------------|----------------|
| Phone | 1080×1920 px (16:9 or 9:16) | At least 2 |
| 7-inch tablet | 1200×1920 px | At least 1 (optional but recommended) |
| 10-inch tablet | 1920×1200 px | At least 1 (optional but recommended) |

**Additional graphics:**

| Asset | Size |
|-------|------|
| App icon | 512×512 px PNG (no alpha) |
| Feature graphic (banner shown at top of listing) | 1024×500 px PNG or JPEG |

### 4.7 Version Details

| Field | Value |
|-------|-------|
| Version name | `1.0.0` |
| Version code | `1` |

To update version code for future releases, edit `android/app/build.gradle`:

```gradle
android {
    defaultConfig {
        versionCode 1       // increment by 1 for each release
        versionName "1.0.0" // semantic version string
    }
}
```

### 4.8 Data Safety Section

In Play Console → **Data safety**, declare the following:

| Data type | Collected | Shared | Required | Purpose |
|-----------|-----------|--------|----------|---------|
| Precise location | Yes | No | Yes (for clock-in) | App functionality |
| Approximate location | Yes | No | No | App functionality |
| User IDs | Yes | No | Yes | Account management |
| Device IDs (push token) | Yes | No | Yes | Push notifications |
| App interactions (usage) | Yes | No | No | Analytics / app functionality |
| Crash logs | Yes | No | No | App functionality |

**Is data encrypted in transit?** → Yes  
**Can users request data deletion?** → Yes (via account deletion in app or by emailing support)

### 4.9 Content Rating

Answer the **IARC questionnaire** as follows:

| Question | Answer |
|----------|--------|
| Violence | None |
| Sexual content | None |
| Language | None |
| Controlled substances | None |
| User-generated content shared with others | No |
| Gambling | No |
| Location sharing with other users | No |

Expected rating: **Everyone** (E) — suitable for all ages.

### 4.10 Release Strategy (Recommended)

1. **Create a Closed Testing track first** (Internal testing → Alpha → Beta before Production)
   - Upload the `.aab` to **Internal testing**
   - Add tester email addresses
   - Install via the Play Store testing link on a real Android device
   - Verify clock-in, push notifications, and all core flows

2. When testing passes, **Promote to Production**
   - Set **rollout percentage** to 20% initially
   - Monitor crash rates and reviews before going to 100%

3. Typical review time for new apps: **3–7 business days**

### 4.11 Common Android Rejection Reasons — How to Avoid Them

| Rejection Reason | How Taime Avoids It |
|-----------------|---------------------|
| `ACCESS_BACKGROUND_LOCATION` without justification | Required for background clock-out. Justify it in the Play Console declaration and in the app's permission request dialog. Google may require a video demo showing the feature. |
| Target API level too low | Ensure `targetSdkVersion` in `build.gradle` is 34+ (Android 14). |
| Privacy policy missing or inaccessible | `https://taime.us/privacy` must load without a login wall. |
| Data safety section incomplete | Fill out every declared data type with collection purpose and retention. |
| AAB not signed with release keystore | Always use the release keystore, not the debug keystore. |
| Keystore enrolled in Play App Signing | Enroll on first upload — Google then manages key security. |

---

## Part 5 — Post-Submission Checklist

- [ ] App Store Connect build selected and all required fields complete
- [ ] Google Play Console store listing 100% complete (green indicators)
- [ ] Privacy policy at `https://taime.us/privacy` is publicly accessible
- [ ] Demo account credentials provided to Apple reviewer
- [ ] `resources/icon.png` is the final branded asset (no placeholder)
- [ ] `resources/splash.png` is the final branded asset (no placeholder)
- [ ] `google-services.json` is in `android/app/` (not committed to git)
- [ ] `taime-release.keystore` backed up to secure storage (not committed to git)
- [ ] APNs key ID, Team ID, and `.p8` contents saved in Taime admin settings
- [ ] FCM service account JSON saved in Taime admin settings
- [ ] Tested on real iOS device (not simulator)
- [ ] Tested on real Android device

---

## Part 6 — Ongoing Update Workflow

For every app update after initial submission:

```bash
# 1. Make and deploy web app changes
git pull && npm run build
# Deploy to https://taime.us

# 2. Run native build pipeline
TAIME_PRODUCTION_URL=https://taime.us ./scripts/build-native.sh

# 3. iOS: increment build number in Xcode → Archive → Distribute
# 4. Android: increment versionCode in build.gradle → Generate Signed Bundle → Upload to Play Console
```

See `CAPACITOR_NOTES.md` for detailed platform-specific build and troubleshooting steps.
