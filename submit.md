# Taime — App Store Submission Guide

Step-by-step walkthrough for submitting Taime to the **Apple App Store** and **Google Play Store**.
Every field that the stores ask for is pre-filled below. Work through each section in order.

---

## Quick Reference

| Field | Value |
|-------|-------|
| App name | `Taime` |
| Subtitle (iOS) | `AI Boutique Manager` |
| Bundle / Package ID | `com.taime.app` |
| SKU (iOS) | `taime-app-001` |
| Version | `1.0.0` |
| Build number (iOS) | `1` |
| Version code (Android) | `1` |
| Copyright | `© 2026 Taime` |
| Age rating | `4+` |
| Primary category | `Business` |
| Secondary category (iOS) | `Productivity` |
| Support URL | `https://taime.replit.app/support` |
| Marketing URL | `https://taime.replit.app` |
| Privacy Policy URL | `https://taime.replit.app/privacy` |

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

### First-time setup (run once on a macOS machine)

```bash
# 1. Clone / pull latest code
git pull

# 2. Initial platform setup — adds ios/ and android/ directories
bash scripts/capacitor-setup.sh
```

### iOS build (every release)

```bash
# 1. Build the web application
npm run build

# 2. Sync web assets + plugins into the iOS native project
npx cap sync ios

# 3. Open Xcode
npx cap open ios
```

### Android build (every release)

```bash
# 1. Build the web application
npm run build

# 2. Sync web assets + plugins into the Android native project
npx cap sync android

# 3. Open Android Studio
npx cap open android
```

> **Or** use the combined pipeline script which runs build + sync in one step:
> ```bash
> TAIME_PRODUCTION_URL=https://taime.replit.app ./scripts/build-native.sh
> ```

> **Important:** The native WebView loads all content (frontend + API calls) from
> `https://taime.replit.app`. The Replit deployment must be live before building
> native binaries.

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

This produces all icon and splash sizes for both iOS and Android from these two source files.

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
5. Click **Continue → Register**

### 3.2 Create a Distribution Certificate

1. **Certificates → +** → **Apple Distribution**
2. Follow the CSR wizard (Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority)
3. Upload the `.certSigningRequest` file
4. Download the `.cer` file and double-click to install in Keychain
5. This certificate signs every App Store build

### 3.3 Create an App Store Provisioning Profile

1. **Profiles → +** → **App Store Connect**
2. Select the `com.taime.app` App ID
3. Select your Distribution certificate
4. Name: `Taime App Store`
5. Download and double-click to install

### 3.4 Set Up APNs Auth Key (Push Notifications)

1. **Keys → +**
2. Key name: `Taime APNs Key`
3. Enable **Apple Push Notifications service (APNs)**
4. Click **Continue → Register → Download**

> ⚠️ The `.p8` file can only be downloaded **once**. Store it securely (password manager + encrypted backup).

5. Note these three values — you will need all three:
   - **Key ID** — 10-character alphanumeric code (shown on the key detail page)
   - **Team ID** — 10-character code (shown top-right of the developer portal under your account name)
   - **Bundle ID:** `com.taime.app`

6. In the Taime admin panel → **Settings → Push Notifications**, enter:
   - APNs Key content (paste the full `.p8` file text)
   - Key ID
   - Team ID
   - Bundle ID: `com.taime.app`

### 3.5 Configure Xcode

```bash
npx cap open ios
```

In Xcode:

1. Select target **App** → **Signing & Capabilities**
2. Set **Bundle Identifier:** `com.taime.app`
3. Select your Apple Developer **Team**
4. Confirm **Provisioning Profile:** Taime App Store
5. Click **+ Capability** and add:
   - **Push Notifications**
   - **Background Modes** → enable ✅ Remote notifications, ✅ Location updates

### 3.6 Archive and Upload to App Store Connect

1. Set scheme destination to **Any iOS Device (arm64)** — never a simulator
2. **Product → Archive**
3. When archive completes, click **Distribute App**
4. Select **App Store Connect** → **Upload**
5. Accept defaults through the wizard (Automatically manage signing is fine)
6. The build will appear in App Store Connect within ~10 minutes

### 3.7 Create the App Record in App Store Connect

Go to [App Store Connect → My Apps → +](https://appstoreconnect.apple.com/apps) → **New App**

| Field | Value |
|-------|-------|
| Platforms | iOS |
| Name | `Taime` |
| Primary Language | English (U.S.) |
| Bundle ID | `com.taime.app` (select from dropdown) |
| SKU | `taime-app-001` |
| User Access | Full Access |

### 3.8 App Information

| Field | Value |
|-------|-------|
| Name | `Taime` |
| Subtitle | `AI Boutique Manager` |
| Primary Category | Business |
| Secondary Category | Productivity |
| Content Rights | Does not contain third-party content |
| Age Rating | 4+ |
| Copyright | `© 2026 Taime` |

### 3.9 Pricing & Availability

- Price: **Free**
- Availability: **All territories** (or United States only for initial launch)

### 3.10 App Store Listing — Version 1.0.0

#### Promotional Text (170 chars max — updateable without resubmission)

```
AI-powered workforce management for boutique & retail teams. Smart scheduling, geofenced clock-in, and real-time team insights.
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

---
Taime requests location permission for geofenced clock-in verification. Location is accessed only when you tap Clock In and is not tracked continuously. Background clock-out detection is opt-in and explained in the app before it is enabled.
```

#### Keywords (100 chars max — no spaces after commas)

```
time tracking,scheduling,team management,boutique,clock in,geofence,shifts,staff
```

#### URLs

| Field | Value |
|-------|-------|
| Support URL | `https://taime.replit.app/support` |
| Marketing URL | `https://taime.replit.app` |
| Privacy Policy URL | `https://taime.replit.app/privacy` |

### 3.11 Screenshot Requirements

As of 2024, **iPhone 6.9"** and **iPad Pro 13"** screenshots are required for every submission.

| Device | Pixel size | Required |
|--------|-----------|----------|
| iPhone 6.9" (iPhone 16 Pro Max) | 1320×2868 or 1290×2796 px | ✅ Required |
| iPhone 5.5" (iPhone 8 Plus) | 1242×2208 px | Optional (serves older devices) |
| iPad Pro 13" (M4) | 2064×2752 px | ✅ Required |
| iPad Pro 11" | 1668×2388 px | Optional |

**Rules:** PNG or JPEG, RGB color space, no alpha, minimum 2 per device, maximum 10.

**Recommended screenshot order:**
1. Morning Huddle / Dashboard — "Your team, at a glance"
2. Clock In screen with geofence confirmed — "Location-verified time tracking"
3. AI Schedule view — "Shifts built by AI, approved by you"
4. Task Management — "Keep the store running on task"
5. AI Chat — "Ask your AI boutique manager anything"

### 3.12 App Icon

- **Size:** 1024×1024 px
- **Format:** PNG, no alpha channel, no transparency, no rounded corners (Apple applies rounding)
- **Source file:** `resources/icon.png` (run `npx @capacitor/assets generate` to produce all variants)

### 3.13 App Review Information

| Field | Value |
|-------|-------|
| Sign-in required | Yes |
| Demo username | Create a manager account at https://taime.replit.app using Sign Up, then note the email here: `reviewer@taime-demo.com` (create this account before submitting) |
| Demo password | Set a memorable password and note it here before submitting |
| Contact first name | *Your first name* |
| Contact last name | *Your last name* |
| Contact phone | *+1 (area code) number — must be reachable during review* |
| Contact email | *Your email address — Apple will contact you here if rejected* |
| Notes for reviewer | See note below |

**Notes for reviewer (paste into App Store Connect):**
```
Taime is a workforce management app for retail boutiques. Sign in with the provided
manager account to explore all features:

1. Dashboard and Morning Huddle — visible immediately after sign-in
2. Time Clock — tap Clock In (location permission required; use a real device or grant
   simulator location access in Xcode → Features → Location → Custom Location,
   set lat 32.42, long -90.13 for Ridgeland MS)
3. Schedule — view and edit the team's weekly schedule
4. Tasks — create, assign, and complete tasks
5. AI Assistant — ask any question about store operations

Location is requested only when the Clock In button is tapped, not on app launch.
Push notifications are used for clock-in status, schedule updates, and task assignments.
```

### 3.14 Privacy Nutrition Labels

In App Store Connect → **App Privacy** → **Get Started**, declare:

| Data type | Collected | Linked to Identity | Used for Tracking |
|-----------|-----------|-------------------|-------------------|
| Precise Location | Yes | Yes | No |
| User ID | Yes | Yes | No |
| Device ID (push token) | Yes | Yes | No |
| Crash Data | Yes | No | No |

For each declared item, select purpose **App Functionality**.

### 3.15 Export Compliance

> **Does your app use encryption beyond what is provided by the OS?** → **No**

Taime uses standard HTTPS (TLS) provided by iOS. No custom encryption algorithms are implemented. Select **No** on all encryption questions.

### 3.16 Version Release

Choose one:
- **Manually release this version** — recommended for first release (you control exact go-live time)
- **Automatically release after approval** — app goes live immediately after Apple approves

### 3.17 Common iOS Rejection Reasons — and How Taime Avoids Them

| Rejection Reason | Mitigation |
|-----------------|------------|
| Background location without clear justification | App only uses background location if the user explicitly enables background clock-out. Explained in permission dialog and reviewer notes above. |
| Push notifications not justified | Push is used for clock-in approval, schedule changes, and task assignments — directly useful to the user. Described in reviewer notes. |
| Missing or inaccessible privacy policy | Privacy policy at `https://taime.replit.app/privacy` must load without sign-in. |
| Demo account not working at review time | Test the demo account fresh before submitting. Ensure the Replit deployment is live. |
| Crashes on review device | Test on a real iPhone, not only in Simulator. |
| Age rating inappropriate | No user-generated content shared publicly, no social features, no objectionable content. 4+ is correct. |

### 3.18 Submit for Review

1. In App Store Connect, go to your version
2. Select the uploaded build in **Build**
3. Confirm all required fields are complete (no red indicators)
4. Click **Add for Review → Submit to App Review**
5. Typical review time: **1–3 business days**
6. Monitor status in App Store Connect and via email

---

## Part 4 — Google Play Store

### 4.1 Set Up Firebase & FCM

1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project**
   - Project name: `Taime`
   - Disable Google Analytics if desired
2. Inside the project: **Add app → Android**
   - Android package name: `com.taime.app`
   - App nickname: `Taime Android`
3. Download **`google-services.json`**
4. Place the file at: `android/app/google-services.json`

   > ⚠️ Do **not** commit `google-services.json` to git — add it to `.gitignore`.

5. In Firebase Console → **Project Settings → Service Accounts**:
   - Click **Generate new private key** → download the JSON
6. In the Taime admin panel → **Settings → Push Notifications**, paste the FCM service account JSON.

### 4.2 Generate a Signing Keystore

> ⚠️ **CRITICAL:** Every future update to the app must be signed with this same keystore.
> If the keystore is lost, you **cannot** publish updates. Back it up to at least two secure locations.

```bash
keytool -genkey -v \
  -keystore taime-release.keystore \
  -alias taime \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Fill in each prompt exactly:

| Prompt | Value |
|--------|-------|
| Keystore password | *(create a strong password and save it in your password manager)* |
| Re-enter password | *(same password)* |
| First and last name | `Taime` |
| Organizational unit | `Engineering` |
| Organization | `Taime` |
| City or Locality | `Ridgeland` |
| State or Province | `MS` |
| Country code (2 letter) | `US` |
| Key password | *(same as keystore password, or set a different one — save it)* |

Store `taime-release.keystore` in your password manager **and** an encrypted external backup.
Add it to `.gitignore` — never commit it.

### 4.3 Build the Signed AAB

```bash
# 1. Build the web application
npm run build

# 2. Sync web assets + plugins into the Android native project
npx cap sync android

# 3. Open Android Studio
npx cap open android
```

In Android Studio:

1. **Build → Generate Signed Bundle / APK**
2. Select **Android App Bundle**
3. **Key store path:** browse to `taime-release.keystore`
4. Enter **Key store password**, **Key alias:** `taime`, **Key password**
5. Select **release** build variant
6. Click **Finish**

The output file is at: `android/app/release/app-release.aab`

### 4.4 Create the App in Google Play Console

Go to [Google Play Console → Create app](https://play.google.com/console)

| Field | Value |
|-------|-------|
| App name | `Taime` |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |

Accept the Developer Program Policies and US export laws, then click **Create app**.

### 4.5 Store Listing

#### Main Store Listing

| Field | Value |
|-------|-------|
| App name | `Taime` |
| Short description (80 chars max) | `AI-powered team management for boutique & retail businesses` |
| Package name | `com.taime.app` |

#### Full Description (4000 chars max — same text as iOS)

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
Taime requests location permission for geofenced clock-in verification. Location is accessed only when you tap Clock In and is not tracked continuously. Background clock-out detection is opt-in and explained in the app before it is enabled.
```

#### Categorization & Contact

| Field | Value |
|-------|-------|
| App category | Business |
| Tags | `Time Tracking`, `Scheduling`, `Team Management` |
| Email address | *Your store or developer support email — e.g. `support@yourstore.com`* |
| Website | `https://taime.replit.app` |
| Privacy Policy URL | `https://taime.replit.app/privacy` |

### 4.6 App Icon & Feature Graphic

| Asset | Size | Format |
|-------|------|--------|
| App icon | 512×512 px | PNG, no alpha |
| Feature graphic (Play Store banner) | 1024×500 px | PNG or JPEG |

The app icon is generated by `npx @capacitor/assets generate` from `resources/icon.png`.
Create the feature graphic separately as a 1024×500 banner image.

### 4.7 Screenshot Requirements

| Surface | Minimum size | Required count |
|---------|-------------|----------------|
| Phone | 1080×1920 px | At least 2 |
| 7-inch tablet | 1200×1920 px | Recommended |
| 10-inch tablet | 1920×1200 px | Recommended |

**Rules:** PNG or JPEG, no device frame required, portrait or landscape.

### 4.8 Version Details

| Field | Value |
|-------|-------|
| Version name | `1.0.0` |
| Version code | `1` |

For future releases, increment `versionCode` in `android/app/build.gradle`:

```gradle
defaultConfig {
    versionCode 2       // increment by 1 each release
    versionName "1.0.1" // update semantic version
}
```

### 4.9 Data Safety Section

In Play Console → **Data safety**, declare the following data types:

| Data type | Collected | Shared | Required | Purpose |
|-----------|-----------|--------|----------|---------|
| Precise location | Yes | No | Yes | App functionality (clock-in) |
| Approximate location | Yes | No | No | App functionality |
| User IDs | Yes | No | Yes | Account management |
| Device IDs (push token) | Yes | No | Yes | Push notifications |
| App interactions / usage | Yes | No | No | Analytics |
| Crash logs | Yes | No | No | App functionality |

- **Is data encrypted in transit?** → Yes
- **Can users request data deletion?** → Yes (via account deletion in-app or by emailing support)

### 4.10 Content Rating Questionnaire

Answer the **IARC questionnaire** as follows:

| Question | Answer |
|----------|--------|
| Violence | None |
| Sexual content | None |
| Language | None |
| Controlled substances | None |
| User-generated content visible to other users | No |
| Gambling | No |
| Real-money purchases | No |

Expected rating: **Everyone (E)**

### 4.11 Release Strategy

**Recommended: start with a closed test before production.**

1. Upload the `.aab` to **Internal testing** track
2. Add tester email addresses
3. Install via the Play Store internal testing link on a real Android device
4. Verify: clock-in (grant location), push notifications, schedule, tasks, AI chat

5. When testing passes, create a **Production release**:
   - Upload same `.aab` (or rebuild with incremented version code)
   - Set initial rollout to **20%** — monitor crash rate and reviews for 48 hours
   - Expand to 100%

6. Typical review time for new apps: **3–7 business days**

### 4.12 Common Android Rejection Reasons — and How Taime Avoids Them

| Rejection Reason | Mitigation |
|-----------------|------------|
| `ACCESS_BACKGROUND_LOCATION` without justification | Required for background clock-out. Justify in the Play Console declaration and in the app's runtime permission dialog. Google may request a demo video. |
| Target API level below requirement | `targetSdkVersion` must be 34+ (Android 14). Verify in `android/app/build.gradle`. |
| Privacy policy inaccessible | `https://taime.replit.app/privacy` must load without sign-in. |
| Data Safety section incomplete | Declare every collected data type with collection purpose and retention policy. |
| AAB signed with debug key | Always use `taime-release.keystore`, not the debug keystore. |
| Signing enrolled in Play App Signing | Enroll on first upload — Google manages key security going forward. |

---

## Part 5 — Post-Submission Checklist

- [ ] App Store Connect: build selected, all required fields green (no red indicators)
- [ ] Google Play Console: store listing 100% complete
- [ ] `https://taime.replit.app/privacy` loads publicly without sign-in
- [ ] `https://taime.replit.app/support` loads publicly without sign-in
- [ ] Demo account (`reviewer@taime-demo.com` or equivalent) tested and working
- [ ] `resources/icon.png` is the final branded 1024×1024 asset (not the placeholder)
- [ ] `resources/splash.png` is the final branded 2732×2732 asset (not the placeholder)
- [ ] `google-services.json` is in `android/app/` — **not** committed to git
- [ ] `taime-release.keystore` backed up to password manager and encrypted external storage — **not** committed to git
- [ ] APNs key ID, Team ID, and `.p8` file contents saved in Taime admin settings
- [ ] FCM service account JSON saved in Taime admin settings
- [ ] App tested end-to-end on a real iOS device (not Simulator)
- [ ] App tested end-to-end on a real Android device

---

## Part 6 — Ongoing Update Workflow

For every app update after initial submission:

```bash
# 1. Deploy web app changes to Replit
npm run build
# Publish via Replit dashboard

# 2. iOS update
npm run build
npx cap sync ios
npx cap open ios
# In Xcode: increment build number → Product → Archive → Distribute App → App Store Connect

# 3. Android update
npm run build
npx cap sync android
npx cap open android
# In Android Studio: increment versionCode in build.gradle → Generate Signed Bundle → Upload to Play Console
```

See `CAPACITOR_NOTES.md` for detailed platform-specific build steps and troubleshooting.
