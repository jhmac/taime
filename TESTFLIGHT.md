# Taime — TestFlight Runbook

A linear, copy-paste guide to get a Taime build onto your iPhone via TestFlight.
Everything below assumes a fresh start. Once you've done it once, the "Each
release after the first" section at the bottom is the only part you keep
running.

> **Why this is shorter than typical iOS runbooks**
> `capacitor.config.ts` uses `server.url: https://taime.us`, so the
> iOS app is a thin shell that loads your live web app. **You do not need a
> new TestFlight build for code changes.** Push to Replit, redeploy, and
> existing testers see the update on next app open. You only need a new
> TestFlight build when the Capacitor config, native plugins, app icon /
> splash, or iOS permission strings change.

---

## What you need before you start

| Item | How to get it | Cost |
|---|---|---|
| A Mac | Borrow, rent (MacinCloud / MacStadium), or own one. Apple Silicon strongly preferred. | — |
| Xcode (latest stable, currently 16.x) | Mac App Store (free, ~10 GB download) | Free |
| Apple ID | You already have one if you have an iPhone | Free |
| Apple Developer Program membership | https://developer.apple.com/programs — enroll with your Apple ID, takes 24–48h to approve | $99 / year |
| App Store Connect access | Auto-granted to your Apple Developer account | Free |
| The Taime repo cloned on the Mac | `git clone …` of this project | — |

You **cannot** do iOS builds from Linux, Windows, or Replit's container.
Apple's signing pipeline only runs on macOS.

---

## One-time setup on the Mac (≈ 30 minutes)

### 1. Install Node and dependencies

```bash
# Node 20 (matches CI). If you don't have nvm:
brew install node@20

cd /path/to/taime
npm install
```

### 2. Generate the iOS native project

```bash
./scripts/capacitor-setup.sh
```

This script:

- Builds the web app (`npm run build`)
- Runs `npx cap add ios` (creates the `ios/` directory — never commit
  build artifacts inside it, they regenerate)
- Patches `ios/App/App/Info.plist` with all required permission strings
  (location when-in-use, location always, camera, mic, photo library)
- Also creates the Android project on the side; ignore it for TestFlight

When it finishes, `ios/App/App.xcworkspace` exists.

### 3. Open the project in Xcode

```bash
npx cap open ios
```

Xcode opens `App.xcworkspace`. **Always use the `.xcworkspace`, never
`.xcodeproj`.**

### 4. Wire up your Apple Developer account

In Xcode, in the project navigator on the left, click the blue **App**
project icon at the top, then in the main editor:

1. **Signing & Capabilities** tab.
2. Tick **Automatically manage signing**.
3. **Team** dropdown → pick your Apple Developer Program team. (If it's
   empty, go to **Xcode → Settings → Accounts**, click `+`, sign in with
   your Apple ID, then come back.)
4. **Bundle Identifier** must read `com.taime.app`. It should already.
5. Xcode will show "Provisioning profile created" once signing is happy.

### 5. Add the capabilities Taime uses

Still on the **Signing & Capabilities** tab, click **+ Capability** in the
top-left of that pane and add each of these:

- **Push Notifications** — needed even if you haven't wired APNs yet, so
  the entitlement is in the build
- **Background Modes** — then tick:
  - Location updates
  - Remote notifications
  - Background fetch

These match the plugins in `capacitor.config.ts`.

### 6. Create the App Store Connect record

1. Go to https://appstoreconnect.apple.com → **My Apps → +** → **New App**.
2. Fill in:
   - Platform: **iOS**
   - Name: **Taime** (must be globally unique on the App Store; if taken,
     try `Taime — Boutique Manager` or similar — only the display name
     matters for TestFlight)
   - Primary language: English (U.S.)
   - Bundle ID: pick **com.taime.app** from the dropdown (it appears
     because Xcode registered it in step 4)
   - SKU: anything internal, e.g. `taime-ios-001`
   - User Access: Full Access
3. Click **Create**.

You don't need to fill in screenshots, descriptions, App Privacy, etc.
to use TestFlight — those are only required for public App Store
submission.

---

## First build and upload (≈ 15 minutes)

### 1. Build the web app and sync into iOS

From the repo root:

```bash
./scripts/build-native.sh
```

This runs `npm run build` then `npx cap sync ios`, which copies
`dist/public` into the iOS bundle.

### 2. Bump the build number

In Xcode, on the **General** tab of the App target:

- **Version** — user-visible (e.g. `1.0.0`). Bump on user-meaningful
  releases.
- **Build** — internal. **Must increase every upload.** Apple rejects a
  re-upload of the same `(Version, Build)` pair. Easiest: use whole
  numbers and add 1 each time (1, 2, 3, …).

### 3. Archive

In Xcode's top toolbar:

1. Set the destination (left of the Run button) to **Any iOS Device
   (arm64)**. Not a simulator — the App Store rejects simulator builds.
2. Menu: **Product → Archive**.
3. Wait 2–5 min. The Organizer window opens when it finishes.

### 4. Upload to App Store Connect

In the Organizer:

1. Select the new archive.
2. **Distribute App** → **App Store Connect** → **Upload** → keep all
   defaults → **Upload**.
3. Wait ~3–5 min while Xcode signs and uploads.

### 5. Wait for processing

In App Store Connect → Taime → **TestFlight** tab:

- The new build appears with status **Processing** (5–15 min).
- Then it shows **Missing Compliance** — click the build, answer the
  encryption question (Taime uses HTTPS only, so the answer is "uses
  standard exempt encryption"), save.
- Status flips to **Ready to Test**.

### 6. Add yourself as a tester

In App Store Connect → Taime → TestFlight:

1. Left sidebar: **Internal Testing → +** to create a group (e.g.
   "Founders").
2. Add testers by Apple ID email. They must be added as users in
   App Store Connect first (**Users and Access** in the top nav). For
   yourself, you're already there.
3. Tick the new build to attach it to the group → **Save**.
4. The tester gets an email with an invite link.

### 7. Install on your iPhone

1. Install **TestFlight** from the App Store on the iPhone.
2. Open the invite email on the iPhone, tap **View in TestFlight**.
3. Install Taime. It shows up like any other app.

That's it — you're on TestFlight.

---

## Each release after the first

When you only changed the web app (the common case) — **do nothing on the
Mac**. Push to Replit, redeploy, and the change is live in TestFlight
installs immediately.

When you changed something native (Capacitor config, plugin versions,
icon, permission strings):

```bash
cd /path/to/taime
git pull
./scripts/build-native.sh
npx cap open ios
```

Then in Xcode:
1. Bump the **Build** number (always required)
2. **Product → Archive**
3. Organizer → **Distribute App → App Store Connect → Upload**
4. Wait for processing in App Store Connect, then attach to your tester
   group

Total time per native release after the first: ~10 minutes of clicking.

---

## Push notifications (when you're ready)

The `PushNotifications` plugin and the **Push Notifications** capability
are already wired up so the iOS shell can register for tokens, **but
notifications won't actually be delivered until you set up APNs.** Steps,
in order, when you want to enable them:

1. **Apple Developer → Certificates, Identifiers & Profiles → Keys → +**
   → name it "Taime APNs" → tick **Apple Push Notifications service
   (APNs)** → Continue → Register → **download the `.p8` file** (you
   only get one chance) and note the Key ID.
2. **App Store Connect → Apps → Taime → App Information → APNs Key** —
   upload the `.p8`, paste the Key ID and your Team ID.
3. On the backend side, plug the same key/ID/Team into whichever push
   service you're using (the project already has `VAPID_PRIVATE_KEY` /
   `VAPID_PUBLIC_KEY` for web push; native iOS push goes through APNs
   directly or through Firebase Cloud Messaging — see
   `CAPACITOR_NOTES.md` for the existing plumbing).

Push setup is independent of getting the app on TestFlight — install
first, wire push later.

---

## Common gotchas

| Symptom | Fix |
|---|---|
| Xcode "No accounts found" | **Xcode → Settings → Accounts → +** and sign in with the Apple ID that owns your Developer Program membership |
| Archive menu greyed out | Destination is set to a Simulator. Change it to **Any iOS Device (arm64)** |
| "An archive with this version and build number has already been uploaded" | Bump the **Build** number in Xcode → General |
| Upload succeeds but build never appears in TestFlight | Wait 15 minutes; if still missing, check email for an Apple processing-rejection notice |
| TestFlight invite email never arrives | Tester wasn't added to **Users and Access** first, or the email went to the spam folder of the Apple ID address (not the address you typed) |
| White screen on launch | The web app at `https://taime.us` is down or the deploy is broken. Check the Replit deployment first — the iOS shell just loads that URL |
| Location prompt doesn't appear | The Info.plist strings weren't added — re-run `./scripts/capacitor-setup.sh` |

---

## What this runbook does NOT cover

- **Public App Store submission** — needs screenshots in 3 device sizes,
  marketing description, App Privacy questionnaire, age rating, Apple
  review (1–3 days). Out of scope until you're past TestFlight.
- **Android / Google Play** — separate flow; the `capacitor-setup.sh`
  script already creates the `android/` project for you when you're
  ready.
- **CI-driven builds** — running this whole pipeline from GitHub Actions
  on a macOS runner so you never touch Xcode again. That's worth doing
  once you're tired of the manual flow; ask and I'll set it up as a
  separate task.
