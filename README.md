# Return YouTube Live Subscriptions

This extension adds a "Live Subscriptions" section to the YouTube left sidebar.


## How it works

1. Open the YouTube sidebar and click Show More under Subscriptions.
2. Open the extension popup, go to the All Subscriptions tab, and click "Scan from YouTube".
3. The extension scrapes channel links from the visible YouTube sidebar Subscriptions entries.
4. The channel list is saved to `chrome.storage.local`.
5. A background service worker checks each saved channel's `/live` page and validates the candidate watch page is actively live.
6. Live channels are rendered in the injected sidebar panel.

## Popup tabs

- Live: shows currently live channels and quick links to channel/watch pages.
- All Subscriptions: shows the saved channel list, supports Scan from YouTube, Included/Excluded toggle for Live visibility, and manual remove (X).

## Scan behavior

- Scan is non-destructive.
- It adds newly discovered channels and updates titles/thumbnails.
- It does not auto-remove missing channels (to avoid accidental removal from partial sidebar scrapes).
- Use the X button in All Subscriptions for manual removal.

## Load in Chrome

### Option 1: Direct (development)

1. Run `bash build.sh` to assemble the Chrome build
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" and choose `build/chrome/`
5. Open YouTube and expand your Subscriptions section in the left sidebar
6. Open the extension popup and click "Scan from YouTube"

### Option 2: From source (for developers)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and choose the repo root
4. Click the extension puzzle icon → "Manage extensions" → check that `packages/shared/` files are loaded
5. Open YouTube and expand your Subscriptions, then scan

## Development

This repo uses a monorepo structure for multi-browser support:

```
packages/
├── shared/        # Shared source code (cross-browser)
│   ├── background.js, popup.*, youtube-sidebar.*
│   ├── icons/
│   └── PRIVACY.md
└── chrome/        # Chrome-specific (MV3 manifest only)
    └── manifest.json
```

**Build for Chrome:** `bash build.sh` → creates `build/chrome/`

**Future Firefox support:** Will add `packages/firefox/` with MV2 manifest, then update `build.sh` to support building Firefox variant.

## Notes

- Channel list key: `channelListV1`
- Live cache key: `liveChannelsCacheV3`
- Auto-refresh interval: 30 seconds
- Live cache TTL: 10 minutes

### Known limitation

Scanning only captures channels currently visible in the YouTube sidebar. If some subscriptions are hidden behind "Show more", expand first and scan again.
