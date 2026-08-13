# Return YouTube Live Subscriptions

This extension adds a "Live Subscriptions" section to the YouTube left sidebar.


## How it works

1. Open `https://www.youtube.com/feed/channels` and scroll down to load all subscriptions.
2. Open the extension popup, go to the Scan tab, and click "Scan from YouTube".
3. The extension scrapes channel links from the full subscriptions page.
4. The channel list is saved to `chrome.storage.local`.
5. Use the Options page to include or exclude channels from live checks and drag to set priority order.
6. A background service worker checks each included channel's `/live` page and validates the candidate watch page is actively live.
7. Live channels are rendered in the injected sidebar panel.

## Popup tabs

- Live: shows currently live channels and quick links to channel/watch pages.
- Scan: shows scanner instructions and runs Scan from YouTube.

## Options page

- Included list: channels currently used by live checks.
- Excluded list: channels kept in storage but skipped by live checks.
- Move channels between Included and Excluded with the row action button.
- Drag and drop within Included to set priority order.
- Priority is rank-based: higher rows get higher `userBoost`; excluded channels have `userBoost = 0`.

## Scan behavior

- Scan is non-destructive.
- It adds newly discovered channels and updates titles/thumbnails.
- It does not auto-remove missing channels (to avoid accidental removal from partial/incomplete page loads).
- Channel inclusion and priority are managed in the Options page.

## Load in Chrome

### Option 1: Direct (development)

1. Run `bash build.sh` to assemble the Chrome build
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" and choose `build/chrome/`
5. Open `https://www.youtube.com/feed/channels` and scroll down once
6. Open the extension popup, switch to Scan, and click "Scan from YouTube"
7. Open Options from the popup header to manage Included/Excluded and priority order

### Option 2: From source (for developers)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and choose the repo root
4. Click the extension puzzle icon → "Manage extensions" → check that `packages/shared/` files are loaded
5. Open `https://www.youtube.com/feed/channels`, scroll down, then scan
6. Open Options from the popup header to manage Included/Excluded and priority order

## Load in Firefox

1. Run `bash build.sh` to assemble the Firefox build
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `build/firefox/manifest.json`
5. Open `https://www.youtube.com/feed/channels` and scroll down once
6. Open the extension popup, switch to Scan, and click "Scan from YouTube"
7. Open Options from the popup header to manage Included/Excluded and priority order

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
