#!/bin/bash
# Build script to assemble extension packages from monorepo structure

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$REPO_ROOT/build"
CHROME_BUILD="$BUILD_DIR/chrome"
FIREFOX_BUILD="$BUILD_DIR/firefox"

# Clean previous builds
rm -rf "$CHROME_BUILD"
rm -rf "$FIREFOX_BUILD"
mkdir -p "$CHROME_BUILD"
mkdir -p "$FIREFOX_BUILD"

# Copy shared files
cp -r "$REPO_ROOT/packages/shared"/* "$CHROME_BUILD/"
cp -r "$REPO_ROOT/packages/shared"/* "$FIREFOX_BUILD/"

# Copy Chrome-specific manifest
cp "$REPO_ROOT/packages/chrome/manifest.json" "$CHROME_BUILD/"

# Copy Firefox-specific manifest
cp "$REPO_ROOT/packages/firefox/manifest.json" "$FIREFOX_BUILD/"

echo "✓ Chrome build ready at $CHROME_BUILD"
echo "✓ Firefox build ready at $FIREFOX_BUILD"
echo ""
echo "Next steps:"
echo "  1. Test: chrome://extensions → Load unpacked → $CHROME_BUILD"
echo "  2. Test Firefox: about:debugging#/runtime/this-firefox → Load Temporary Add-on → $FIREFOX_BUILD/manifest.json"
echo "  3. Package Chrome: zip -r return-yt-live-subscriptions-0.1.0.zip build/chrome/*"
echo "  4. Package Firefox: zip -r return-yt-live-subscriptions-firefox-0.1.0.zip build/firefox/*"
