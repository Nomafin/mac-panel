# Tablet Control Panel — Design

Date: 2026-10-13
Status: Approved in conversation, pending written-spec review

## Goal

A Samsung Galaxy Tab S2 8" (SM-T719) on the desk acts as a zero-latency accessory for
the MacBook Pro: a window switcher (the Dock is hidden and windows get lost on an
ultrawide monitor) and a Spotify control panel. It should feel instant — changes on
the Mac appear on the tablet without perceptible delay, and taps act immediately.

### Success criteria

- Opening/closing/retitling/focusing a window on the Mac is reflected on the tablet
  within ~100 ms.
- Track changes and play/pause (from any source) appear on the tablet instantly.
- Tapping a window tile focuses it (unhide app, unminimize, raise, focus).
- Spotify controls work: play/pause, prev, next, seek, volume, shuffle, repeat.
- Tablet recovers by itself after Wi-Fi drops, tablet sleep, or Hammerspoon reload.
- Server only runs when the Mac is on the home network.

### Decisions from brainstorming

| Topic | Decision |
|---|---|
| Spaces | User rarely uses >1 Space. Other-Space windows are best-effort (whatever `hs.window.filter` has seen). No `hs.spaces` code. |
| Auth | None. Trust the home LAN. |
| Network exposure | Server runs only when the default gateway's MAC address matches a configured home router MAC. No Location Services permission needed; works for Wi-Fi and Ethernet. |
| Transport | WebSocket push (Mac → tablet) + commands over the same socket. |
| Tile order | Stable: apps in launch/first-seen order, windows in creation order. No MRU reordering. |
| Spotify volume | Spotify's app volume (system volume is a possible future module). |
| UI files | Separate files on disk, read per request — not embedded in Lua. |
| Client platform | HTML page in Fully Kiosk Browser, not a native Android app (see below). |

### Environment findings

- SM-T719 max official OS: Android 7.0. Android System WebView / Chrome on Android 7
  update to roughly v119 via Play Store; Fully Kiosk uses System WebView. Target a
  **Chrome 119 baseline** (ES2022, CSS nesting, `:has`, container queries OK). Verify
  the actual version from the tablet's user agent on first load; the page logs it.
- Mac: macOS 26 (Darwin 25). Hammerspoon not yet installed.
- The Tab S2 has an AMOLED panel → burn-in mitigation required.

### Native Android app vs HTML

HTML in Fully Kiosk wins. Fully Kiosk already provides keep-screen-on, auto-start on
boot, motion wake, scheduled screen off, and auto-reload. A native app would offer
marginally faster cold start and hardware-key access (e.g. volume rocker → Mac
volume), at the cost of an Android toolchain, sideloaded updates, and a second UI
codebase. Revisit only if a hardware-button feature becomes important; even then a
thin WebView wrapper would suffice.

## Architecture

```
Control/                         (git repo)
├── tabletpanel/                 → symlinked to ~/.hammerspoon/tabletpanel
│   ├── init.lua                 config, start/stop, wires modules together
│   ├── server.lua               hs.httpserver: static files, /api/state, /ws, routing
│   ├── hub.lua                  pure: module registry, versions, command dispatch
│   ├── netguard.lua             start/stop server on home-router MAC match
│   ├── windows.lua              hs.window.filter glue, icon cache, focus action
│   ├── windows_model.lua        pure: stable ordering + state shaping
│   ├── spotify.lua              watchers, AppleScript reads, commands
│   ├── spotify_model.lua        pure: parse AppleScript output → state table
│   ├── json.lua                 thin wrapper over hs.json (stubbable in tests)
│   └── web/
│       ├── index.html
│       ├── app.css
│       └── app.js
├── tests/                       plain-Lua tests for the pure modules
│   └── run.lua
├── docs/
└── README.md
```

`~/.hammerspoon/init.lua` gets one line: `require("tabletpanel").start()`.

### Module contract

Each feature module is a table with:

- `name` — e.g. `"windows"`.
- `start(notify)` / `stop()` — `notify()` is called whenever the module's state may
  have changed. The hub recomputes `state()`, compares it to the last sent value, and
  pushes only if it differs (bumping the module's version).
- `state()` — returns a JSON-serializable table; must be cheap.
- `actions` — `{ actionName = function(args) -> ok, err }`.
- optional `extras()` — additional one-off messages (used by windows for icons).

Future modules (thumbnails, clock/calendar, mic mute, system volume) plug in by
adding a module file, registering it in `init.lua`, and adding a UI section. Server
and hub do not change.

### Server

- `hs.httpserver.new(false, false)`, port `8765`, bound to all interfaces (gated by
  netguard).
- `GET /` and `GET /static/<file>` → files from `web/`, read from disk each request,
  `Cache-Control: no-store`. Path traversal rejected (filename whitelist pattern).
- `GET /api/state` → full snapshot JSON (debugging with curl).
- `ws://<mac>:8765/ws` → WebSocket.
- Known limitation to verify first: `hs.httpserver:send()` probably targets only the
  most recently connected WebSocket client. Mitigation: heartbeat (below) so any
  non-push client lags ≤ 2 s. Reply-to-message always reaches the sender.

### Protocol (JSON text frames)

Mac → tablet:

```jsonc
{"type":"snapshot","versions":{"windows":42,"spotify":17},"windows":{…},"spotify":{…}}
{"type":"state","module":"windows","v":42,"data":{…}}
{"type":"icons","icons":{"com.apple.Safari":"data:image/png;base64,…"}}
{"type":"reply","id":7,"ok":true}            // or "ok":false,"error":"…"
```

Tablet → Mac:

```jsonc
{"id":1,"cmd":"hello"}                                   // reply: snapshot (+ icons)
{"id":7,"cmd":"windows.focus","args":{"id":1234}}
{"id":8,"cmd":"ping","versions":{"windows":42,"spotify":17}}
```

- Since the WebSocket callback's return value is the reply, a command's reply may
  bundle stale modules: reply shape is
  `{"type":"reply","id":…,"ok":…,"updates":[<state msgs>],"icons":{…}}`.
- `ping` every 2 s; its reply contains `updates` for any module whose version the
  client is behind on (heartbeat fallback + liveness check).
- Pushes after a command are also sent via `send()` for the push client.

### Change sources

| Change | Source | Latency |
|---|---|---|
| Window created/destroyed/retitled/(un)minimized/focused, app hidden/unhidden | `hs.window.filter` subscriptions, 50 ms debounce | ~50–100 ms |
| Spotify track / play state | `hs.distributednotifications` `com.spotify.client.PlaybackStateChanged` | instant |
| Spotify launch / quit | `hs.application.watcher` | instant |
| Any tablet command | immediate re-read + push | instant |
| Spotify volume/shuffle/repeat changed in Spotify itself | 2 s timer, only while Spotify runs | ≤ 2 s |
| Progress bar | `positionMs` + `at` timestamp, client interpolates | smooth |

## Window switcher

State:

```jsonc
"windows": {
  "focusedId": 1234,
  "apps": [
    {"bundleId":"com.apple.Safari","name":"Safari","hidden":false,
     "windows":[{"id":1234,"title":"GitHub","minimized":false,"otherSpace":false}]}
  ]
}
```

- Filter: `hs.window.filter.new()` with default rejections, `currentSpace = nil`
  (all spaces), `visible = nil` (include minimized/hidden). Keep only
  `isStandard()` windows with non-empty titles.
- `otherSpace`: window is not minimized, app not hidden, and not in the
  current-space filter's window list.
- Ordering (pure, `windows_model.lua`): model keeps a first-seen sequence number per
  bundle ID and per window ID; apps sorted by app sequence, windows by window
  sequence. Sequences for gone windows/apps are pruned.
- Icons: `hs.image.imageFromAppBundle(bid)`, resized to 128 px,
  `encodeAsURLString()`; cached per bundle ID; sent once per client connection
  (in the `hello` reply) and incrementally when a new bundle appears.
- `windows.focus {id}`: look up window by ID → if app hidden, `unhide()`; if
  minimized, `unminimize()`; `focus()`. Error `"not_found"` if gone. macOS handles
  Space switching for other-Space windows (best-effort).
- Tile visuals: minimized = dimmed + ⤓ badge; hidden app = dimmed; other Space =
  small badge; focused = accent outline. Tap → optimistic highlight; error → shake.

## Spotify panel

State:

```jsonc
"spotify": {
  "running": true,
  "state": "playing",                 // playing | paused | stopped
  "track": {"id":"…","name":"…","artist":"…","album":"…",
            "durationMs":215000,"artworkUrl":"https://i.scdn.co/…"},
  "positionMs": 73000, "at": 1760368000123,
  "volume": 65, "shuffle": false, "repeat": true
}
```

When not running: `{"running": false}`.

- Read: one `hs.osascript.applescript` call returning all fields delimited
  (parsed by pure `spotify_model.lua`).
- **Never launch Spotify accidentally:** every read and command first checks
  `hs.application.get("com.spotify.client")`; if absent, no AppleScript is run.
- Commands: `spotify.playpause|next|previous` (hs.spotify), `spotify.seek {ms}`,
  `spotify.volume {value}` (client throttles to ≤ 1 per 100 ms + final value),
  `spotify.shuffle`, `spotify.repeat` (AppleScript toggles). Repeat is on/off only
  (AppleScript limitation).
- Album art is loaded by the tablet directly from Spotify's CDN.
- Visibility: not running → panel removed, grid full width. Running with no track →
  slim "Nothing playing" card with ▶. Otherwise full panel.

## Netguard

- Config: `homeRouterMACs = { "aa:bb:cc:dd:ee:ff" }` in `init.lua` config table.
- On start and on network change (`hs.network.configuration` watcher on
  `State:/Network/Global/IPv4`), resolve default gateway (`route -n get default`)
  and its MAC (`arp -n <gw>`) via `hs.task` (async), compare case-insensitively,
  start/stop the server accordingly. Log transitions to the Hammerspoon console.
- If `homeRouterMACs` is empty, netguard is disabled and the server always runs
  (with a console warning) — eases first-time setup.

## Tablet UI

- Viewport ~1024×768 CSS px landscape. Grid ~2/3 (scrolls vertically), Spotify
  panel ~1/3 (~340 px). Portrait: panel becomes a compact top strip.
- Grouped by app: small header row (icon + app name), then tiles ~150×110 px,
  48 px icon, 2-line title at 16–17 px. Touch targets ≥ 64 px.
- Visual: pure black background (AMOLED), slightly lighter surfaces, one accent
  color, high contrast text.
- Burn-in: whole UI shifts by 1–2 px every few minutes; README covers Fully Kiosk
  screen-off schedule and motion/touch wake.
- Connection: status dot; after > 2 s disconnected, dim UI + "Reconnecting…"
  overlay; reconnect with backoff (0.5 s → max 5 s). On reconnect, `hello` →
  fresh snapshot.
- Optimistic UI for all taps; server reply/push reconciles.
- `?mock` URL flag: page runs on canned data with a fake socket, for layout work in
  a desktop browser.
- JS: plain modern JS (Chrome 119 baseline), no build step, no frameworks. One
  `app.js` structured as small sections: connection, store, renderers per module
  (`renderers.windows`, `renderers.spotify`), so new modules add a renderer.

## Error handling

- All `hs.*` callbacks wrapped in `pcall`; errors logged to the Hammerspoon console
  with a `tabletpanel:` prefix, never crash the server.
- Malformed client messages → `{"type":"reply","ok":false,"error":"bad_request"}`.
- Unknown command → `"unknown_command"`.
- AppleScript failure in Spotify read → keep last good state, log once.

## Testing

1. **Pure Lua unit tests** (`lua tests/run.lua`, Homebrew `lua`): `hub.lua`
   (registry, version bumping, dispatch, ping updates), `windows_model.lua`
   (stable ordering, pruning), `spotify_model.lua` (AppleScript output parsing).
2. **Mac integration** (manual, documented in README):
   `curl -s localhost:8765/api/state | jq`, `websocat ws://localhost:8765/ws`
   (send `{"id":1,"cmd":"hello"}`, watch pushes while opening/closing windows and
   skipping tracks), `hs -c 'tp = require("tabletpanel"); …'` via `hs.ipc`.
3. **UI**: `?mock` page in desktop Chrome at 1024×768 (Playwright screenshots),
   then real page in desktop Chrome, then the tablet.

## Deliverables

1. `tabletpanel/` Lua module + `init.lua` line.
2. `tabletpanel/web/` page (separate files; reasons above).
3. `README.md`: install Hammerspoon, Accessibility permission (Screen Recording
   not needed until thumbnails), configure router MAC, find Mac IP / DHCP
   reservation, Fully Kiosk setup (start URL, keep screen on, screen-off schedule,
   motion wake, auto-reload on network reconnect), WebView update check,
   troubleshooting.

## Out of scope (structured for later)

Live window thumbnails (Screen Recording permission), clock/next calendar event,
mic mute toggle, system volume. Each is a new module + renderer.
