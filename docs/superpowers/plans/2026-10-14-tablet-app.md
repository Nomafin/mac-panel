# Tablet App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A small Android app that replaces Fully Kiosk on the Tab S2, plus a Mac `display` module and page changes so the tablet goes dark with the Mac.

**Architecture:** One Kotlin `Activity` hosting a WebView that loads the existing panel page; it is the tablet's home app, captures keys and forwards them as `tablet-key` DOM events, and exposes `TabletApp.setScreen(on)`. The Mac gains a `display` module (pure model + `hs.caffeinate.watcher` glue); the page gains a pure `shouldSleep` rule and a black sleep cover.

**Tech Stack:** Kotlin 1.9.24, AGP 8.5.2, Gradle 8.7, JDK 17, Android SDK 34 (minSdk 24), JUnit 4; Lua 5.4 / Hammerspoon; vanilla JS (Chrome 119 baseline), node --test.

**Spec:** `docs/superpowers/specs/2026-10-14-tablet-app-design.md`

## Global Constraints

- Android: `minSdk 24`, `compileSdk`/`targetSdk 34`, `applicationId "dev.tabletpanel.app"`, label *Mac Panel*, no third-party runtime libraries.
- Default Mac URL `http://192.168.1.62:8765/`; default port 8765.
- Key event names: `back | home | recents | volumeup | volumedown`; event `tablet-key` with `detail.key`.
- Bridge object name `TabletApp`, method `setScreen(on: Boolean)`.
- Sleep: dark after 30 s disconnected; tap peek 60 s; fade ~1 s.
- Escape menu: hold top-left 64 dp for 3 s; items Reload, Mac address…, Android settings, Choose home app.
- Retry interval when the Mac is unreachable at load: 5 s.
- Lua tests: `/opt/homebrew/opt/lua@5.4/bin/lua tests/run.lua`; JS tests: `node --test tests/web.test.js`.

## Review Focus

1. Volume keys held down by the cover → key repeats must not wake the screen or spam the page (only `repeatCount == 0`, and volume keys never peek).
2. Mac fully asleep (no push of `awake=false` arrives) → the page must still go dark after 30 s disconnected, and wake when it reconnects.
3. A failed first load (Mac off at tablet boot) → waiting view, retries every 5 s, then the panel; WebView's own error page never shows.
4. A tap in the escape corner shorter than 3 s must still reach the page; a 3 s hold must not leave the page with a stuck press.
5. Lock + screens wake (password prompt showing) → still dark until unlock.

---

### Task 1: Display model (pure Lua)

**Files:**
- Create: `tabletpanel/display_model.lua`
- Test: `tests/test_display_model.lua`

**Interfaces:**
- Produces: `Model.new({locked=bool}?)`, `model:event(name) -> changedAwake:boolean`, `model:state() -> {awake=bool}`. Event names are the `hs.caffeinate.watcher` constant names as strings.

- [ ] **Step 1: Write the failing test** — `tests/test_display_model.lua`:

```lua
local Model = require('tabletpanel.display_model')

local function run(m, ...)
  for _, e in ipairs({ ... }) do m:event(e) end
  return m:state().awake
end

return function(T)
  T.test('starts awake, or asleep when seeded as locked', function()
    T.eq(Model.new():state(), { awake = true })
    T.eq(Model.new({ locked = true }):state(), { awake = false })
  end)

  T.test('display sleep and wake', function()
    local m = Model.new()
    T.eq(m:event('screensDidSleep'), true)
    T.eq(m:state().awake, false)
    T.eq(m:event('screensDidWake'), true)
    T.eq(m:state().awake, true)
  end)

  T.test('stays asleep after screens wake while still locked, until unlock', function()
    local m = Model.new()
    T.eq(run(m, 'screensDidLock', 'screensDidSleep', 'screensDidWake'), false)
    T.eq(run(m, 'screensDidUnlock'), true)
  end)

  T.test('screensaver and system sleep count as not awake', function()
    T.eq(run(Model.new(), 'screensaverDidStart'), false)
    T.eq(run(Model.new(), 'screensaverDidStart', 'screensaverDidStop'), true)
    T.eq(run(Model.new(), 'systemWillSleep'), false)
    T.eq(run(Model.new(), 'systemWillSleep', 'systemDidWake'), true)
  end)

  T.test('unlock clears everything (the user is at the Mac)', function()
    T.eq(run(Model.new(), 'screensaverDidStart', 'screensDidLock', 'screensDidUnlock'), true)
  end)

  T.test('unknown events and repeats report no change', function()
    local m = Model.new()
    T.eq(m:event('sessionDidBecomeActive'), false)
    T.eq(m:event(nil), false)
    m:event('screensDidSleep')
    T.eq(m:event('screensDidSleep'), false)
  end)
end
```

- [ ] **Step 2: Run** `/opt/homebrew/opt/lua@5.4/bin/lua tests/run.lua display` — Expected: FAIL, module `tabletpanel.display_model` not found.

- [ ] **Step 3: Implement** `tabletpanel/display_model.lua`:

```lua
-- Whether the Mac is in use, from hs.caffeinate.watcher events. Pure.
local Model = {}

-- Each event sets or clears flags; the Mac is awake when no flag is set.
local EFFECTS = {
  screensDidSleep = { screensAsleep = true },
  screensDidWake = { screensAsleep = false, systemSleeping = false },
  systemWillSleep = { systemSleeping = true },
  systemDidWake = { systemSleeping = false, screensAsleep = false },
  screensDidLock = { locked = true },
  -- Unlocking means someone is at the Mac, whatever else was reported.
  screensDidUnlock = { locked = false, screensaver = false, screensAsleep = false, systemSleeping = false },
  screensaverDidStart = { screensaver = true },
  screensaverDidStop = { screensaver = false },
}

local Display = {}
Display.__index = Display

function Model.new(opts)
  return setmetatable({ flags = { locked = (opts and opts.locked) == true } }, Display)
end

function Display:state()
  for _, on in pairs(self.flags) do
    if on then return { awake = false } end
  end
  return { awake = true }
end

-- Returns true when the event changed `awake`.
function Display:event(name)
  local effects = name and EFFECTS[name]
  if not effects then return false end
  local before = self:state().awake
  for flag, on in pairs(effects) do self.flags[flag] = on end
  return self:state().awake ~= before
end

return Model
```

- [ ] **Step 4: Run** `/opt/homebrew/opt/lua@5.4/bin/lua tests/run.lua` — Expected: all pass (72 + 6).

- [ ] **Step 5: Commit** `feat: display model for the Mac's awake state`.

### Task 2: Display module wired into Hammerspoon

**Files:**
- Create: `tabletpanel/display.lua`
- Modify: `tabletpanel/init.lua` (require + `M.modules`)

**Interfaces:**
- Consumes: Task 1 `Model`.
- Produces: hub module `display` with state `{awake=bool}`; no actions.

- [ ] **Step 1: Implement** `tabletpanel/display.lua`:

```lua
-- Reports whether the Mac is in use (display awake and unlocked), so the tablet can go dark.
local Model = require('tabletpanel.display_model')

local D = { name = 'display', actions = {} }

local EVENT_NAMES = {
  'screensDidSleep', 'screensDidWake', 'systemWillSleep', 'systemDidWake',
  'screensDidLock', 'screensDidUnlock', 'screensaverDidStart', 'screensaverDidStop',
}

local model, watcher

function D.start(notify)
  local cw = hs.caffeinate.watcher
  local names = {}
  for _, n in ipairs(EVENT_NAMES) do names[cw[n]] = n end
  local locked = (hs.caffeinate.sessionProperties() or {}).CGSSessionScreenIsLocked
  model = Model.new({ locked = locked == true or locked == 1 })
  watcher = cw.new(function(event)
    if model:event(names[event]) then notify() end
  end):start()
end

function D.stop()
  if watcher then watcher:stop(); watcher = nil end
end

function D.state()
  return model and model:state() or { awake = true }
end

return D
```

- [ ] **Step 2: Wire** in `init.lua`: `local display = require('tabletpanel.display')` and `M.modules = { windows, spotify, display }`.

- [ ] **Step 3: Verify live**: `hs -c 'hs.reload()'` in the background with a timeout, then `curl -s localhost:8765/api/state | jq .display` — Expected: `{"awake": true}`. Then `hs -c 'tabletpanel.hub' >/dev/null` unaffected; lock test is manual (Task 6 checklist).

- [ ] **Step 4: Run** Lua suite — Expected: all pass. **Commit** `feat: display module reports when the Mac is in use`.

### Task 3: Page — sleep cover and tablet keys

**Files:**
- Modify: `tabletpanel/web/app.js`, `tabletpanel/web/app.css`, `tabletpanel/web/index.html`
- Test: `tests/web.test.js`

**Interfaces:**
- Consumes: `display` state `{awake}`; `tablet-key` events; optional `window.TabletApp.setScreen(bool)`.
- Produces: exported pure `shouldSleep(o)`, `keyAction(key, {layerOpen, asleep})`, constants `SLEEP_AFTER_DISCONNECT_MS = 30000`, `PEEK_MS = 60000`.

- [ ] **Step 1: Write failing tests** (append to `tests/web.test.js`):

```js
test('shouldSleep follows the Mac while connected', () => {
  const base = { connected: true, disconnectedSince: null, peekUntil: 0, now: 1000 };
  assert.equal(h.shouldSleep({ ...base, macAwake: true }), false);
  assert.equal(h.shouldSleep({ ...base, macAwake: false }), true);
  assert.equal(h.shouldSleep({ ...base, macAwake: undefined }), false);
});

test('shouldSleep goes dark after 30 s without a connection', () => {
  const base = { macAwake: true, connected: false, disconnectedSince: 0, peekUntil: 0 };
  assert.equal(h.shouldSleep({ ...base, now: 29999 }), false);
  assert.equal(h.shouldSleep({ ...base, now: 30000 }), true);
});

test('shouldSleep stays awake during a peek', () => {
  assert.equal(h.shouldSleep({ macAwake: false, connected: true, disconnectedSince: null, peekUntil: 5000, now: 4999 }), false);
  assert.equal(h.shouldSleep({ macAwake: false, connected: true, disconnectedSince: null, peekUntil: 5000, now: 5000 }), true);
});

test('keyAction: back closes the sheet, navigation keys peek while dark, volume keys do nothing', () => {
  assert.equal(h.keyAction('back', { layerOpen: true, asleep: false }), 'closeLayer');
  assert.equal(h.keyAction('back', { layerOpen: false, asleep: false }), null);
  assert.equal(h.keyAction('home', { layerOpen: false, asleep: true }), 'peek');
  assert.equal(h.keyAction('recents', { layerOpen: true, asleep: true }), 'peek');
  assert.equal(h.keyAction('volumedown', { layerOpen: true, asleep: true }), null);
  assert.equal(h.keyAction(undefined, { layerOpen: true, asleep: false }), null);
});
```
Also extend the `mockState variants` test: `assert.equal(h.mockState('').display.awake, true);`

- [ ] **Step 2: Run** `node --test tests/web.test.js` — Expected: FAIL (`h.shouldSleep is not a function`).

- [ ] **Step 3: Implement pure helpers** (top-level in `app.js`, before the mock section) and export them:

```js
const SLEEP_AFTER_DISCONNECT_MS = 30000; // a fully sleeping Mac can't say so; silence means it's gone
const PEEK_MS = 60000;

// Whether the tablet screen should be dark. macAwake is undefined until the Mac reports it.
function shouldSleep({ macAwake, connected, disconnectedSince, peekUntil, now }) {
  if (now < peekUntil) return false;
  if (connected) return macAwake === false;
  return disconnectedSince != null && now - disconnectedSince >= SLEEP_AFTER_DISCONNECT_MS;
}

// What a hardware key does. Volume keys never wake the screen: the cover can hold them down.
function keyAction(key, { layerOpen, asleep }) {
  if (asleep) return key === 'back' || key === 'home' || key === 'recents' ? 'peek' : null;
  if (key === 'back' && layerOpen) return 'closeLayer';
  return null;
}
```
`mockState` returns `display: { awake: true }` alongside `windows` and `spotify`. `MockSocket` gains:

```js
  // Dev aid: ?mock pages toggle the Mac's awake state with the "d" key.
  toggleDisplay() {
    this.state.display.awake = !this.state.display.awake;
    this.v += 1;
    if (this.onmessage) this.onmessage({ data: JSON.stringify(this.stateMsg('display')) });
  }
```

- [ ] **Step 4: Wire into `boot()`**:
  - `index.html`: add `<div id="sleep" class="sleep" aria-hidden="true"></div>` after `#dot`.
  - `store` gains `display: null`; `renderers` gains `display: updateSleep`.
  - Sleep section:

```js
  /* ----- sleep: dark while the Mac isn't in use ----- */

  const sleepEl = $('sleep');
  const sleep = { connected: false, disconnectedSince: Date.now(), peekUntil: 0, asleep: false };

  function updateSleep() {
    const asleep = shouldSleep({
      macAwake: store.display ? store.display.awake : undefined,
      connected: sleep.connected,
      disconnectedSince: sleep.disconnectedSince,
      peekUntil: sleep.peekUntil,
      now: Date.now(),
    });
    if (asleep === sleep.asleep) return;
    sleep.asleep = asleep;
    document.body.classList.toggle('asleep', asleep);
    if (window.TabletApp) {
      try { window.TabletApp.setScreen(!asleep); } catch (_) { /* older app build */ }
    }
  }

  function peek() {
    sleep.peekUntil = Date.now() + PEEK_MS;
    updateSleep();
  }

  sleepEl.addEventListener('pointerdown', (e) => { e.preventDefault(); peek(); });
  setInterval(updateSleep, 1000);
```
  - `setConnected(on)` adds: `sleep.connected = on; sleep.disconnectedSince = on ? null : (sleep.disconnectedSince ?? Date.now()); updateSleep();`
  - After the layer section: 

```js
  window.addEventListener('tablet-key', (e) => {
    const action = keyAction(e.detail && e.detail.key, { layerOpen: !!openApp, asleep: sleep.asleep });
    if (action === 'closeLayer') closeLayer();
    else if (action === 'peek') peek();
  });
  if (MOCK) document.addEventListener('keydown', (e) => { if (e.key === 'd' && conn.ws) conn.ws.toggleDisplay(); });
```
  The sleep section must be declared before `connect()` runs and before `renderers` is used (place it above the connection section; `renderers.display` is assigned after both exist).

- [ ] **Step 5: CSS** (in the Status section):

```css
.sleep {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: #000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 1s var(--ease-out);
}
body.asleep .sleep { opacity: 1; pointer-events: auto; }
/* Nothing to animate behind a black screen; spare the tablet's GPU. */
body.asleep *, body.asleep *::before, body.asleep *::after { animation-play-state: paused !important; }
```

- [ ] **Step 6: Run** `node --test tests/web.test.js` — Expected: all pass. Verify in Playwright with `?mock`: press `d` → `body.asleep` and cover opaque; tap → awake; dispatch `tablet-key` `back` with sheet open → sheet closes. Live page: `/api/state` has display, no console errors.

- [ ] **Step 7: Commit** `feat: page goes dark with the Mac and handles tablet keys`.

### Task 4: Android toolchain and pure Kotlin logic

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/app/build.gradle.kts`, Gradle wrapper (`android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/*`), `android/app/src/main/java/dev/tabletpanel/app/MacUrl.kt`, `.../Keys.kt`
- Test: `android/app/src/test/java/dev/tabletpanel/app/MacUrlTest.kt`, `KeysTest.kt`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `MacUrl.DEFAULT`, `MacUrl.normalize(input: String): String?`; `Keys.forKeyCode(code: Int): String?`, `Keys.isRecentsReason(reason: String?): Boolean`, `Keys.eventScript(key: String): String`.

- [ ] **Step 1: Toolchain**: `brew install --cask android-commandlinetools android-platform-tools` and `brew install gradle` (only to generate the wrapper). The **user** accepts the SDK licences themselves (`! yes | sdkmanager --licenses`) — accepting a licence is theirs to do. Then `sdkmanager "platforms;android-34" "build-tools;34.0.0"`. `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.
- [ ] **Step 2: Project files**:
  - `settings.gradle.kts`: pluginManagement + dependencyResolutionManagement repositories `google()`, `mavenCentral()` (+ `gradlePluginPortal()` for plugins); `rootProject.name = "MacPanel"`; `include(":app")`.
  - root `build.gradle.kts`: `plugins { id("com.android.application") version "8.5.2" apply false; id("org.jetbrains.kotlin.android") version "1.9.24" apply false }`.
  - `gradle.properties`: `org.gradle.jvmargs=-Xmx2g`, `android.nonTransitiveRClass=true`, `kotlin.code.style=official`.
  - `app/build.gradle.kts`: namespace/applicationId `dev.tabletpanel.app`, compileSdk 34, minSdk 24, targetSdk 34, versionCode 1, versionName "1.0", Java/Kotlin target 17, `testImplementation("junit:junit:4.13.2")`.
  - Wrapper: generate in an empty scratch dir with `gradle wrapper --gradle-version 8.7` and copy `gradlew`, `gradlew.bat`, `gradle/wrapper/` in (the system Gradle is newer than AGP 8.5 supports, so it must not evaluate this project).
  - `local.properties` (ignored): `sdk.dir=/opt/homebrew/share/android-commandlinetools`.
  - `.gitignore` adds `android/.gradle/`, `android/build/`, `android/app/build/`, `android/local.properties`, `android/.kotlin/`.
- [ ] **Step 3: Failing tests**:

```kotlin
// MacUrlTest.kt
package dev.tabletpanel.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MacUrlTest {
    @Test fun addsSchemePortAndSlash() = assertEquals("http://192.168.1.62:8765/", MacUrl.normalize("192.168.1.62"))
    @Test fun keepsGivenPort() = assertEquals("http://mac.local:9000/", MacUrl.normalize("http://mac.local:9000"))
    @Test fun keepsPathAndQueryAndTrims() = assertEquals("http://h:1/x?mock", MacUrl.normalize("  http://h:1/x?mock "))
    @Test fun lowercasesScheme() = assertEquals("https://h:8765/", MacUrl.normalize("HTTPS://h"))
    @Test fun rejectsOtherSchemes() = assertNull(MacUrl.normalize("ftp://h"))
    @Test fun rejectsEmpty() = assertNull(MacUrl.normalize("   "))
    @Test fun rejectsMissingHost() = assertNull(MacUrl.normalize("http://"))
    @Test fun rejectsSpaces() = assertNull(MacUrl.normalize("my mac"))
    @Test fun defaultIsNormal() = assertEquals(MacUrl.DEFAULT, MacUrl.normalize(MacUrl.DEFAULT))
}
```

```kotlin
// KeysTest.kt
package dev.tabletpanel.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeysTest {
    @Test fun mapsKeyCodes() {
        assertEquals("back", Keys.forKeyCode(4))
        assertEquals("volumeup", Keys.forKeyCode(24))
        assertEquals("volumedown", Keys.forKeyCode(25))
        assertNull(Keys.forKeyCode(66)) // Enter stays with the WebView
    }
    @Test fun recognisesRecents() {
        assertTrue(Keys.isRecentsReason("recentapps"))
        assertFalse(Keys.isRecentsReason("homekey"))
        assertFalse(Keys.isRecentsReason(null))
    }
    @Test fun eventScript() = assertEquals(
        "window.dispatchEvent(new CustomEvent('tablet-key',{detail:{key:'back'}}))", Keys.eventScript("back"))
}
```

- [ ] **Step 4: Run** `cd android && ./gradlew test` — Expected: compilation FAIL (`Unresolved reference: MacUrl`).
- [ ] **Step 5: Implement**:

```kotlin
// MacUrl.kt
package dev.tabletpanel.app

import java.net.URI
import java.net.URISyntaxException

/** The panel's address on the Mac, as typed in the escape menu. */
object MacUrl {
    const val DEFAULT = "http://192.168.1.62:8765/"
    private const val DEFAULT_PORT = 8765

    /** Fills in what a person leaves out ("192.168.1.62" → full URL); null if it can't be a panel address. */
    fun normalize(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null
        val withScheme = if ("://" in trimmed) trimmed else "http://$trimmed"
        val uri = try { URI(withScheme) } catch (e: URISyntaxException) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        val port = if (uri.port == -1) DEFAULT_PORT else uri.port
        val path = uri.rawPath.orEmpty().ifEmpty { "/" }
        val query = uri.rawQuery?.let { "?$it" }.orEmpty()
        return "$scheme://$host:$port$path$query"
    }
}
```

```kotlin
// Keys.kt
package dev.tabletpanel.app

import android.view.KeyEvent

/** Hardware keys the panel page hears about, as `tablet-key` DOM events. */
object Keys {
    fun forKeyCode(code: Int): String? = when (code) {
        KeyEvent.KEYCODE_BACK -> "back"
        KeyEvent.KEYCODE_VOLUME_UP -> "volumeup"
        KeyEvent.KEYCODE_VOLUME_DOWN -> "volumedown"
        else -> null
    }

    /** Android 7 announces the Recents key to apps as "close system dialogs" with this reason. */
    fun isRecentsReason(reason: String?) = reason == "recentapps"

    fun eventScript(key: String) = "window.dispatchEvent(new CustomEvent('tablet-key',{detail:{key:'$key'}}))"
}
```
(KeyEvent's KEYCODE_* are compile-time constants, so the JVM tests don't touch the Android stub jar.)

- [ ] **Step 6: Run** `./gradlew test` — Expected: BUILD SUCCESSFUL, 12 tests. **Commit** `feat: Android project with URL and key helpers`.

### Task 5: MainActivity

**Files:**
- Create: `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/dev/tabletpanel/app/MainActivity.kt`

**Interfaces:**
- Consumes: Task 4 helpers; page `tablet-key` listener and `TabletApp` call (Task 3).

- [ ] **Step 1: Manifest**: permissions `INTERNET`, `REORDER_TASKS`; `<application android:label="Mac Panel" android:icon="@android:drawable/sym_def_app_icon" android:usesCleartextTraffic="true" android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen">`; activity `.MainActivity` with `exported="true"`, `launchMode="singleTask"`, `stateNotNeeded="true"`, `screenOrientation="sensorLandscape"`, `configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboard|keyboardHidden|navigation|uiMode"`; intent filters MAIN+LAUNCHER and MAIN+HOME+DEFAULT.

- [ ] **Step 2: MainActivity.kt** — responsibilities, each a small method:
  - `onCreate`: keep-screen-on flag; `FrameLayout` (black) holding the WebView (black background, JS + DOM storage, `addJavascriptInterface(Bridge(), "TabletApp")`, `Client()` as WebViewClient) and the waiting `TextView` (hidden); register the recents receiver for `Intent.ACTION_CLOSE_SYSTEM_DIALOGS`; `load()`.
  - `load()`: cancel retry; `loadFailed = false`; `web.loadUrl(url)` where `url` = prefs `"url"` or `MacUrl.DEFAULT`.
  - `Client`: `onReceivedError`/`onReceivedHttpError` for the main frame → `showWaiting()` (hide WebView, show "Waiting for your Mac…\n\n<url>", post retry in 5 s); `onPageFinished` when not failed → show WebView, hide waiting.
  - `dispatchKeyEvent`: `Keys.forKeyCode` → null: super; else consume, sending the event on key up for Back and key down for volume, only when `repeatCount == 0`.
  - `onNewIntent`: `CATEGORY_HOME` → `sendKey("home")`.
  - Recents receiver: `Keys.isRecentsReason(reason)` → `ActivityManager.moveTaskToFront(taskId, 0)` and `sendKey("recents")`.
  - `sendKey(key)`: `web.evaluateJavascript(Keys.eventScript(key), null)`.
  - `Bridge.setScreen(on)` (`@JavascriptInterface`): on UI thread set `window.attributes.screenBrightness` to `BRIGHTNESS_OVERRIDE_NONE` or `0f`.
  - Immersive sticky flags in `onResume` and `onWindowFocusChanged(true)`.
  - `dispatchTouchEvent`: ACTION_DOWN inside the top-left 64 dp → post `holdMenu` after 3000 ms; UP/CANCEL or a move beyond touch slop → remove it; always pass to super. `holdMenu` sends a synthetic ACTION_CANCEL through super (so the page never sees a stuck press), then `showMenu()`.
  - `showMenu()`: `AlertDialog` (`Theme_DeviceDefault_Dialog_Alert`) with the four items; *Choose home app* opens `Settings.ACTION_HOME_SETTINGS`, falling back to `Settings.ACTION_SETTINGS` if no activity handles it.
  - `editUrl()`: dialog with a URI `EditText` prefilled; Save → `MacUrl.normalize`; null → Toast "That isn't a valid address"; else save to prefs and `load()`.
  - `onDestroy`: unregister receiver, cancel callbacks, destroy WebView.

- [ ] **Step 3: Build** `./gradlew assembleDebug test` — Expected: BUILD SUCCESSFUL; `app/build/outputs/apk/debug/app-debug.apk` exists.
- [ ] **Step 4: Commit** `feat: Mac Panel app — full-screen panel, keys, escape menu`.

### Task 6: README and on-device install

**Files:**
- Modify: `README.md` (replace the Fully Kiosk tablet setup with the app; keep Fully as an alternative note; add display module to "How it works"; on-device checklist; troubleshooting rows)

- [ ] **Step 1: Write README** sections: *Build the tablet app* (toolchain, licences, `./gradlew installDebug`), *Tablet setup* (USB debugging, Home → Mac Panel → Always, escape gesture, uninstall Fully), *On-device checklist* (each key, escape menu items, wrong address → waiting → fix, Mac display sleep/lock/unlock, Mac full sleep → dark after 30 s, tap peek, reboot), troubleshooting (`adb devices` unauthorized; app not offered as Home; screen stays lit → check `/api/state` display).
- [ ] **Step 2: Run** both suites and `./gradlew test` — Expected: all pass. **Commit** `docs: tablet app setup and checklist`.
- [ ] **Step 3: Install (needs the user)**: user enables USB debugging and connects the cable; `adb devices` shows the tablet; `./gradlew installDebug`; walk the checklist with the user.
