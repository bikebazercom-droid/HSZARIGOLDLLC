---
name: Gold-shop live rate integration
description: How the GoldAPI.io live/manual rate toggle is designed for the Gold Shop app — persistence, restore behavior, USD/AED conversion.
---

The Live Gold Rate API Integration (GoldAPI.io) toggle on the Prices page connects/disconnects live 24K/22K/Silver AED rates.

- Connection state and rates are persisted in the `prices` table (`liveModeConnected`, `liveGoldRate24k/22k`, `liveSilverRate`, `liveLastSyncedAt`), not localStorage or client-side state.
  **Why:** requirement was for state to survive reloads and work across devices/sessions, not just the current browser.
- Before overwriting manual rates on connect, the previous manual values are snapshotted into `preLive*` columns (`preLiveGoldJewelryRate`, `preLiveGoldBullionRate`, `preLiveTtBarRate`, `preLiveKgBarRate`, `preLiveSilverPricePerGram`) and restored on disconnect.
  **Why:** disconnecting should return the shop to exactly the manual rates that were in place before going live, not zero/blank values.
- Live and manual rates flow through the *same* existing rate columns (`goldJewelryRate`, `goldBullionRate`, `ttBarRate`, `kgBarRate`, `silverPricePerGram`) — invoice rate-resolution logic needed no changes, only a status badge, since it already reads from these columns.
- GoldAPI.io returns USD; conversion to AED uses a fixed peg of 3.6725 (no live FX API call).
- While live mode is connected, the rate-card inputs on the Prices page are disabled (read-only, labeled "Live Market Rate — auto-synced"); user must disconnect to edit manually again.
