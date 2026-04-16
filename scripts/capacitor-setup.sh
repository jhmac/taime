#!/usr/bin/env bash
# =============================================================================
# Taime — Capacitor Native App Setup
# Run this script on a macOS machine with Xcode + Android Studio installed.
# =============================================================================
set -euo pipefail

echo "🛍️  Taime Native App Setup"
echo "============================================================"

# ---- 1. Check prerequisites -------------------------------------------------
echo ""
echo "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo "❌  Node.js not found. Install from https://nodejs.org" && exit 1
fi
if ! command -v npx &>/dev/null; then
  echo "❌  npx not found. Run: npm install -g npx" && exit 1
fi
echo "✅  Node.js $(node --version)"

if ! command -v java &>/dev/null; then
  echo "⚠️   Java not found — Android build will not work."
  echo "     Install JDK 17+ from https://adoptium.net"
fi

if [[ "$(uname)" != "Darwin" ]]; then
  echo "⚠️   Non-macOS detected — iOS native project cannot be generated."
  echo "     Run this script on a Mac to add the iOS platform."
fi

# ---- 2. Install dependencies ------------------------------------------------
echo ""
echo "Installing npm dependencies..."
npm install

# ---- 3. Build the web app ---------------------------------------------------
echo ""
echo "Building web application..."
npm run build

# ---- 4. Initialize Capacitor (idempotent) -----------------------------------
echo ""
echo "Initializing Capacitor..."
npx cap sync --inline 2>/dev/null || true

# ---- 5. Add native platforms ------------------------------------------------
echo ""
echo "Adding native platforms..."

if [[ "$(uname)" == "Darwin" ]]; then
  if [ ! -d "ios" ]; then
    echo "  Adding iOS platform..."
    npx cap add ios
    echo "  ✅  iOS platform added."
  else
    echo "  ℹ️   iOS platform already exists, running sync..."
    npx cap sync ios
  fi
else
  echo "  ⏭️   Skipping iOS (macOS required)"
fi

if [ ! -d "android" ]; then
  echo "  Adding Android platform..."
  npx cap add android
  echo "  ✅  Android platform added."
else
  echo "  ℹ️   Android platform already exists, running sync..."
  npx cap sync android
fi

# ---- 6. Patch iOS Info.plist for permissions --------------------------------
if [[ "$(uname)" == "Darwin" ]] && [ -f "ios/App/App/Info.plist" ]; then
  echo ""
  echo "Checking iOS permission strings in Info.plist..."

  PLIST="ios/App/App/Info.plist"

  # Location — when in use
  if ! grep -q "NSLocationWhenInUseUsageDescription" "$PLIST"; then
    /usr/libexec/PlistBuddy -c \
      "Add :NSLocationWhenInUseUsageDescription string 'Taime uses your location to verify that you are at a work location before clocking you in.'" \
      "$PLIST"
    echo "  ✅  Added NSLocationWhenInUseUsageDescription"
  fi

  # Location — always
  if ! grep -q "NSLocationAlwaysAndWhenInUseUsageDescription" "$PLIST"; then
    /usr/libexec/PlistBuddy -c \
      "Add :NSLocationAlwaysAndWhenInUseUsageDescription string 'Taime uses your location in the background to automatically clock you out when you leave the work area.'" \
      "$PLIST"
    echo "  ✅  Added NSLocationAlwaysAndWhenInUseUsageDescription"
  fi

  # Camera
  if ! grep -q "NSCameraUsageDescription" "$PLIST"; then
    /usr/libexec/PlistBuddy -c \
      "Add :NSCameraUsageDescription string 'Taime uses your camera to record team updates and work documentation videos.'" \
      "$PLIST"
    echo "  ✅  Added NSCameraUsageDescription"
  fi

  # Microphone (required for video with audio)
  if ! grep -q "NSMicrophoneUsageDescription" "$PLIST"; then
    /usr/libexec/PlistBuddy -c \
      "Add :NSMicrophoneUsageDescription string 'Taime records audio during video updates so your team can hear your message clearly.'" \
      "$PLIST"
    echo "  ✅  Added NSMicrophoneUsageDescription"
  fi

  # Photo library
  if ! grep -q "NSPhotoLibraryUsageDescription" "$PLIST"; then
    /usr/libexec/PlistBuddy -c \
      "Add :NSPhotoLibraryUsageDescription string 'Taime can attach photos from your library to work documentation and team updates.'" \
      "$PLIST"
    echo "  ✅  Added NSPhotoLibraryUsageDescription"
  fi

  echo "  ✅  Info.plist permissions verified."
fi

# ---- 7. Patch Android AndroidManifest.xml for permissions ------------------
if [ -f "android/app/src/main/AndroidManifest.xml" ]; then
  echo ""
  echo "Checking Android permissions in AndroidManifest.xml..."

  MANIFEST="android/app/src/main/AndroidManifest.xml"

  add_permission() {
    local perm="$1"
    if ! grep -q "$perm" "$MANIFEST"; then
      sed -i '' "s|<manifest|<uses-permission android:name=\"$perm\" />\n<manifest|" "$MANIFEST" 2>/dev/null \
        || sed -i "s|<manifest|<uses-permission android:name=\"$perm\" />\n<manifest|" "$MANIFEST"
      echo "  ✅  Added $perm"
    fi
  }

  add_permission "android.permission.ACCESS_FINE_LOCATION"
  add_permission "android.permission.ACCESS_COARSE_LOCATION"
  add_permission "android.permission.ACCESS_BACKGROUND_LOCATION"
  add_permission "android.permission.CAMERA"
  add_permission "android.permission.RECORD_AUDIO"
  add_permission "android.permission.READ_MEDIA_IMAGES"
  add_permission "android.permission.READ_MEDIA_VIDEO"

  echo "  ✅  AndroidManifest.xml permissions verified."
fi

# ---- 8. App icon & splash screen -------------------------------------------
echo ""
echo "App icon & splash screen:"
echo "  1. Place a 1024×1024 PNG at: resources/icon.png"
echo "  2. Place a 2732×2732 PNG at: resources/splash.png"
echo "  3. Run: npx @capacitor/assets generate"
echo "  See: https://capacitorjs.com/docs/guides/splash-screens-and-icons"

# ---- 9. Open native IDEs ---------------------------------------------------
echo ""
echo "Setup complete!"
echo ""
echo "To open in Xcode:          npx cap open ios"
echo "To open in Android Studio: npx cap open android"
echo ""
echo "After each web build, sync with: npx cap sync"
echo ""
echo "APNs / FCM push notifications:"
echo "  iOS:     Add APNs key in Apple Developer → Certificates, then configure"
echo "           Firebase Cloud Messaging and paste the FCM config into Capacitor."
echo "  Android: Add google-services.json to android/app/ from Firebase Console."
echo ""
echo "See CAPACITOR_NOTES.md for App Store & Google Play submission steps."
