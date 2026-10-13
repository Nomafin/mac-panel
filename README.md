# Mac Panel for Galaxy Tab S2

A Hammerspoon module that turns a spare Android tablet into an instant window switcher and Spotify remote for your Mac. The Mac pushes changes over a WebSocket, so the tablet updates the moment a window opens, closes, gets focus, or a track changes.

## How it works

- `tabletpanel/` is a Hammerspoon module. It serves the tablet page (`tabletpanel/web/`) and a WebSocket at `ws://<mac>:8765/ws`.
- Window changes come from `hs.window.filter` events (~50–100 ms to the tablet). Spotify changes come from Spotify's `PlaybackStateChanged` notification, plus a 2 s check for volume/shuffle/repeat changed inside Spotify.
- Taps act optimistically on the tablet, and the Mac predicts the result of Spotify commands, so buttons respond instantly; a confirming read follows 1.5 s later.
- The tablet sends a `ping` every 2 s; replies carry anything it missed. Hammerspoon pushes only to the **most recently connected** client, so if you also open the page on another device, the older one stays in sync via ping (≤ 2 s lag) instead of instantly.
- The server only runs when the Mac's default gateway has your home router's MAC address (no Location permission needed; works on Wi-Fi and Ethernet).
- No authentication: anyone on your home network can use the panel.
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
open "http://localhost:8765/?mock"                                             # fake data (also ?mock=idle, ?mock=nospotify)
```

`websocat` (`brew install websocat`) needs `-E` to exit, because Hammerspoon doesn't complete the WebSocket close handshake.

Unit tests: `/opt/homebrew/opt/lua@5.4/bin/lua tests/run.lua` (`brew install lua@5.4` — Hammerspoon embeds Lua 5.4) and `node --test tests/web.test.js`.

## Tablet setup (Galaxy Tab S2, Android 7)

1. **Update the browser engine**: Play Store → *Android System WebView* (and *Chrome*) → Update. On Android 7 they top out around version 119, which this page targets. After the tablet connects, the Hammerspoon console logs its user agent (`client hello: … Chrome/119…`) so you can confirm.
2. **Install Fully Kiosk Browser** from the Play Store.
3. In Fully's settings:
   - *Web Content Settings → Start URL*: `http://<mac-ip>:8765/`
   - *Web Auto Reload → Auto Reload on Network Reconnect*: on (belt and braces; the page also reconnects by itself)
   - *Device Management → Keep Screen On*: on; *Launch on Boot*: on
   - *Appearance*: hide status bar and navigation bar for full screen
   - *Device Management → Screen Orientation*: landscape
   - Optional (Fully PLUS licence): scheduled screen off at night, and *Motion Detection* to wake on approach.
4. **AMOLED burn-in**: the page uses a pure black background and nudges itself 1–2 px every 3 minutes, but a scheduled screen-off overnight is still the best protection. Keep brightness moderate.
5. Keep the tablet on its charger; in Android *Settings → Battery*, exclude Fully Kiosk from battery optimisation.

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
| Changes to the page don't show | The page is served with `no-store`; reload in Fully. Lua changes need a Hammerspoon reload (`hs -c 'hs.reload()'`). |
| Icons missing | `curl -o x.png http://localhost:8765/icon/com.apple.finder.png && file x.png` should say PNG. |

## Extending

Each feature is a module with `name`, `start(notify, log)`, `stop()`, `state()` and `actions`. Add a file in `tabletpanel/`, put it in `M.modules` in `tabletpanel/init.lua`, and add a renderer to `renderers` in `web/app.js`. Planned: window thumbnails (needs Screen Recording), clock/next calendar event, mic mute, system volume.
