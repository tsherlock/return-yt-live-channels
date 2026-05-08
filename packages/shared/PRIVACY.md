# Privacy Policy — Return YouTube Live Subscriptions

**Last updated: May 2026**

## Data Collection & Storage

Return YouTube Live Subscriptions does **not** collect, transmit, or store any personal data on external servers.

All extension data is stored locally on your device using Chrome's `chrome.storage.local` API, including:
- Your saved subscription list
- Live channel status cache
- Exclude toggles for individual channels

This data never leaves your browser and is not shared with any third party.

## What the Extension Accesses

The extension reads:
- YouTube sidebar subscription entries to find channel links
- YouTube `/live` and `/watch` pages to check if channels are currently streaming

These operations happen entirely within your browser for display purposes only.

## Permissions Justification

- **`storage`**: Required to save and load your subscription list locally
- **`tabs`**: Required to open YouTube links in your active tab and detect which tab is YouTube

## Changes to This Policy

We may update this policy. Changes will be posted here with an updated date.

## Contact

For questions about this privacy policy, please visit the extension's GitHub repository.
