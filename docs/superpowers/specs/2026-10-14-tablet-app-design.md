# Tablet App (Android wrapper) — Design

Date: 2026-10-14
Status: Approved in conversation, pending written-spec review
Builds on: `2026-10-13-tablet-panel-design.md`

## Goal

Replace Fully Kiosk Browser (whose kiosk mode is a paid PLUS feature) with our own small
Android app on the Galaxy Tab S2 (SM-T719, Android 7.0). The app shows the existing panel
page full screen, makes the tablet a single-purpose accessory (soft kiosk), passes the
hardware keys to the page, and lets the screen go dark whenever the Mac isn't in use.

### Success criteria

- After boot the tablet shows the panel with no other UI visible, with no taps needed.
- Back, Home and Recents never leave the panel. Back closes the window sheet.
- Volume keys don't change the tablet's volume.
- When the Mac's display sleeps or the Mac locks, the tablet goes black within ~1 s;
  it comes back when the Mac wakes/unlocks.
- A hidden gesture reaches Reload, the Mac address, Android settings and the home-app chooser.
- The page still works unchanged in an ordinary browser.

### Decisions from brainstorming

| Topic | Decision |
|---|---|
| App type | Thin wrapper: one Kotlin activity hosting a WebView that loads the panel from the Mac. No native UI rewrite. |
| Kiosk strength | Soft kiosk: app registers as the home app, immersive full screen, keys captured. No device owner / lock task. Google account stays. |
| Volume keys | Captured and ignored for now (the cover presses them against the table). |
| Back | Closes the window sheet if open; otherwise nothing. Never exits the app. |
| Home | Returns to the panel (automatic as the home app). |
| Recents | Detected and bounced back to the panel; no action yet. |
| Screen | Follows the Mac: dark while the Mac's display sleeps / Mac is locked, or after 30 s disconnected. Tap = 60 s peek. |
| Distribution | Debug-signed APK, installed with `adb` over USB. No Play Store. |

## Architecture

```
Mac (Hammerspoon)                          Tablet (Android 7)
  tabletpanel/display.lua  ──state──►      MainActivity
  (new module, hub as before)               ├─ WebView ─ loads http://<mac>:8765/
                                            │    page ◄─ `tablet-key` events
                                            │    page ─► TabletApp.setScreen(on)
                                            ├─ key capture / Home intent / Recents receiver
                                            ├─ corner long-press → escape menu
                                            └─ "Waiting for your Mac…" view
```

The page stays the single UI. The app adds only things a web page cannot do.

## Android app (`android/`)

- Gradle project, one `app` module, Kotlin, no third-party libraries (AndroidX not required).
  `minSdk 24`, `compileSdk`/`targetSdk 34`. Builds with JDK 17 from the command line.
- `applicationId "dev.tabletpanel.app"`, label *Mac Panel*.
- Manifest:
  - `MainActivity`: `launchMode="singleTask"`, `screenOrientation="sensorLandscape"`,
    intent filters `MAIN`+`LAUNCHER` and `MAIN`+`HOME`+`DEFAULT` (makes it a home app).
  - `android:usesCleartextTraffic="true"` (the panel is plain HTTP on the LAN).
  - Permissions: `INTERNET`, `REORDER_TASKS`.
- Window: `FLAG_KEEP_SCREEN_ON`; immersive sticky (hide status + navigation bars),
  re-applied in `onWindowFocusChanged(true)` and `onResume`.
- WebView: JavaScript and DOM storage on; background black; loads the stored Mac URL
  (default `http://192.168.1.62:8765/`). Page-to-app bridge object `TabletApp`.

### Keys → page

The app delivers keys by evaluating
`window.dispatchEvent(new CustomEvent('tablet-key', {detail: {key: K}}))`, `K` ∈
`back | home | recents | volumeup | volumedown`.

| Key | Capture | Default behaviour |
|---|---|---|
| Back | `dispatchKeyEvent` KEYCODE_BACK (on key up) | consumed; event sent |
| Volume up/down | `dispatchKeyEvent` KEYCODE_VOLUME_UP/DOWN | consumed (both down and up); event sent on key down |
| Home | `onNewIntent` with `CATEGORY_HOME` while running | event sent |
| Recents | receiver for `ACTION_CLOSE_SYSTEM_DIALOGS` with extra `reason == "recentapps"` | `ActivityManager.moveTaskToFront`; event sent |

The recents app switcher may be visible for a moment before the bounce-back; that is accepted.

### Bridge (page → app)

`TabletApp.setScreen(on: Boolean)`: `false` sets window `screenBrightness = 0f`
(minimum), `true` restores `BRIGHTNESS_OVERRIDE_NONE`. Runs on the UI thread.
The page checks `window.TabletApp` exists before calling; in a browser it is absent.

### Escape menu

A transparent 64 dp square over the top-left corner. Holding it for 3 s opens a native
dialog with:
- *Reload* — reloads the WebView.
- *Mac address…* — text field prefilled with the current URL; saved to `SharedPreferences`
  after validation, then loaded.
- *Android settings* — opens `Settings.ACTION_SETTINGS`.
- *Choose home app* — opens `Settings.ACTION_HOME_SETTINGS` so the Samsung launcher can be
  restored.

Taps shorter than 3 s pass through to the page (the corner is part of the window grid area).

### Mac unreachable

If the main-frame load fails (`onReceivedError` for the main frame or an HTTP error for the
main document), the WebView is hidden and a native black view shows "Waiting for your Mac…"
with the URL in small type; the app retries every 5 s and shows the WebView again on
success. After the first successful load the page's own reconnect logic takes over.

### Pure Kotlin logic (unit-tested on the JVM)

- `MacUrl.normalize(input: String): String?` — trims; adds `http://` if no scheme; adds
  `:8765` if no port; ensures a trailing `/`; returns null for anything that isn't an
  `http`/`https` URL with a host.
- `Keys.forKeyCode(code: Int): String?` — maps key codes to the event names above.
- `Keys.isRecentsReason(reason: String?): Boolean`.

## Mac side: `display` module

- `tabletpanel/display_model.lua` (pure): tracks flags `screensAsleep`, `locked`,
  `screensaver`, `systemSleeping` from `hs.caffeinate.watcher` event names; `state()`
  returns `{ awake = not any flag }`. Wake events clear their own flag; `systemDidWake`
  and `screensDidWake` both clear `systemSleeping`/`screensAsleep`.
- `tabletpanel/display.lua`: module contract as the others (`name = 'display'`). On start,
  seeds `locked` from `hs.caffeinate.sessionProperties().CGSSessionScreenIsLocked`, starts a
  `hs.caffeinate.watcher`, calls `notify()` on change.
- Added to `M.modules` in `init.lua`.

## Page changes (`tabletpanel/web/`)

- Pure helper `shouldSleep({macAwake, connected, disconnectedSince, peekUntil, now})`:
  - `now < peekUntil` → awake;
  - connected → `!macAwake`;
  - disconnected for ≥ 30 s → asleep; otherwise awake.
  `macAwake` defaults to true when no display state has arrived.
- Evaluated on display state, on connect/disconnect, and once a second.
- Asleep: `body.asleep` fades a full-screen black cover in over ~1 s, pauses all CSS
  animations, and calls `TabletApp.setScreen(false)`. Awake reverses it.
- While asleep, a tap is swallowed (doesn't reach tiles) and sets `peekUntil = now + 60 s`.
- `tablet-key` listener: `back` closes the sheet if open; other keys ignored.
- Mock mode: `?mock` gains a way to toggle `display.awake` for UI checks.

## Testing

- Lua: `tests/test_display_model.lua` — event sequences → `awake`.
- JS: `shouldSleep` cases and the key → action mapping in `tests/web.test.js`.
- Kotlin: JUnit tests for `MacUrl`, `Keys` via `./gradlew test` (no device).
- On-device checklist (README): each key; escape menu items; wrong Mac address → waiting
  view → fix via menu; Mac display sleep / lock / unlock; Mac full sleep; tap-to-peek;
  reboot lands on the panel.

## Setup (README)

- Mac: `brew install --cask android-commandlinetools android-platform-tools`; one
  `sdkmanager` command for `platforms;android-34` and `build-tools;34.0.0`; Gradle wrapper
  checked in.
- Tablet: Developer options (tap *Build number* 7×) → USB debugging → accept the Mac's key.
- `cd android && ./gradlew installDebug`; then press Home and choose *Mac Panel* → *Always*.
- Fully Kiosk can be uninstalled afterwards.

## Out of scope

Actions for Recents and volume keys, device owner / lock task, Play Store release, APK
auto-update, waking the Mac from the tablet.
