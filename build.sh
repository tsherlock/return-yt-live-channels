#!/bin/bash
# Build script to assemble extension packages from monorepo structure

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$REPO_ROOT/build"
CHROME_BUILD="$BUILD_DIR/chrome"

# Clean previous builds
rm -rf "$CHROME_BUILD"
mkdir -p "$CHROME_BUILD"

# Copy shared files
cp -r "$REPO_ROOT/packages/shared"/* "$CHROME_BUILD/"

# Copy Chrome-specific manifest
cp "$REPO_ROOT/packages/chrome/manifest.json" "$CHROME_BUILD/"

echo "✓ Chrome build ready at $CHROME_BUILD"
echo ""
echo "Next steps:"
echo "  1. Test: chrome://extensions → Load unpacked → $CHROME_BUILD"
echo "  2. Package: zip -r return-yt-live-subscriptions-0.1.0.zip build/chrome/*"
