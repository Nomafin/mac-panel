# Mac Panel for Galaxy Tab S2

A Hammerspoon module that turns a spare Android tablet into an instant window switcher and Spotify remote for your Mac. The Mac pushes changes over a WebSocket, so the tablet updates the moment a window opens, closes, gets focus, or a track changes.

## How it works

- `tabletpanel/` is a Hammerspoon module. It serves the tablet page (`tabletpanel/web/`) and a WebSocket at `ws://<mac>:8765/ws`.
- Window changes come from `hs.window.filter` events (~50–100 ms to the tablet). Spotify changes come from Spotify's `PlaybackStateChanged` notification, plus a 2 s check for volume/shuffle/repeat changed inside Spotify.
- Taps act optimistically on the tablet, and the Mac predicts the result of Spotify commands, so buttons respond instantly; a confirming read follows 1.5 s later.
- The tablet sends a `ping` every 2 s; replies carry anything it missed. Hammerspoon pushes only to the **most recently connected** client, so if you also open the page on another device, the older one stays in sync via ping (≤ 2 s lag) instead of instantly.
- The server only runs when the Mac's default gateway has your home router's MAC address (no Location permission needed; works on Wi-Fi and Ethernet).
- No authentication: anyone on your home network can use the panel.
- The Mac also reports whether it's in use (display awake and unlocked), so the tablet can go dark with it.
- Spotify is never launched by the panel: every AppleScript checks that Spotify is running first, and reads pause briefly while Spotify is quitting.

## Mac setup

1. **Install Hammerspoon**: `brew install --cask hammerspoon` (this also installs the `hs` command-line tool). Open it, and in its Preferences tick *Launch Hammerspoon at login*.
2. **Grant Accessibility**: System Settings → Privacy & Security → Accessibility → enable Hammerspoon. If it's already listed but `hs -c 'print(hs.accessibilityState())'` prints `false`, toggle it off and on. (Screen Recording is *not* needed.)
3. **Link the module** (from this repo's root):
   ```bash
   mkdir -p ~/.hammerspoon
   ln -s "$PWD/tabletpanel" ~/.hammerspoon/tabletpanel
   ```
4. **Find your router's MAC** while on your home network:
   ```bash
   arp -n $(route -n get default | awk '/gateway/{print $2}')
   ```
5. **Put this in `~/.hammerspoon/init.lua`**:
   ```lua
   require("hs.ipc") -- enables the `hs` command line tool

   tabletpanel = require("tabletpanel").start({
     homeRouterMACs = { "aa:bb:cc:dd:ee:ff" }, -- from step 4; {} = always on
   })
   ```
   Keep the global `tabletpanel =` assignment — it stops Lua from garbage-collecting the server.
6. **Reload** Hammerspoon (menu bar icon → Reload Config). The console should show `tabletpane: home network (…)` and `tabletpane: listening on port 8765` (Hammerspoon shortens logger names to 10 characters).
7. **Spotify**: the first time it runs, macOS asks *"Hammerspoon wants to control Spotify"* — click **Allow**.
8. **Firewall**: if the macOS firewall is on, allow incoming connections for Hammerspoon when prompted (or in System Settings → Network → Firewall → Options).
9. **Give the Mac a fixed IP**: in your router's DHCP settings, reserve an address for the Mac (`ipconfig getifaddr en0` shows the current one). The tablet URL is `http://<that-ip>:8765/`.

## Test on the Mac first

```bash
curl -s http://localhost:8765/api/state | jq                                  # full state
(printf '%s\n' '{"id":1,"cmd":"hello"}'; sleep 30) | websocat -E ws://localhost:8765/ws   # watch pushes live
(printf '%s\n' '{"id":1,"cmd":"spotify.playpause"}'; sleep 1) | websocat -E ws://localhost:8765/ws
open "http://localhost:8765/"                                                  # real UI in a desktop browser
open "http://localhost:8765/?mock"                                             # fake data (also ?mock=idle, ?mock=nospotify) — press d to toggle the Mac's awake state
```

`websocat` (`brew install websocat`) needs `-E` to exit, because Hammerspoon doesn't complete the WebSocket close handshake.

Unit tests: `/opt/homebrew/opt/lua@5.4/bin/lua tests/run.lua` (`brew install lua@5.4` — Hammerspoon embeds Lua 5.4) and `node --test tests/web.test.js`.

## Tablet app (Galaxy Tab S2, Android 7)

`android/` is a small app, *Mac Panel*, that shows the panel full screen and acts as the tablet's home screen:

- It starts at boot, and Home, Back and Recents all keep you on the panel. Back closes the window sheet (holding it opens the escape menu). The volume keys are caught and do nothing for now.
- Each key reaches the page as a `tablet-key` event (`back`, `home`, `recents`, `volumeup`, `volumedown`), so giving a key a job is a page change in `web/app.js` (`keyAction`).
- The screen goes black when the Mac's display sleeps, the Mac locks or its screensaver starts. It also goes black after 30 s without a connection, e.g. when the Mac is fully asleep. It comes back when the Mac wakes. Tapping the black screen shows the panel for 60 s.
- **Escape menu**: hold Back for about 1.5 seconds. It has *Reload*, *Mac address…*, *Android settings* and *Choose home app* (to go back to the Samsung launcher).
- Above the window grid: a clock, the date and the tablet's battery. While on the charger, ▴ or ▾ shows whether the level actually rose or fell over the last 30 minutes (after ~10 minutes of history); the indicator turns amber if it's falling on the charger, which means the charger can't keep up.
- If the Mac can't be reached when the app starts, it shows *Waiting for your Mac…* and retries every 5 s.

### Build

One-off, on the Mac:

```bash
brew install --cask android-commandlinetools android-platform-tools
yes | sdkmanager --licenses                       # read/accept the Android SDK licences
sdkmanager "platforms;android-34" "build-tools;34.0.0"
echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > android/local.properties
```

The build needs Java 17 (the Android build tools don't run on the newest Java), so every Gradle command below starts by pointing `JAVA_HOME` at it:

```bash
cd android
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./gradlew test             # unit tests, no tablet needed
./gradlew installDebug     # build and install on the connected tablet
```

### Tablet setup

1. **Update the browser engine**: on Android 7 the app shows the page with *Chrome* itself, and the page needs Chrome 111+ (119 is the last for Android 7). If the Play Store offers no update, install Chrome 119 from APKMirror with `adb install-multiple -r <unzipped .apkm>/*.apk`. Pick the **arm64-v8a + arm-v7a, Android 7.0+** variant: the 32-bit-only variant crashes 64-bit apps like Mac Panel (`is 32-bit instead of 64-bit` in `adb logcat -b crash`). Android only accepts the update if it's signed with Google's Chrome key, which you can confirm with `apksigner verify --print-certs`.
2. **Turn on USB debugging**: *Settings → About device → Software info*, tap *Build number* 7 times. Then *Settings → Developer options → USB debugging* on.
3. **Connect the USB cable** and accept *Allow USB debugging?* on the tablet (tick *Always allow from this computer*). `adb devices` should list it as `device`.
4. `./gradlew installDebug` (see Build).
5. **Make it the home app**: press Home, choose *Mac Panel*, then *Always*.
6. If the Mac's address isn't `http://192.168.1.62:8765/`, set it in the escape menu → *Mac address…* (`192.168.1.70` is enough; `http://` and `:8765` are added).
7. **Turn off the screen lock**: *Settings → Lock screen and security → Screen lock type → None*. Otherwise the tablet waits for a swipe or PIN after every restart instead of going straight to the panel.
8. In *Settings → Battery*, exclude Mac Panel from battery optimisation, and keep the tablet on its charger.
9. Fully Kiosk Browser is no longer needed; uninstall it if it's installed.

**ADB over Wi-Fi** (no cable for later updates): with the cable in, run `adb tcpip 5555`, then `adb connect <tablet-ip>:5555`. After that, `./gradlew installDebug` works wirelessly. Android 7 forgets this on reboot, so after a restart it needs the cable once more. Other computers still need the tablet to approve their key.

Updating the page needs no reinstall: the app loads it from the Mac. Only changes under `android/` need `./gradlew installDebug`.

### On-device checklist

- [ ] After a reboot the panel appears with no status or navigation bar.
- [ ] Back closes an open window sheet; otherwise nothing happens.
- [ ] Home and Recents stay on the panel (the app switcher may flash briefly).
- [ ] Volume keys don't change the tablet's volume.
- [ ] Holding Back for 1.5 s opens the menu; a short press still closes the window sheet.
- [ ] Menu → *Mac address…* with a wrong address shows *Waiting for your Mac…*; fixing it brings the panel back.
- [ ] Mac display sleep (`pmset displaysleepnow`) or lock (Ctrl-Cmd-Q) turns the tablet black within about a second; waking/unlocking brings it back.
- [ ] Mac fully asleep: the tablet goes black after ~30 s and comes back when the Mac wakes.
- [ ] Tapping the black screen shows the panel for a minute.
- [ ] Restart the tablet while the Mac is asleep: *Waiting for your Mac…* appears, goes black after 30 s, and the panel comes up once the Mac wakes.
- [ ] After *Choose home app* → Samsung launcher, Recents works normally in other apps.

**AMOLED burn-in**: besides going black with the Mac, the page uses a pure black background and nudges itself 1–2 px every 3 minutes. Keep brightness moderate.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tablet can't load the page | Same network? `curl http://<mac-ip>:8765/` from another machine; check the macOS firewall allows Hammerspoon; check the console for `not on home network`. |
| Console says `not on home network` at home | Re-run the `arp` command from setup step 4 and compare with `homeRouterMACs` (format doesn't matter: `0:1e:a:…` and `00:1E:0A:…` both match). Mesh/extender networks may expose a different gateway MAC — add it to the list. |
| `homeRouterMACs is empty` warning | The server then always runs; add your router MAC to restrict it. |
| "Reconnecting…" never clears | Hammerspoon running? Mac asleep? IP changed (set a DHCP reservation)? |
| No windows, console says `hs.axuielement - module requires accessibility` | Accessibility permission missing — see setup step 2, then reload. |
| Windows missing | Windows on other Spaces only appear once Hammerspoon has seen them. Untitled and non-standard windows (palettes, popups) are hidden by design. A minimized window of a hidden app reappears when the app is unhidden. |
| Spotify panel missing or stale | Spotify must be running. Check System Settings → Privacy & Security → Automation → Hammerspoon → Spotify is on. Console warnings start with `tabletpane: spotify:`. |
| Changes to the page don't show | The page is served with `no-store`; escape menu → *Reload*. Lua changes need a Hammerspoon reload (`hs -c 'hs.reload()'`). |
| `adb devices` shows `unauthorized` | Unplug and replug, and accept the prompt on the tablet. No prompt: *Developer options → Revoke USB debugging authorisations*, then replug. |
| Gradle fails with just a Java version number (e.g. `27`) | Gradle is running on a too-new Java: `export JAVA_HOME=$(/usr/libexec/java_home -v 17)`. |
| Home doesn't offer *Mac Panel* | Android remembered another home app: *Settings → Apps → Default apps → Home screen* → Mac Panel. |
| Tablet stays lit while the Mac sleeps | `curl -s http://<mac-ip>:8765/api/state | jq .display` should say `"awake": false` while the Mac is locked. Debug the page from the Mac in Chrome at `chrome://inspect` (debug builds allow it). |
| Icons missing | `curl -o x.png http://localhost:8765/icon/com.apple.finder.png && file x.png` should say PNG. |

## Extending

Each feature is a module with `name`, `start(notify, log)`, `stop()`, `state()` and `actions`. Add a file in `tabletpanel/`, put it in `M.modules` in `tabletpanel/init.lua`, and add a renderer to `renderers` in `web/app.js`. Planned: window thumbnails (needs Screen Recording), clock/next calendar event, mic mute, system volume.
