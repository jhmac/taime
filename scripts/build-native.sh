#!/usr/bin/env bash
# =============================================================================
# Taime — Native Build Pipeline
# Run this script after any change to the web app before opening Xcode /
# Android Studio or submitting to the App Store / Google Play.
#
# Usage:
#   ./scripts/build-native.sh
#
# To target a specific deployment URL (overrides capacitor.config.ts default):
#   TAIME_PRODUCTION_URL=https://taime.us ./scripts/build-native.sh
# =============================================================================
set -euo pipefail

echo "🛍️  Taime — Native Build Pipeline"
echo "============================================================"

# Validate that native platforms have been added first
if [ ! -d "ios" ] && [ ! -d "android" ]; then
  echo ""
  echo "⚠️  No native platform directories found (ios/ or android/)."
  echo "   Run scripts/capacitor-setup.sh first to generate them."
  echo ""
fi

# Ensure production URL is set
if [ -z "${TAIME_PRODUCTION_URL:-}" ]; then
  echo ""
  echo "ℹ️  TAIME_PRODUCTION_URL is not set."
  echo "   Defaulting to: https://taime.us"
  echo "   To override: TAIME_PRODUCTION_URL=https://your-app.replit.app ./scripts/build-native.sh"
  echo ""
fi

# ---- 1. Build the web application ------------------------------------------
echo ""
echo "Building web application..."
npm run build
echo "✅  Web build complete."

# ---- 2. Sync native projects (copies built assets + updates plugins) --------
echo ""
echo "Syncing native projects with Capacitor..."
npx cap sync
echo "✅  Cap sync complete."

# ---- 3. Next steps ----------------------------------------------------------
echo ""
echo "============================================================"
echo "Native build pipeline complete."
echo ""
echo "To open in Xcode:          npx cap open ios"
echo "To open in Android Studio: npx cap open android"
echo ""
echo "Re-run this script after every web app change."
echo "============================================================"
