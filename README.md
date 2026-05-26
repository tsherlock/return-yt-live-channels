# Return YouTube Live Subscriptions

This extension adds a "Live Subscriptions" section to the YouTube left sidebar.


## How it works

1. Open `https://www.youtube.com/feed/channels` and scroll down to load all subscriptions.
2. Open the extension popup, go to the All Subscriptions tab, and click "Scan from YouTube".
3. The extension scrapes channel links from the full subscriptions page.
4. The channel list is saved to `chrome.storage.local`.
5. A background service worker checks each saved channel's `/live` page and validates the candidate watch page is actively live.
6. Live channels are rendered in the injected sidebar panel.

## Popup tabs

- Live: shows currently live channels and quick links to channel/watch pages.
- All Subscriptions: shows the saved channel list, supports Scan from YouTube, Included/Excluded toggle for Live visibility, and manual remove (X).

## Scan behavior

- Scan is non-destructive.
- It adds newly discovered channels and updates titles/thumbnails.
- It does not auto-remove missing channels (to avoid accidental removal from partial/incomplete page loads).
- Use the X button in All Subscriptions for manual removal.

## Load in Chrome

### Option 1: Direct (development)

1. Run `bash build.sh` to assemble the Chrome build
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" and choose `build/chrome/`
5. Open `https://www.youtube.com/feed/channels` and scroll down once
6. Open the extension popup and click "Scan from YouTube"

### Option 2: From source (for developers)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and choose the repo root
4. Click the extension puzzle icon → "Manage extensions" → check that `packages/shared/` files are loaded
5. Open `https://www.youtube.com/feed/channels`, scroll down, then scan

## Load in Firefox

1. Run `bash build.sh` to assemble the Firefox build
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `build/firefox/manifest.json`
5. Open `https://www.youtube.com/feed/channels` and scroll down once
6. Open the extension popup and click "Scan from YouTube"

## Development

This repo uses a monorepo structure for multi-browser support:

```
packages/
├── shared/        # Shared source code (cross-browser)
│   ├── background.js, popup.*, youtube-sidebar.*
│   ├── icons/
│   └── PRIVACY.md
├── chrome/        # Chrome-specific manifest
│   └── manifest.json
└── firefox/       # Firefox-specific manifest
    └── manifest.json
```

**Build:** `bash build.sh` → creates both `build/chrome/` and `build/firefox/`

## Notes

- Channel list key: `channelListV1`
- Live cache key: `liveChannelsCacheV3`
- Auto-refresh interval: 30 seconds
- Live cache TTL: 10 minutes

### Known limitation

Scanning quality depends on `/feed/channels` fully loading your subscriptions. Scroll to the bottom once before scanning for best results.
