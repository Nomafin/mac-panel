# Mac Panel

Turn a spare Android tablet into a touch control panel for your Mac. It's a window switcher, Spotify remote, window mover, 2FA code copier and status display that sits next to your keyboard. The Mac pushes every change over a WebSocket, so the tablet updates the moment a window opens, closes or gets focus, or a track changes.

Two parts:

- **`tabletpanel/`** is a [Hammerspoon](https://www.hammerspoon.org) module. It runs a small web server on the Mac that serves the panel and talks to it.
- **`android/`** is a small Android app, *Mac Panel*. It shows the panel full screen, acts as the tablet's home screen and goes dark when the Mac does. Any browser can also open the panel, but the app makes the tablet a dedicated device.

It's built and tested with a Samsung Galaxy Tab S2 (Android 7) and a MacBook with an external display. It should work on any Android 7+ tablet and any Mac that runs Hammerspoon.

## Features

- **Window grid, Dock style.** Finder and your Dock's pinned apps come first, in Dock order, followed by other running apps. Running apps sit on a tile; pinned apps that aren't running show as a bare icon. Pinning or reordering in the Dock updates the tablet.
  - Tap an app to bring it forward. If it has several windows, a sheet opens with a preview of each window. Tap an app with no windows to open it, like a Dock click.
  - Unread badges (Slack, Mail, …) come from the Dock, even while the Dock is hidden.
- **Spotify**: artwork, play/pause, skip, seek, volume, shuffle and repeat. The album art also tints the panel. Spotify is never launched by the panel.
- **Shortcut buttons**: up to six buttons send keyboard shortcuts to the Mac's front app. Edit the sets in [`tabletpanel/shortcuts.lua`](tabletpanel/shortcuts.lua).
- **Microphone mute**: while an app uses the Mac's microphone (a call), a mic button appears next to the clock. It and the tablet's Recents key mute and unmute.
- **Status**: the clock, the date and the tablet's battery above the grid. The Mac's CPU, memory and battery (on laptops) are below it.
- **Screens page** (swipe left from the panel): your displays to scale, with every window on the current Space. Drag a window to move it, drag its corner to resize, tap to focus. With a window selected, buttons snap it to thirds, halves, the centre or full screen, or move it to another screen.
- **Authenticator** (swipe right from the panel): your 2FA accounts, imported from Google Authenticator. Tap one and its current code is on the Mac's clipboard, ready to paste; the clipboard is cleared 30 s later if it still holds the code, and the code is marked concealed so clipboard managers skip it. With 3 s or less left on a code, the next one is copied instead. See [Authenticator](#authenticator).
- **Sketch pad** (swipe left from Screens): draw or sign, then *Copy to Mac* puts the drawing on the clipboard as a transparent PNG.
- **Follows the Mac**: the tablet goes black when the Mac's display sleeps, the Mac locks or the screensaver starts. It comes back when the Mac wakes. Tap the black screen to see the panel for a minute.

## Security: read this first

**There's no authentication.** Anyone on your network who opens `http://<mac-ip>:8765/` gets the same powers as the tablet:

- see your window titles, app list and Spotify state, and (with Screen Recording granted) **screenshots of your windows**;
- focus, move, resize and launch apps, and send the configured keyboard shortcuts to the front app;
- put an image on your clipboard, mute the microphone and control Spotify;
- see the names of your 2FA accounts and put a code on the Mac's clipboard (but not read it: the codes and secrets never leave the Mac).

So the server only runs while the Mac is on your home network, which it recognizes by the router's MAC address (`homeRouterMACs`). Don't use it on networks you share with people you don't trust.

## Mac setup

1. **Install Hammerspoon**: `brew install --cask hammerspoon` (this also installs the `hs` command-line tool). Open it, and in its Preferences tick *Launch Hammerspoon at login*.
2. **Grant Accessibility**: System Settings → Privacy & Security → Accessibility → enable Hammerspoon. If it's already listed but `hs -c 'print(hs.accessibilityState())'` prints `false`, toggle it off and on.
3. **Optional: grant Screen Recording** (same place → *Screen & System Audio Recording* → Hammerspoon) for window previews in the sheet and on the Screens page. macOS asks Hammerspoon to restart afterwards, and from time to time asks you to confirm the permission again. Without it everything else works, minus the previews.
4. **Get the code and link the module**:
   ```bash
   git clone https://github.com/Nomafin/mac-panel.git
   cd mac-panel
   mkdir -p ~/.hammerspoon
   ln -s "$PWD/tabletpanel" ~/.hammerspoon/tabletpanel
   ```
5. **Find your router's MAC address** while on your home network:
   ```bash
   arp -n $(route -n get default | awk '/gateway/{print $2}')
   ```
6. **Add this to `~/.hammerspoon/init.lua`**:
   ```lua
   require("hs.ipc") -- enables the `hs` command line tool

   tabletpanel = require("tabletpanel").start({
     homeRouterMACs = { "aa:bb:cc:dd:ee:ff" }, -- from step 5; {} = always on
   })
   ```
   Keep the global `tabletpanel =` assignment: it stops Lua from garbage-collecting the server. See [Configuration](#configuration) for the other options.
7. **Reload** Hammerspoon (menu bar icon → Reload Config). The console should show `tabletpane: home network (…)` and `tabletpane: listening on port 8765` (Hammerspoon shortens logger names to 10 characters).
8. **Spotify**: the first time it runs, macOS asks *"Hammerspoon wants to control Spotify"*. Click **Allow**.
9. **Firewall**: if the macOS firewall is on, allow incoming connections for Hammerspoon when prompted (or in System Settings → Network → Firewall → Options).
10. **Give the Mac a fixed IP**: in your router's DHCP settings, reserve an address for the Mac (`ipconfig getifaddr en0` shows the current one). The panel is at `http://<that-ip>:8765/`.

Open that address in a desktop browser to try the panel before setting up the tablet.

## Authenticator

The 2FA secrets are stored in your login Keychain (items named *Mac Panel authenticator*, service `mac-panel.authenticator`) and the codes are computed on the Mac. The tablet only ever gets the account names. Importing, renaming and removing happen on the Mac only, from the lock icon in the menu bar.

**Import from Google Authenticator**:

1. On your phone, in Google Authenticator: menu → *Transfer accounts* → *Export accounts*, and pick the accounts. It shows one QR code, or a series (*1 of 3*) for many accounts.
2. Take a screenshot of the code and get it onto the Mac's clipboard: on an iPhone, copy it and it arrives through Universal Clipboard; or AirDrop it and copy it on the Mac.
3. On the Mac: lock icon in the menu bar → *Import QR from clipboard*. macOS reads the code (with its Vision framework, nothing leaves the Mac), the accounts are saved, and the clipboard is cleared. For a series, repeat for each code.
4. **Delete the screenshot** from your phone (and *Recently Deleted*): it holds every secret.

Single-account `otpauth://` QR codes, the ones websites show when you turn on 2FA, can be imported the same way. Accounts already imported are skipped, so importing again is harmless. Counter-based (HOTP) accounts aren't supported and are skipped.

*Scan QR with camera…* reads a code held up to the Mac's webcam instead (macOS asks for camera access the first time). It works for small codes, but a webcam usually can't focus well enough on a phone screen for a full export code, so the screenshot route is the reliable one. Android's Google Authenticator may block screenshots of the export screen; then the camera, or a photo taken with another device, are the options.

**Manage**: lock icon → *Manage accounts…* → pick one → *Rename…* or *Remove…*.

The codes on your phone keep working: exporting doesn't move the accounts, it copies them. Keep in mind that the secrets then live on the same Mac as your passwords, as with any desktop authenticator.

## Configuration

Options go in the `start({ ... })` table in `~/.hammerspoon/init.lua`. Reload Hammerspoon after a change.

| Option | Default | Meaning |
|---|---|---|
| `homeRouterMACs` | `{}` | Router MAC addresses of networks where the server may run. Empty = always on (a warning is logged). Format doesn't matter: `0:1e:a:…` and `00:1E:0A:…` both match. |
| `port` | `8765` | The server's port. The tablet app assumes 8765 unless you type the full address. |
| `timeFormat` | `'H:i'` | The clock, in [PHP `date()`](https://www.php.net/manual/en/datetime.format.php) letters: `H` `G` `h` `g` `i` `A` `a`. For example `'g:i A'` → 9:05 AM. |
| `dateFormat` | the tablet's language | The date, in the same letters: `d` `j` `D` `m` `n` `M` `Y` `y`. For example `'d.m.Y'` → 14.10.2026, `'D, M j'` → Wed, Oct 14. A backslash keeps the next character as it is. |

The shortcut buttons are configured per app in [`tabletpanel/shortcuts.lua`](tabletpanel/shortcuts.lua).

## Tablet app

### Build

One-off, on the Mac:

```bash
brew install --cask android-commandlinetools android-platform-tools
yes | sdkmanager --licenses                       # read/accept the Android SDK licences
sdkmanager "platforms;android-34" "build-tools;34.0.0"
echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > android/local.properties
```

The build needs Java 17 (the Android build tools don't run on the newest Java), so point `JAVA_HOME` at it (`brew install --cask zulu@17` if you don't have it):

```bash
cd android
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./gradlew test             # unit tests, no tablet needed
./gradlew installDebug     # build and install on the connected tablet
```

### Tablet setup

Menu names below are from Samsung's Android 7. Other tablets have the same settings under slightly different names.

1. **Turn on USB debugging**: *Settings → About device → Software info*, tap *Build number* 7 times. Then *Settings → Developer options → USB debugging* on.
2. **Connect the USB cable** and accept *Allow USB debugging?* on the tablet (tick *Always allow from this computer*). `adb devices` should list it as `device`.
3. **Check the browser engine**: the panel needs Chrome / Android System WebView **111 or newer**. On Android 7–9 the app renders with Chrome itself, so update Chrome; on Android 10+ update *Android System WebView*. `adb shell dumpsys webviewupdate | grep -i 'current webview'` shows the version in use. If the Play Store offers no update (Chrome 119 is the last for Android 7), see [Old tablets](#old-tablets).
4. `./gradlew installDebug` (see Build).
5. **Make it the home app**: press Home, choose *Mac Panel*, then *Always*.
6. **Set the Mac's address**: on first start the app asks for it. The IP from Mac setup step 10 is enough (`http://` and `:8765` are added).
7. **Turn off the screen lock**: *Settings → Lock screen and security → Screen lock type → None*. Otherwise the tablet waits for a swipe or PIN after every restart instead of going straight to the panel.
8. **Exclude Mac Panel from battery optimisation** (*Settings → Battery*), and keep the tablet on its charger.

### Using the app

- It starts at boot, and Home, Back and Recents all keep you on the panel. Back closes the window sheet or returns to the panel from the other pages. Recents mutes the Mac's microphone during a call. The volume keys do nothing (many tablet covers press them).
- **Escape menu**: hold Back for about 1.5 seconds. It has *Reload*, *Mac address…*, *Android settings* and *Choose home app* (to go back to the normal launcher).
- If the Mac can't be reached, the app shows *Waiting for your Mac…* and retries every 5 s. After 30 s without a connection (e.g. the Mac is asleep) the screen goes black until the Mac is back.
- While the tablet is on its charger, ▴ or ▾ next to its battery shows whether the level actually rose or fell over the last 30 minutes. It turns amber if the level falls while charging, which means the charger can't keep up.
- The page is loaded from the Mac, so updating the panel needs no reinstall. Only changes under `android/` need `./gradlew installDebug`.

**ADB over Wi-Fi** (no cable for later updates): with the cable in, run `adb tcpip 5555`, then `adb connect <tablet-ip>:5555`. After that, `./gradlew installDebug` works wirelessly. Older Android versions forget this on reboot, and then it needs the cable once more.

**AMOLED burn-in**: besides going black with the Mac, the page uses a pure black background and shifts itself 1–2 px every 3 minutes. Keep brightness moderate.

### Old tablets

If the tablet's Play Store has no Chrome 111+ update, you can sideload one, e.g. Chrome 119 (the last for Android 7) from APKMirror:

- Pick the variant that matches the tablet's CPU. On a 64-bit tablet take the **arm64-v8a + armeabi-v7a** bundle; the 32-bit-only one crashes 64-bit apps like Mac Panel (`is 32-bit instead of 64-bit` in `adb logcat -b crash`).
- Check it's signed by Google with `apksigner verify --print-certs` (Android only accepts the update if it's signed with Chrome's own key anyway).
- Install the unzipped bundle: `adb install-multiple -r <unzipped .apkm>/*.apk`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tablet can't load the page | Same network? `curl http://<mac-ip>:8765/` from another machine; check the macOS firewall allows Hammerspoon; check the Hammerspoon console for `not on home network`. |
| Console says `not on home network` at home | Re-run the `arp` command from Mac setup step 5 and compare with `homeRouterMACs`. Mesh/extender networks may expose a different gateway MAC: add it to the list. |
| `homeRouterMACs is empty` warning | The server then always runs; add your router MAC to restrict it. |
| "Reconnecting…" never clears | Hammerspoon running? Mac asleep? IP changed (set a DHCP reservation)? |
| No windows, console says `hs.axuielement - module requires accessibility` | Accessibility permission missing: see Mac setup step 2, then reload. |
| Windows missing | Windows on other Spaces only appear once Hammerspoon has seen them. Non-standard windows (palettes, popups) and small untitled windows are hidden by design; a normal-sized untitled window (e.g. a browser web app) is shown under its app's name. A minimized window of a hidden app reappears when the app is unhidden. |
| No window previews | Grant Screen Recording (Mac setup step 3) and reload Hammerspoon. |
| Spotify panel missing or stale | Spotify must be running. Check System Settings → Privacy & Security → Automation → Hammerspoon → Spotify is on. Console warnings start with `tabletpane: spotify:`. |
| Changes to the page don't show | The page is served with `no-store`; escape menu → *Reload*. Lua changes need a Hammerspoon reload (`hs -c 'hs.reload()'`). |
| `adb devices` shows `unauthorized` | Unplug and replug, and accept the prompt on the tablet. No prompt: *Developer options → Revoke USB debugging authorisations*, then replug. |
| Gradle fails with just a Java version number (e.g. `27`) | Gradle is running on a too-new Java: `export JAVA_HOME=$(/usr/libexec/java_home -v 17)`. |
| Home doesn't offer *Mac Panel* | Android remembered another home app: *Settings → Apps → Default apps → Home screen* → Mac Panel. |
| Tablet stays lit while the Mac sleeps | `curl -s http://<mac-ip>:8765/api/state \| jq .display` should say `"awake": false` while the Mac is locked. Debug the page from the Mac in Chrome at `chrome://inspect` (debug builds allow it). |
| Scanner says *No camera access* | System Settings → Privacy & Security → Camera → turn Hammerspoon on, then open the scanner again. |
| Camera scanner doesn't react to the export code | Webcams rarely focus well enough on a dense code; use *Import QR from clipboard* with a screenshot instead. |
| Authenticator page is empty after an import | Check the Hammerspoon console for `tabletpane: authenticator:` warnings (e.g. the Keychain item couldn't be read). |
| Icons missing | `curl -o x.png http://localhost:8765/icon/com.apple.finder.png && file x.png` should say PNG. |

## Development

### Testing on the Mac

```bash
curl -s http://localhost:8765/api/state | jq                                  # full state
(printf '%s\n' '{"id":1,"cmd":"hello"}'; sleep 30) | websocat -E ws://localhost:8765/ws   # watch pushes live
(printf '%s\n' '{"id":1,"cmd":"spotify.playpause"}'; sleep 1) | websocat -E ws://localhost:8765/ws
open "http://localhost:8765/"                                                  # real UI in a desktop browser
open "http://localhost:8765/?mock"                                             # fake data (also ?mock=idle, ?mock=nospotify); press d to toggle the Mac's awake state
```

`websocat` (`brew install websocat`) needs `-E` to exit, because Hammerspoon doesn't complete the WebSocket close handshake.

**Unit tests**: `npm test` runs the page's tests (`node --test tests/web/`) and the Lua modules' (`lua tests/run.lua`). Hammerspoon embeds Lua 5.4; if your `lua` is another version, point at 5.4: `LUA=/opt/homebrew/opt/lua@5.4/bin/lua npm test` (`brew install lua@5.4`). The Android app's tests: `cd android && ./gradlew test`.

### How it works

- Window changes come from `hs.window.filter` events (~50–100 ms to the tablet). Dock pins are read from `com.apple.dock.plist`; badges from the Dock's accessibility tree every 2 s.
- Spotify changes come from Spotify's `PlaybackStateChanged` notification, plus a 2 s check for volume/shuffle/repeat changed inside Spotify.
- Taps act optimistically on the tablet, and the Mac predicts the result of Spotify commands, so buttons respond instantly; a confirming read follows 1.5 s later.
- The tablet sends a `ping` every 2 s; replies carry anything it missed. Hammerspoon pushes only to the **most recently connected** client, so if you also open the page on another device, the older one stays in sync via ping (≤ 2 s lag) instead of instantly.
- The server only runs when the Mac's default gateway has one of your home router's MAC addresses. This needs no Location permission and works on both Wi-Fi and Ethernet.
- Each tablet key reaches the page as a `tablet-key` event (`back`, `home`, `recents`, `volumeup`, `volumedown`), so giving a key a job is a page change in `web/js/keys.js` (`keyAction`).

### Extending

On the Mac, each feature is a module with `name`, `start(notify, log)`, `stop()`, `state()` and `actions`: add a file in `tabletpanel/` and put it in `M.modules` in `tabletpanel/init.lua`. Its state reaches the page as `ctx.store.<name>`, announced by `ctx.emit('<name>')`.

On the page, `web/js/main.js` wires the features together. Each feature is a module in `web/js/` (with its styles in `web/css/`) that exports its pure helpers, which `tests/web/` tests, plus an `init(ctx)` that sets up its part of the screen and listens with `ctx.on('<name>', render)`. There's no build step: the tablet loads the files as they are.

## License

[MIT](LICENSE). The bundled [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) font is under the [SIL Open Font License](tabletpanel/web/fonts/OFL.txt), and [jsQR](https://github.com/cozmo/jsQR) under the [Apache License 2.0](tabletpanel/web/vendor/jsQR-LICENSE).
