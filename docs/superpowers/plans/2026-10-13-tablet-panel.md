# Tablet Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Hammerspoon module that serves a tablet web UI and pushes live window and Spotify state to it over a WebSocket, so a Galaxy Tab S2 acts as an instant window switcher and Spotify remote for the Mac.

**Architecture:** Pure-Lua core (JSON, hub/protocol, window ordering, Spotify parsing, network parsing, HTTP routing) unit-tested with plain `lua`; thin Hammerspoon glue modules (`windows.lua`, `spotify.lua`, `netguard.lua` runtime part, `server.lua` start/stop) verified with curl/websocat; a single no-build HTML/CSS/JS page with a `?mock` mode, its pure helpers tested with `node --test`.

**Tech Stack:** Hammerspoon (Lua 5.4), `hs.httpserver` (HTTP + WebSocket), `hs.window.filter`, `hs.osascript` (AppleScript → Spotify), `hs.distributednotifications`, `hs.task`; vanilla JS/CSS targeting Chrome 119 (Android System WebView in Fully Kiosk Browser); Homebrew `lua`, `websocat`, `jq`; Node 20 for JS tests.

**Spec:** `docs/superpowers/specs/2026-10-13-tablet-panel-design.md`

### Deviations from spec (decided while planning)

1. `json.lua` is a small **pure-Lua** encoder/decoder instead of an `hs.json` wrapper: deterministic key order, explicit empty-array marking, and the whole core is testable without Hammerspoon.
2. **Icons are served over HTTP** at `/icon/<bundleId>.png` with `Cache-Control: max-age=86400` (browser-cached) instead of `icons` WebSocket messages. Keeps WS messages tiny and removes the per-client icon bookkeeping.
3. No separate `snapshot` message type: the `hello` reply carries every module's state in `updates` (same shape as `ping` replies).
4. Spotify state drops `at`: Mac and tablet clocks differ, so the tablet interpolates from the time it *received* the state.
5. Spotify commands use AppleScript `tell` directly (`hs.spotify` is a wrapper over the same thing), behind a running-check so Spotify is never launched by accident.

## Global Constraints

- Port `8765`; WebSocket path `/ws`; debug endpoint `GET /api/state`.
- No authentication. Server runs only when the default gateway's MAC is in `homeRouterMACs`; empty list = always on with a console warning.
- Logging via `hs.logger.new('tabletpanel', 'info')` (prints with `tabletpanel:` prefix). All `hs.*` callbacks guarded with `pcall`; nothing may crash the server.
- Client: no build step, no frameworks, Chrome 119 baseline. Landscape ~1024×768 CSS px; grid ~2/3, Spotify ~1/3; touch targets ≥ 64 px; pure black `#000` background (AMOLED).
- Never launch Spotify: every Spotify AppleScript runs only if `hs.application.get('com.spotify.client')` is non-nil.
- Tile order is stable (first-seen order), never MRU.
- Tests: `lua tests/run.lua` (all pure Lua), `node --test tests/web.test.js`. Both must pass before every commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Finnish/European locale decimals**: AppleScript `player position as string` yields `73,123` on a comma-decimal locale → must parse as 73.123 s, not 73 s or nil. (Pinned in Task 4.)
2. **Spotify closed**: tapping controls or the 2 s poll while Spotify is quit must not relaunch Spotify. (Pinned by the integration check in Task 8.)
3. **Hammerspoon reload / tablet sleep while connected**: page must reconnect by itself within ~5 s and show fresh state, with no stale version blocking updates. (Client resets versions on every connect, liveness timeout drops half-open sockets; checked in Tasks 9 and 10.)
4. **Hostile/odd window titles**: `<`, `&`, quotes, emoji, control characters, very long titles must render as text and encode as valid JSON. (Pinned in Task 1 JSON tests and Task 9 `esc` tests; long-title clamp in mock screenshot.)
5. **`arp` output with stripped leading zeros** (`0:1e:a:…`) must still match a configured `00:1E:0A:…` router MAC. (Pinned in Task 5.)

---

## File Map

| File | Responsibility | Pure? |
|---|---|---|
| `tabletpanel/util.lua` | `deepEqual` | yes |
| `tabletpanel/json.lua` | JSON encode/decode, `json.array` marker | yes |
| `tabletpanel/hub.lua` | module registry, change detection, versions, WS protocol | yes |
| `tabletpanel/windows_model.lua` | raw window records → stable, grouped state | yes |
| `tabletpanel/spotify_model.lua` | AppleScript read script + output parser | yes |
| `tabletpanel/netguard.lua` | route/arp parsing (pure) + network watcher (hs) | mixed (pure functions top-level, hs only inside `start`) |
| `tabletpanel/server.lua` | pure `route()` + hs.httpserver start/stop/send | mixed (same rule) |
| `tabletpanel/windows.lua` | hs.window.filter glue, icons, focus action | hs |
| `tabletpanel/spotify.lua` | Spotify watchers, reads, commands | hs |
| `tabletpanel/init.lua` | config, wiring, netguard → start/stop | hs |
| `tabletpanel/web/index.html`, `app.css`, `app.js` | tablet UI | browser |
| `tests/run.lua`, `tests/test_*.lua` | Lua test runner + tests | — |
| `tests/web.test.js` | JS helper tests | — |
| `README.md` | setup & troubleshooting | — |

Hammerspoon install layout: `~/.hammerspoon/tabletpanel` is a symlink to `<repo>/tabletpanel`; `require('tabletpanel.x')` resolves both there and (in tests, run from repo root) via `./?.lua`.

---

### Task 1: Test runner, `util.lua`, `json.lua`

**Files:**
- Create: `tests/run.lua`, `tests/test_util.lua`, `tests/test_json.lua`, `tabletpanel/util.lua`, `tabletpanel/json.lua`

**Interfaces:**
- Produces: `util.deepEqual(a, b) -> boolean` (ignores metatables). `json.encode(value) -> string` (sorted object keys; tables with metatable from `json.array` or consecutive 1..n keys → arrays; empty plain table → `{}`; errors on functions/NaN/non-string keys). `json.decode(string) -> value` (errors with message starting `json:`; arrays get the `json.array` metatable; `null` → `nil`). `json.array(t?) -> t`.
- Test API used by all later Lua tests: each `tests/test_<name>.lua` returns `function(T)`; `T.test(name, fn)`, `T.eq(actual, expected, label?)`, `T.ok(value, label?)`, `T.raises(fn, pattern?)`.

- [ ] **Step 1: Install Lua**

Run: `brew install lua && lua -v`
Expected: `Lua 5.4.x`

- [ ] **Step 2: Write the test runner**

`tests/run.lua`:
```lua
-- Minimal test runner for the pure Lua modules.
-- Usage (from repo root): lua tests/run.lua [filename-filter]
package.path = './?.lua;' .. package.path
local util = require('tabletpanel.util')

local T = { passed = 0, failed = 0 }
local current = ''

local function show(v)
  if type(v) == 'string' then return string.format('%q', v) end
  if type(v) == 'table' then
    local ok, json = pcall(require, 'tabletpanel.json')
    if ok then
      local okEnc, s = pcall(json.encode, v)
      if okEnc then return s end
    end
  end
  return tostring(v)
end

function T.eq(actual, expected, label)
  if not util.deepEqual(actual, expected) then
    error(string.format('%sexpected %s, got %s', label and (label .. ': ') or '', show(expected), show(actual)), 2)
  end
end

function T.ok(value, label)
  if not value then error(label or 'expected a truthy value', 2) end
end

function T.raises(fn, pattern)
  local ok, err = pcall(fn)
  if ok then error('expected an error', 2) end
  if pattern and not tostring(err):find(pattern, 1, true) then
    error('error "' .. tostring(err) .. '" does not contain "' .. pattern .. '"', 2)
  end
end

function T.test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    T.passed = T.passed + 1
  else
    T.failed = T.failed + 1
    print('FAIL ' .. current .. ' > ' .. name .. '\n     ' .. tostring(err))
  end
end

local filter = arg[1]
local listing = io.popen('ls tests/test_*.lua')
for file in listing:lines() do
  if not filter or file:find(filter, 1, true) then
    current = file:match('test_(.-)%.lua$')
    dofile(file)(T)
  end
end
listing:close()

print(string.format('%d passed, %d failed', T.passed, T.failed))
os.exit(T.failed == 0 and 0 or 1)
```

- [ ] **Step 3: Write failing tests for util and json**

`tests/test_util.lua`:
```lua
local util = require('tabletpanel.util')

return function(T)
  T.test('deepEqual compares scalars', function()
    T.ok(util.deepEqual(1, 1)); T.ok(util.deepEqual('a', 'a'))
    T.ok(not util.deepEqual(1, '1')); T.ok(not util.deepEqual(nil, false))
  end)
  T.test('deepEqual compares nested tables both ways', function()
    T.ok(util.deepEqual({ a = { 1, 2 }, b = true }, { b = true, a = { 1, 2 } }))
    T.ok(not util.deepEqual({ a = 1 }, { a = 1, b = 2 }))
    T.ok(not util.deepEqual({ a = 1, b = 2 }, { a = 1 }))
    T.ok(not util.deepEqual({ 1, 2 }, { 2, 1 }))
  end)
  T.test('deepEqual ignores metatables', function()
    T.ok(util.deepEqual(setmetatable({}, { x = 1 }), {}))
  end)
end
```

`tests/test_json.lua`:
```lua
local json = require('tabletpanel.json')

return function(T)
  T.test('encodes scalars', function()
    T.eq(json.encode(true), 'true')
    T.eq(json.encode(42), '42')
    T.eq(json.encode(3.0), '3')
    T.eq(json.encode(1.5), '1.5')
    T.eq(json.encode('hi'), '"hi"')
  end)
  T.test('escapes quotes, backslashes and control characters', function()
    T.eq(json.encode('a"b\\c\nd\te\1'), '"a\\"b\\\\c\\nd\\te\\u0001"')
  end)
  T.test('passes UTF-8 through unchanged', function()
    T.eq(json.encode('Mötley 😀 <b>&</b>'), '"Mötley 😀 <b>&</b>"')
  end)
  T.test('sorts object keys', function()
    T.eq(json.encode({ b = 1, a = 2, c = { z = 1, y = 2 } }), '{"a":2,"b":1,"c":{"y":2,"z":1}}')
  end)
  T.test('encodes sequences as arrays', function()
    T.eq(json.encode({ 1, 'two', { 3 } }), '[1,"two",[3]]')
  end)
  T.test('empty plain table is an object, json.array is an array', function()
    T.eq(json.encode({}), '{}')
    T.eq(json.encode(json.array()), '[]')
    T.eq(json.encode({ list = json.array({}) }), '{"list":[]}')
  end)
  T.test('rejects unencodable values', function()
    T.raises(function() json.encode(print) end, 'json:')
    T.raises(function() json.encode(0 / 0) end, 'json:')
    T.raises(function() json.encode({ [true] = 1 }) end, 'json:')
  end)
  T.test('decodes objects, arrays and literals', function()
    T.eq(json.decode('{"a":[1,2,{"b":true}],"c":false,"d":null,"e":"x"}'),
      { a = { 1, 2, { b = true } }, c = false, e = 'x' })
  end)
  T.test('decodes numbers', function()
    T.eq(json.decode('[-1.5e3, 0, 12, 0.25]'), { -1500, 0, 12, 0.25 })
  end)
  T.test('decodes string escapes including surrogate pairs', function()
    T.eq(json.decode('"a\\nb\\"c\\\\ \\u00e4 \\ud83d\\ude00 \\/"'), 'a\nb"c\\ ä 😀 /')
  end)
  T.test('decoded arrays re-encode as arrays even when empty', function()
    T.eq(json.encode(json.decode('{"x":[]}')), '{"x":[]}')
  end)
  T.test('rejects malformed input', function()
    T.raises(function() json.decode('{') end, 'json:')
    T.raises(function() json.decode('{"a":}') end, 'json:')
    T.raises(function() json.decode('1 2') end, 'json:')
    T.raises(function() json.decode('"open') end, 'json:')
    T.raises(function() json.decode('') end, 'json:')
  end)
  T.test('round-trips a window-like structure', function()
    local v = { focusedId = 7, apps = { { name = 'Café', windows = { { id = 7, title = 'x "y" \\ z' } } } } }
    T.eq(json.decode(json.encode(v)), v)
  end)
end
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `lua tests/run.lua`
Expected: crashes with `module 'tabletpanel.util' not found`.

- [ ] **Step 5: Implement `util.lua`**

`tabletpanel/util.lua`:
```lua
-- Small pure helpers shared by the tabletpanel modules.
local util = {}

-- Structural equality for plain data tables (metatables are ignored).
function util.deepEqual(a, b)
  if a == b then return true end
  if type(a) ~= 'table' or type(b) ~= 'table' then return false end
  for k, v in pairs(a) do
    if not util.deepEqual(v, b[k]) then return false end
  end
  for k in pairs(b) do
    if a[k] == nil then return false end
  end
  return true
end

return util
```

- [ ] **Step 6: Implement `json.lua`**

`tabletpanel/json.lua`:
```lua
-- Minimal deterministic JSON for tabletpanel (pure Lua, no hs.* dependency).
-- Object keys are sorted; mark empty arrays with json.array().
local json = {}

local ARRAY_MT = { __name = 'json.array' }

function json.array(t)
  return setmetatable(t or {}, ARRAY_MT)
end

local ESCAPES = {
  ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
  ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function encodeString(s)
  local escaped = s:gsub('[%c"\\]', function(c)
    return ESCAPES[c] or string.format('\\u%04x', c:byte())
  end)
  return '"' .. escaped .. '"'
end

local function isArray(t)
  if getmetatable(t) == ARRAY_MT then return true end
  local n = #t
  if n == 0 then return false end
  local count = 0
  for _ in pairs(t) do count = count + 1 end
  return count == n
end

local function encodeValue(v, out)
  local tv = type(v)
  if v == nil then
    out[#out + 1] = 'null'
  elseif tv == 'boolean' then
    out[#out + 1] = tostring(v)
  elseif tv == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then error('json: cannot encode ' .. tostring(v), 0) end
    if math.type(v) == 'integer' or (v == math.floor(v) and math.abs(v) < 2 ^ 53) then
      out[#out + 1] = string.format('%d', v)
    else
      out[#out + 1] = string.format('%.14g', v)
    end
  elseif tv == 'string' then
    out[#out + 1] = encodeString(v)
  elseif tv == 'table' then
    if isArray(v) then
      out[#out + 1] = '['
      for i = 1, #v do
        if i > 1 then out[#out + 1] = ',' end
        encodeValue(v[i], out)
      end
      out[#out + 1] = ']'
    else
      local keys = {}
      for k in pairs(v) do
        if type(k) ~= 'string' then error('json: object keys must be strings', 0) end
        keys[#keys + 1] = k
      end
      table.sort(keys)
      out[#out + 1] = '{'
      for i, k in ipairs(keys) do
        if i > 1 then out[#out + 1] = ',' end
        out[#out + 1] = encodeString(k)
        out[#out + 1] = ':'
        encodeValue(v[k], out)
      end
      out[#out + 1] = '}'
    end
  else
    error('json: cannot encode type ' .. tv, 0)
  end
end

function json.encode(v)
  local out = {}
  encodeValue(v, out)
  return table.concat(out)
end

local function fail(pos, msg)
  error(string.format('json: %s at position %d', msg, pos), 0)
end

local function skip(str, pos)
  return str:find('[^ \t\r\n]', pos) or #str + 1
end

local SIMPLE_ESCAPES = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }

local function parseString(str, pos) -- pos is at the opening quote
  local buf = {}
  local i = pos + 1
  while true do
    local j = str:find('["\\]', i)
    if not j then fail(i, 'unterminated string') end
    buf[#buf + 1] = str:sub(i, j - 1)
    if str:sub(j, j) == '"' then return table.concat(buf), j + 1 end
    local e = str:sub(j + 1, j + 1)
    if SIMPLE_ESCAPES[e] then
      buf[#buf + 1] = SIMPLE_ESCAPES[e]
      i = j + 2
    elseif e == 'u' then
      local hex = str:sub(j + 2, j + 5)
      if not hex:match('^%x%x%x%x$') then fail(j, 'bad unicode escape') end
      local cp = tonumber(hex, 16)
      i = j + 6
      if cp >= 0xD800 and cp <= 0xDBFF and str:sub(i, i + 1) == '\\u' then
        local lo = tonumber(str:sub(i + 2, i + 5), 16)
        if lo and lo >= 0xDC00 and lo <= 0xDFFF then
          cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00)
          i = i + 6
        end
      end
      buf[#buf + 1] = utf8.char(cp)
    else
      fail(j, 'bad escape')
    end
  end
end

local parseValue

local function parseObject(str, pos)
  local obj = {}
  pos = skip(str, pos + 1)
  if str:sub(pos, pos) == '}' then return obj, pos + 1 end
  while true do
    if str:sub(pos, pos) ~= '"' then fail(pos, 'expected string key') end
    local key
    key, pos = parseString(str, pos)
    pos = skip(str, pos)
    if str:sub(pos, pos) ~= ':' then fail(pos, "expected ':'") end
    obj[key], pos = parseValue(str, pos + 1)
    pos = skip(str, pos)
    local c = str:sub(pos, pos)
    if c == '}' then return obj, pos + 1 end
    if c ~= ',' then fail(pos, "expected ',' or '}'") end
    pos = skip(str, pos + 1)
  end
end

local function parseArray(str, pos)
  local arr = json.array({})
  local n = 0
  pos = skip(str, pos + 1)
  if str:sub(pos, pos) == ']' then return arr, pos + 1 end
  while true do
    n = n + 1
    arr[n], pos = parseValue(str, pos)
    pos = skip(str, pos)
    local c = str:sub(pos, pos)
    if c == ']' then return arr, pos + 1 end
    if c ~= ',' then fail(pos, "expected ',' or ']'") end
    pos = pos + 1
  end
end

parseValue = function(str, pos)
  pos = skip(str, pos)
  local c = str:sub(pos, pos)
  if c == '{' then return parseObject(str, pos) end
  if c == '[' then return parseArray(str, pos) end
  if c == '"' then return parseString(str, pos) end
  if str:sub(pos, pos + 3) == 'true' then return true, pos + 4 end
  if str:sub(pos, pos + 4) == 'false' then return false, pos + 5 end
  if str:sub(pos, pos + 3) == 'null' then return nil, pos + 4 end
  local s, e = str:find('^-?%d+%.?%d*[eE]?[+-]?%d*', pos)
  if not s then fail(pos, 'unexpected input') end
  local n = tonumber(str:sub(s, e))
  if not n then fail(pos, 'bad number') end
  return n, e + 1
end

function json.decode(str)
  if type(str) ~= 'string' then error('json: expected a string', 0) end
  local value, pos = parseValue(str, 1)
  pos = skip(str, pos)
  if pos <= #str then fail(pos, 'trailing characters') end
  return value
end

return json
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `lua tests/run.lua`
Expected: `16 passed, 0 failed` (3 util + 13 json), exit code 0.

- [ ] **Step 8: Commit**

```bash
git add tests/run.lua tests/test_util.lua tests/test_json.lua tabletpanel/util.lua tabletpanel/json.lua
git commit -m "feat: add Lua test runner, deepEqual and deterministic JSON

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `hub.lua` — registry, change detection, protocol

**Files:**
- Create: `tabletpanel/hub.lua`, `tests/test_hub.lua`

**Interfaces:**
- Consumes: `json.encode/decode/array`, `util.deepEqual` (Task 1).
- Produces:
  - `Hub.new({ send = fn(string), log = fn(string)? }) -> hub`
  - `hub:register(module)` where `module = { name = string, state = fn() -> table, actions = { [name] = fn(args) -> true | false, err } }`
  - `hub:notify(name)` — recompute; if changed, bump version and `send` a `{"type":"state","module":…,"v":…,"data":…}` message.
  - `hub:snapshot() -> { versions = {name = v}, [name] = state }`
  - `hub:handleMessage(raw) -> string` (reply JSON). Commands: `hello` (args `{ua}` logged; replies all modules in `updates`), `ping` (top-level `versions` map; replies modules whose version differs), `<module>.<action>` (args table; on success notifies the module and replies its state in `updates`). Errors: `bad_request`, `unknown_command`, `internal_error`, or the action's own error string.

- [ ] **Step 1: Write failing tests**

`tests/test_hub.lua`:
```lua
local Hub = require('tabletpanel.hub')
local json = require('tabletpanel.json')

local function setup()
  local sent, logs = {}, {}
  local hub = Hub.new({
    send = function(s) sent[#sent + 1] = json.decode(s) end,
    log = function(m) logs[#logs + 1] = m end,
  })
  local mod = { name = 'counter', value = 1, actions = {} }
  mod.state = function() return { value = mod.value } end
  mod.actions.set = function(args)
    if args.value == nil then return false, 'bad_args' end
    mod.value = args.value
    return true
  end
  mod.actions.boom = function() error('kaboom') end
  hub:register(mod)
  return hub, mod, sent, logs
end

local function call(hub, msg)
  return json.decode(hub:handleMessage(json.encode(msg)))
end

local function stateMsg(v, value)
  return { type = 'state', module = 'counter', v = v, data = { value = value } }
end

return function(T)
  T.test('notify pushes state with version 1 the first time', function()
    local hub, _, sent = setup()
    hub:notify('counter')
    T.eq(sent, { stateMsg(1, 1) })
  end)

  T.test('notify does not push when state is unchanged', function()
    local hub, _, sent = setup()
    hub:notify('counter'); hub:notify('counter')
    T.eq(#sent, 1)
  end)

  T.test('notify pushes again with bumped version after a change', function()
    local hub, mod, sent = setup()
    hub:notify('counter')
    mod.value = 2
    hub:notify('counter')
    T.eq(sent[2], stateMsg(2, 2))
  end)

  T.test('hello replies with every module as updates and logs the user agent', function()
    local hub, _, _, logs = setup()
    T.eq(call(hub, { id = 1, cmd = 'hello', args = { ua = 'TestAgent/1' } }),
      { type = 'reply', id = 1, ok = true, updates = { stateMsg(1, 1) } })
    T.ok(table.concat(logs, '\n'):find('TestAgent/1', 1, true), 'user agent logged')
  end)

  T.test('ping with current versions returns an empty updates array', function()
    local hub = setup()
    call(hub, { id = 1, cmd = 'hello' })
    local raw = hub:handleMessage(json.encode({ id = 2, cmd = 'ping', versions = { counter = 1 } }))
    T.ok(raw:find('"updates":[]', 1, true), 'updates encoded as empty array: ' .. raw)
  end)

  T.test('ping with a stale version returns that module', function()
    local hub, mod = setup()
    call(hub, { id = 1, cmd = 'hello' })
    mod.value = 5
    hub:notify('counter')
    T.eq(call(hub, { id = 2, cmd = 'ping', versions = { counter = 1 } }).updates, { stateMsg(2, 5) })
  end)

  T.test('ping with a version from before a reload (higher number) still returns state', function()
    local hub = setup()
    T.eq(call(hub, { id = 3, cmd = 'ping', versions = { counter = 99 } }).updates, { stateMsg(1, 1) })
  end)

  T.test('successful action replies ok with fresh state and pushes it', function()
    local hub, _, sent = setup()
    call(hub, { id = 1, cmd = 'hello' })
    T.eq(call(hub, { id = 2, cmd = 'counter.set', args = { value = 9 } }),
      { type = 'reply', id = 2, ok = true, updates = { stateMsg(2, 9) } })
    T.eq(sent[#sent], stateMsg(2, 9))
  end)

  T.test('action returning false replies with its error', function()
    local hub = setup()
    T.eq(call(hub, { id = 4, cmd = 'counter.set', args = {} }),
      { type = 'reply', id = 4, ok = false, error = 'bad_args' })
  end)

  T.test('action that throws replies internal_error and logs', function()
    local hub, _, _, logs = setup()
    T.eq(call(hub, { id = 5, cmd = 'counter.boom' }), { type = 'reply', id = 5, ok = false, error = 'internal_error' })
    T.ok(table.concat(logs, '\n'):find('kaboom', 1, true), 'error logged')
  end)

  T.test('unknown module or action replies unknown_command', function()
    local hub = setup()
    T.eq(call(hub, { id = 6, cmd = 'nope.set' }).error, 'unknown_command')
    T.eq(call(hub, { id = 7, cmd = 'counter.nope' }).error, 'unknown_command')
    T.eq(call(hub, { id = 8, cmd = 'counter' }).error, 'unknown_command')
  end)

  T.test('malformed messages reply bad_request', function()
    local hub = setup()
    T.eq(json.decode(hub:handleMessage('not json')), { type = 'reply', ok = false, error = 'bad_request' })
    T.eq(json.decode(hub:handleMessage('[1,2]')).error, 'bad_request')
    T.eq(json.decode(hub:handleMessage('{"id":1}')).error, 'bad_request')
  end)

  T.test('a throwing state() is logged and does not push', function()
    local hub, mod, sent, logs = setup()
    mod.state = function() error('state broke') end
    hub:notify('counter')
    T.eq(#sent, 0)
    T.ok(table.concat(logs, '\n'):find('state broke', 1, true), 'logged')
  end)

  T.test('a throwing send is logged, not raised', function()
    local logs = {}
    local hub = Hub.new({ send = function() error('socket gone') end, log = function(m) logs[#logs + 1] = m end })
    hub:register({ name = 'm', state = function() return { a = 1 } end, actions = {} })
    hub:notify('m')
    T.ok(table.concat(logs, '\n'):find('socket gone', 1, true), 'logged')
  end)

  T.test('snapshot returns versions and state of all modules', function()
    local hub = setup()
    T.eq(hub:snapshot(), { versions = { counter = 1 }, counter = { value = 1 } })
  end)
end
```

- [ ] **Step 2: Run to verify failure**

Run: `lua tests/run.lua hub`
Expected: crash `module 'tabletpanel.hub' not found`.

- [ ] **Step 3: Implement**

`tabletpanel/hub.lua`:
```lua
-- Module registry, change detection and the WebSocket message protocol.
-- Pure: no hs.* calls; the server injects send/log.
local json = require('tabletpanel.json')
local util = require('tabletpanel.util')

local Hub = {}
Hub.__index = Hub

-- opts.send(string): push a message to the WebSocket client
-- opts.log(string): optional logger
function Hub.new(opts)
  return setmetatable({
    modules = {}, order = {}, versions = {}, last = {},
    send = opts.send, log = opts.log or function() end,
  }, Hub)
end

function Hub:register(mod)
  self.modules[mod.name] = mod
  self.order[#self.order + 1] = mod.name
  self.versions[mod.name] = 0
end

function Hub:stateMessage(name)
  return { type = 'state', module = name, v = self.versions[name], data = self.last[name] }
end

-- Recompute a module's state; bump its version if it changed. Returns true when changed.
function Hub:refresh(name)
  local ok, state = pcall(self.modules[name].state)
  if not ok then
    self.log('state() failed for ' .. name .. ': ' .. tostring(state))
    return false
  end
  if self.versions[name] > 0 and util.deepEqual(state, self.last[name]) then return false end
  self.last[name] = state
  self.versions[name] = self.versions[name] + 1
  return true
end

function Hub:notify(name)
  if not self:refresh(name) then return end
  local ok, err = pcall(self.send, json.encode(self:stateMessage(name)))
  if not ok then self.log('send failed: ' .. tostring(err)) end
end

local function ensureFresh(self, name)
  if self.versions[name] == 0 then self:refresh(name) end
end

function Hub:snapshot()
  local out = { versions = {} }
  for _, name in ipairs(self.order) do
    ensureFresh(self, name)
    out[name] = self.last[name]
    out.versions[name] = self.versions[name]
  end
  return out
end

-- State messages for every module whose version differs from the client's.
function Hub:updatesFor(clientVersions)
  local updates = json.array({})
  for _, name in ipairs(self.order) do
    ensureFresh(self, name)
    if self.versions[name] > 0 and clientVersions[name] ~= self.versions[name] then
      updates[#updates + 1] = self:stateMessage(name)
    end
  end
  return updates
end

local function reply(id, ok, extra)
  local msg = { type = 'reply', id = id, ok = ok }
  for k, v in pairs(extra or {}) do msg[k] = v end
  return json.encode(msg)
end

function Hub:handleMessage(raw)
  local decoded, msg = pcall(json.decode, raw)
  if not decoded or type(msg) ~= 'table' or type(msg.cmd) ~= 'string' then
    return reply(nil, false, { error = 'bad_request' })
  end
  local id, args = msg.id, type(msg.args) == 'table' and msg.args or {}

  if msg.cmd == 'hello' then
    self.log('client hello: ' .. tostring(args.ua))
    return reply(id, true, { updates = self:updatesFor({}) })
  end
  if msg.cmd == 'ping' then
    return reply(id, true, { updates = self:updatesFor(type(msg.versions) == 'table' and msg.versions or {}) })
  end

  local modName, action = msg.cmd:match('^([%w_]+)%.([%w_]+)$')
  local mod = modName and self.modules[modName]
  local fn = mod and mod.actions and mod.actions[action]
  if not fn then return reply(id, false, { error = 'unknown_command' }) end

  local called, ok, err = pcall(fn, args)
  if not called then
    self.log('action ' .. msg.cmd .. ' failed: ' .. tostring(ok))
    return reply(id, false, { error = 'internal_error' })
  end
  if not ok then return reply(id, false, { error = err or 'failed' }) end

  self:notify(modName)
  return reply(id, true, { updates = json.array({ self:stateMessage(modName) }) })
end

return Hub
```

- [ ] **Step 4: Run tests**

Run: `lua tests/run.lua`
Expected: all pass, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add tabletpanel/hub.lua tests/test_hub.lua
git commit -m "feat: add hub with change detection and WebSocket protocol

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `windows_model.lua` — stable grouping and ordering

**Files:**
- Create: `tabletpanel/windows_model.lua`, `tests/test_windows_model.lua`

**Interfaces:**
- Consumes: `json.array` (Task 1).
- Produces: `Model.new() -> model`; `model:build(raw, focusedId) -> state` where `raw` is an array of `{ id, title, bundleId, appName, appHidden, minimized, onCurrentSpace, standard }` and state is `{ focusedId = number|nil, apps = array of { bundleId, name, hidden, windows = array of { id, title, minimized, otherSpace } } }`.

- [ ] **Step 1: Write failing tests**

`tests/test_windows_model.lua`:
```lua
local Model = require('tabletpanel.windows_model')
local json = require('tabletpanel.json')

local function win(id, bundleId, title, extra)
  local w = {
    id = id, bundleId = bundleId, appName = bundleId:match('[^.]+$'), title = title,
    standard = true, appHidden = false, minimized = false, onCurrentSpace = true,
  }
  for k, v in pairs(extra or {}) do w[k] = v end
  return w
end

local function ids(state)
  local out = {}
  for _, app in ipairs(state.apps) do
    for _, w in ipairs(app.windows) do out[#out + 1] = w.id end
  end
  return out
end

return function(T)
  T.test('builds grouped state with the documented shape', function()
    local m = Model.new()
    T.eq(m:build({ win(1, 'com.x.Safari', 'GitHub') }, 1), {
      focusedId = 1,
      apps = { { bundleId = 'com.x.Safari', name = 'Safari', hidden = false,
        windows = { { id = 1, title = 'GitHub', minimized = false, otherSpace = false } } } },
    })
  end)

  T.test('order is stable when the raw order changes', function()
    local m = Model.new()
    local a, b, c = win(1, 'a.A', 'one'), win(2, 'b.B', 'two'), win(3, 'a.A', 'three')
    T.eq(ids(m:build({ a, b, c })), { 1, 3, 2 })
    T.eq(ids(m:build({ c, b, a })), { 1, 3, 2 })
  end)

  T.test('new windows append within their app and new apps append at the end', function()
    local m = Model.new()
    m:build({ win(1, 'a.A', 'one'), win(2, 'b.B', 'two') })
    T.eq(ids(m:build({ win(9, 'c.C', 'new app'), win(5, 'a.A', 'new win'), win(2, 'b.B', 'two'), win(1, 'a.A', 'one') })),
      { 1, 5, 2, 9 })
  end)

  T.test('an app that disappears and returns goes to the end', function()
    local m = Model.new()
    m:build({ win(1, 'a.A', 'one'), win(2, 'b.B', 'two') })
    m:build({ win(2, 'b.B', 'two') })
    T.eq(ids(m:build({ win(3, 'a.A', 'again'), win(2, 'b.B', 'two') })), { 2, 3 })
  end)

  T.test('drops non-standard, untitled and incomplete windows', function()
    local m = Model.new()
    local raw = {
      win(1, 'a.A', 'ok'),
      win(2, 'a.A', 'panel', { standard = false }),
      win(3, 'a.A', ''),
      win(4, 'a.A', 'no bundle'),
      win(5, 'a.A', 'no id'),
    }
    raw[4].bundleId = nil -- nil can't be passed through the `extra` table
    raw[5].id = nil
    T.eq(ids(m:build(raw)), { 1 })
  end)

  T.test('otherSpace only for visible windows off the current Space', function()
    local m = Model.new()
    local s = m:build({
      win(1, 'a.A', 'elsewhere', { onCurrentSpace = false }),
      win(2, 'a.A', 'minimized', { onCurrentSpace = false, minimized = true }),
      win(3, 'b.B', 'hidden app', { onCurrentSpace = false, appHidden = true }),
    })
    T.eq(s.apps[1].windows[1].otherSpace, true)
    T.eq(s.apps[1].windows[2].otherSpace, false)
    T.eq(s.apps[1].windows[2].minimized, true)
    T.eq(s.apps[2].windows[1].otherSpace, false)
    T.eq(s.apps[2].hidden, true)
  end)

  T.test('empty input encodes apps as an empty array and omits focusedId', function()
    T.eq(json.encode(Model.new():build({}, nil)), '{"apps":[]}')
  end)

  T.test('falls back to bundle id when app name is missing', function()
    local w = win(1, 'a.A', 'x'); w.appName = nil
    T.eq(Model.new():build({ w }).apps[1].name, 'a.A')
  end)
end
```

- [ ] **Step 2: Run to verify failure**

Run: `lua tests/run.lua windows_model`
Expected: crash `module 'tabletpanel.windows_model' not found`.

- [ ] **Step 3: Implement**

`tabletpanel/windows_model.lua`:
```lua
-- Turns raw window records into the grouped "windows" state.
-- Order is stable: apps and windows keep the order in which they were first seen.
local json = require('tabletpanel.json')

local Model = {}
Model.__index = Model

function Model.new()
  return setmetatable({ nextSeq = 1, appSeq = {}, winSeq = {} }, Model)
end

local function seqFor(self, map, key)
  if not map[key] then
    map[key] = self.nextSeq
    self.nextSeq = self.nextSeq + 1
  end
  return map[key]
end

local function bySeq(a, b) return a._seq < b._seq end

-- raw: array of { id, title, bundleId, appName, appHidden, minimized, onCurrentSpace, standard }
function Model:build(raw, focusedId)
  local apps, appList, seenApps, seenWins = {}, {}, {}, {}

  for _, w in ipairs(raw) do
    if w.id and w.bundleId and w.standard and w.title and w.title ~= '' then
      seenWins[w.id], seenApps[w.bundleId] = true, true
      local app = apps[w.bundleId]
      if not app then
        app = {
          bundleId = w.bundleId, name = w.appName or w.bundleId, hidden = w.appHidden == true,
          windows = json.array({}), _seq = seqFor(self, self.appSeq, w.bundleId),
        }
        apps[w.bundleId] = app
        appList[#appList + 1] = app
      end
      app.windows[#app.windows + 1] = {
        id = w.id, title = w.title, minimized = w.minimized == true,
        otherSpace = not w.minimized and not w.appHidden and not w.onCurrentSpace,
        _seq = seqFor(self, self.winSeq, w.id),
      }
    end
  end

  for id in pairs(self.winSeq) do if not seenWins[id] then self.winSeq[id] = nil end end
  for bid in pairs(self.appSeq) do if not seenApps[bid] then self.appSeq[bid] = nil end end

  table.sort(appList, bySeq)
  for _, app in ipairs(appList) do
    table.sort(app.windows, bySeq)
    for _, w in ipairs(app.windows) do w._seq = nil end
    app._seq = nil
  end

  return { focusedId = focusedId, apps = json.array(appList) }
end

return Model
```

Note: `otherSpace = not w.minimized and not w.appHidden and not w.onCurrentSpace` yields a boolean because every operand is coerced by `not`.

- [ ] **Step 4: Run tests**

Run: `lua tests/run.lua`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tabletpanel/windows_model.lua tests/test_windows_model.lua
git commit -m "feat: add stable window grouping model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `spotify_model.lua` — AppleScript read script and parser

**Files:**
- Create: `tabletpanel/spotify_model.lua`, `tests/test_spotify_model.lua`

**Interfaces:**
- Produces: `Model.SEP` (`string.char(31)`), `Model.READ_SCRIPT` (AppleScript string), `Model.parse(output) -> state | nil, err`. Playing/paused state: `{ running = true, state = 'playing'|'paused', track = { id, name, artist, album, durationMs, artworkUrl }, positionMs, volume, shuffle, ['repeat'] }`. Stopped: `{ running = true, state = 'stopped' }`.

- [ ] **Step 1: Write failing tests**

`tests/test_spotify_model.lua`:
```lua
local Model = require('tabletpanel.spotify_model')

local function out(...) return table.concat({ ... }, Model.SEP) end

local function playing(overrides)
  local f = { 'playing', 'spotify:track:1', 'Song', 'Artist', 'Album', '215000', '73.5', 'https://i.scdn.co/image/x', '65', 'false', 'true' }
  for i, v in pairs(overrides or {}) do f[i] = v end
  return out(table.unpack(f))
end

return function(T)
  T.test('parses a playing track', function()
    T.eq(Model.parse(playing()), {
      running = true, state = 'playing',
      track = { id = 'spotify:track:1', name = 'Song', artist = 'Artist', album = 'Album',
        durationMs = 215000, artworkUrl = 'https://i.scdn.co/image/x' },
      positionMs = 73500, volume = 65, shuffle = false, ['repeat'] = true,
    })
  end)

  T.test('parses comma decimal separators (fi_FI locale) without truncating', function()
    T.eq(Model.parse(playing({ [7] = '73,123' })).positionMs, 73123)
  end)

  T.test('keeps commas inside text fields', function()
    T.eq(Model.parse(playing({ [5] = "Hurry Up, We're Dreaming" })).track.album, "Hurry Up, We're Dreaming")
  end)

  T.test('parses paused state and toggles', function()
    local s = Model.parse(playing({ [1] = 'paused', [10] = 'true', [11] = 'false' }))
    T.eq({ s.state, s.shuffle, s['repeat'] }, { 'paused', true, false })
  end)

  T.test('empty artwork url becomes an empty string', function()
    T.eq(Model.parse(playing({ [8] = '' })).track.artworkUrl, '')
  end)

  T.test('stopped means running with nothing playing', function()
    T.eq(Model.parse('stopped'), { running = true, state = 'stopped' })
  end)

  T.test('rejects garbage', function()
    local s, err = Model.parse('something odd')
    T.eq(s, nil); T.ok(err)
    T.eq(Model.parse(nil), nil)
    T.eq(Model.parse(playing({ [1] = 'buffering' })), nil)
  end)

  T.test('read script uses unit separator and guards missing values', function()
    T.ok(Model.READ_SCRIPT:find('character id 31', 1, true))
    T.ok(Model.READ_SCRIPT:find('try', 1, true))
  end)
end
```

- [ ] **Step 2: Run to verify failure**

Run: `lua tests/run.lua spotify_model`
Expected: crash `module 'tabletpanel.spotify_model' not found`.

- [ ] **Step 3: Implement**

`tabletpanel/spotify_model.lua`:
```lua
-- Spotify state: the AppleScript that reads it and the parser for its output. Pure.
local Model = {}

Model.SEP = string.char(31) -- ASCII unit separator; never appears in track metadata

-- Reads everything in one AppleScript round trip. Each field is guarded with `try`
-- because podcasts, ads and local files can return `missing value`.
Model.READ_SCRIPT = [[
tell application "Spotify"
  set d to character id 31
  set st to (player state as string)
  if st is "stopped" then return "stopped"
  set t to current track
  set tId to ""
  set tName to ""
  set tArtist to ""
  set tAlbum to ""
  set tDur to 0
  set tArt to ""
  set pos to 0
  try
    set tId to (id of t) as string
  end try
  try
    set tName to (name of t) as string
  end try
  try
    set tArtist to (artist of t) as string
  end try
  try
    set tAlbum to (album of t) as string
  end try
  try
    set tDur to duration of t
  end try
  try
    set tArt to (artwork url of t) as string
  end try
  try
    set pos to player position
  end try
  return st & d & tId & d & tName & d & tArtist & d & tAlbum & d & (tDur as string) & d & (pos as string) & d & tArt & d & ((sound volume) as string) & d & (shuffling as string) & d & (repeating as string)
end tell
]]

-- AppleScript formats reals with the user's locale, e.g. "73,5" on fi_FI.
local function num(s)
  if not s or s == '' then return nil end
  return tonumber((s:gsub(',', '.')))
end

local function round(x) return math.floor(x + 0.5) end

function Model.parse(output)
  if type(output) ~= 'string' then return nil, 'no output' end
  if output == 'stopped' then return { running = true, state = 'stopped' } end

  local f = {}
  for part in (output .. Model.SEP):gmatch('(.-)' .. Model.SEP) do f[#f + 1] = part end
  if #f ~= 11 then return nil, 'unexpected output: ' .. output:sub(1, 80) end
  if f[1] ~= 'playing' and f[1] ~= 'paused' then return nil, 'unknown player state: ' .. f[1] end

  return {
    running = true,
    state = f[1],
    track = {
      id = f[2], name = f[3], artist = f[4], album = f[5],
      durationMs = round(num(f[6]) or 0),
      artworkUrl = f[8],
    },
    positionMs = round((num(f[7]) or 0) * 1000),
    volume = round(num(f[9]) or 0),
    shuffle = f[10] == 'true',
    ['repeat'] = f[11] == 'true',
  }
end

return Model
```

- [ ] **Step 4: Run tests**

Run: `lua tests/run.lua`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tabletpanel/spotify_model.lua tests/test_spotify_model.lua
git commit -m "feat: add Spotify AppleScript reader and locale-safe parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `netguard.lua` — home-network detection

**Files:**
- Create: `tabletpanel/netguard.lua`, `tests/test_netguard.lua`

**Interfaces:**
- Produces (pure): `N.parseGateway(routeOutput) -> ip|nil`, `N.normalizeMac(s) -> 'aa:bb:cc:dd:ee:ff'|nil`, `N.parseArpMac(arpOutput) -> normalized mac|nil`, `N.isHome(mac, list) -> boolean`.
- Produces (hs): `N.start({ macs = {string}, onChange = fn(isHome), log = hs.logger })`, `N.stop()`. `onChange` is called only on transitions; with an empty `macs` list it is called once with `true`.

- [ ] **Step 1: Write failing tests**

`tests/test_netguard.lua`:
```lua
local N = require('tabletpanel.netguard')

local ROUTE = [[
   route to: default
destination: default
       mask: default
    gateway: 192.168.1.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
]]

return function(T)
  T.test('parses the default gateway', function()
    T.eq(N.parseGateway(ROUTE), '192.168.1.1')
  end)
  T.test('no gateway line yields nil', function()
    T.eq(N.parseGateway('route: writing to routing socket: not in table'), nil)
  end)
  T.test('parses arp output and restores stripped leading zeros', function()
    T.eq(N.parseArpMac('? (192.168.1.1) at 0:1e:a:bb:cc:dd on en0 ifscope [ethernet]'), '00:1e:0a:bb:cc:dd')
  end)
  T.test('incomplete arp entry yields nil', function()
    T.eq(N.parseArpMac('? (192.168.1.1) at (incomplete) on en0 ifscope [ethernet]'), nil)
    T.eq(N.parseArpMac('192.168.1.1 (192.168.1.1) -- no entry'), nil)
  end)
  T.test('normalizes case and dash separators', function()
    T.eq(N.normalizeMac('A4-2B-B0-12-34-56'), 'a4:2b:b0:12:34:56')
  end)
  T.test('rejects malformed MACs', function()
    T.eq(N.normalizeMac('zz:2b:b0:12:34:56'), nil)
    T.eq(N.normalizeMac('a4:2b:b0:12:34'), nil)
    T.eq(N.normalizeMac(nil), nil)
  end)
  T.test('isHome matches across formats', function()
    T.eq(N.isHome('0:1e:a:bb:cc:dd', { 'ff:ff:ff:ff:ff:ff', '00:1E:0A:BB:CC:DD' }), true)
    T.eq(N.isHome('0:1e:a:bb:cc:de', { '00:1E:0A:BB:CC:DD' }), false)
    T.eq(N.isHome(nil, { '00:1E:0A:BB:CC:DD' }), false)
  end)
end
```

- [ ] **Step 2: Run to verify failure**

Run: `lua tests/run.lua netguard`
Expected: crash `module 'tabletpanel.netguard' not found`.

- [ ] **Step 3: Implement**

`tabletpanel/netguard.lua`:
```lua
-- Runs the server only on the home network, identified by the default gateway's MAC.
-- Parsing helpers are pure; hs.* is only touched inside start/stop.
local N = {}

function N.parseGateway(routeOutput)
  return routeOutput and routeOutput:match('gateway:%s*([%d%.]+)')
end

function N.normalizeMac(mac)
  if type(mac) ~= 'string' then return nil end
  local parts = {}
  for p in mac:gmatch('[^:%-]+') do
    if not p:match('^%x%x?$') then return nil end
    parts[#parts + 1] = string.format('%02x', tonumber(p, 16))
  end
  if #parts ~= 6 then return nil end
  return table.concat(parts, ':')
end

function N.parseArpMac(arpOutput)
  return N.normalizeMac(arpOutput and arpOutput:match(' at ([%x:]+) '))
end

function N.isHome(mac, list)
  local m = N.normalizeMac(mac)
  if not m then return false end
  for _, candidate in ipairs(list) do
    if N.normalizeMac(candidate) == m then return true end
  end
  return false
end

local MAX_ATTEMPTS = 5

-- opts: macs = { 'aa:bb:…' }, onChange = fn(isHome), log = hs.logger
function N.start(opts)
  N.stop()
  local log, macs = opts.log, opts.macs or {}
  if #macs == 0 then
    log.w('homeRouterMACs is empty: netguard disabled, server always on')
    opts.onChange(true)
    return
  end

  local home
  local function set(value, reason)
    if value == home then return end
    home = value
    log.i((value and 'home network (' or 'not on home network (') .. reason .. ')')
    opts.onChange(value)
  end

  local check
  local function retryOrGiveUp(attempt, reason)
    set(false, reason)
    if attempt < MAX_ATTEMPTS then
      N._retry = hs.timer.doAfter(3, function() check(attempt + 1) end)
    end
  end

  check = function(attempt)
    if N._retry then N._retry:stop(); N._retry = nil end
    N._task = hs.task.new('/sbin/route', function(code, out)
      local gw = code == 0 and N.parseGateway(out) or nil
      if not gw then return retryOrGiveUp(attempt, 'no default gateway') end
      N._task = hs.task.new('/usr/sbin/arp', function(code2, out2)
        local mac = code2 == 0 and N.parseArpMac(out2) or nil
        if not mac then return retryOrGiveUp(attempt, 'no ARP entry for gateway ' .. gw) end
        set(N.isHome(mac, macs), 'gateway ' .. gw .. ' is ' .. mac)
      end, { '-n', gw })
      N._task:start()
    end, { '-n', 'get', 'default' })
    N._task:start()
  end

  N._store = hs.network.configuration.open()
  N._store:setCallback(function()
    if N._debounce then N._debounce:stop() end
    N._debounce = hs.timer.doAfter(1, function() check(1) end)
  end)
  N._store:monitorKeys({ 'State:/Network/Global/IPv4' })
  N._store:start()
  check(1)
end

function N.stop()
  for _, key in ipairs({ '_retry', '_debounce', '_store' }) do
    if N[key] then N[key]:stop(); N[key] = nil end
  end
end

return N
```

- [ ] **Step 4: Run tests**

Run: `lua tests/run.lua`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tabletpanel/netguard.lua tests/test_netguard.lua
git commit -m "feat: add netguard home-network detection by router MAC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `server.lua`, `init.lua`, Hammerspoon install, first live check

**Files:**
- Create: `tabletpanel/server.lua`, `tests/test_server.lua`, `tabletpanel/init.lua`, `tabletpanel/web/index.html` (temporary stub, replaced in Task 9)
- Create (outside repo): `~/.hammerspoon/init.lua`, symlink `~/.hammerspoon/tabletpanel`

**Interfaces:**
- Consumes: `Hub` (Task 2), `netguard` (Task 5), `json` (Task 1).
- Produces:
  - `Server.new({ port, webDir, hub, icon = fn(bundleId) -> png bytes|nil (optional), log = hs.logger, readFile = fn(path) -> string|nil (optional) })`
  - `server:route(method, path) -> body, status, headers` (pure)
  - `server:start()`, `server:stop()`, `server:send(string)`
  - `init.lua`: `require('tabletpanel').start(overrides) -> M` with `M.hub`, `M.server`, `M.modules`, `M.config`. Module runtime contract: `mod.start(notify, log)`, `mod.stop()`, `mod.state()`, `mod.actions`.

- [ ] **Step 1: Write failing route tests**

`tests/test_server.lua`:
```lua
local Server = require('tabletpanel.server')
local json = require('tabletpanel.json')

local function make()
  local files = {
    ['/web/index.html'] = '<html>hi</html>',
    ['/web/app.js'] = 'console.log(1)',
    ['/web/app.css'] = 'body{}',
  }
  local icons = { ['com.apple.Safari'] = '\137PNG\r\n\26\n' }
  return Server.new({
    webDir = '/web/',
    hub = { snapshot = function() return { versions = { windows = 3 } } end },
    readFile = function(p) return files[p] end,
    icon = function(b) return icons[b] end,
    log = {},
  })
end

return function(T)
  T.test('serves index for / and ignores the query string', function()
    local s = make()
    for _, path in ipairs({ '/', '/?mock', '/index.html' }) do
      local body, status, headers = s:route('GET', path)
      T.eq({ body, status }, { '<html>hi</html>', 200 }, path)
      T.eq(headers['Content-Type'], 'text/html; charset=utf-8')
      T.eq(headers['Cache-Control'], 'no-store')
    end
  end)

  T.test('serves js and css with the right types', function()
    local s = make()
    local _, _, js = s:route('GET', '/app.js')
    local _, _, css = s:route('GET', '/app.css')
    T.eq(js['Content-Type'], 'application/javascript; charset=utf-8')
    T.eq(css['Content-Type'], 'text/css; charset=utf-8')
  end)

  T.test('only whitelisted files are served', function()
    local s = make()
    for _, path in ipairs({ '/missing.js', '/../init.lua', '/%2e%2e/init.lua', '/web/app.js', '/init.lua' }) do
      local _, status = s:route('GET', path)
      T.eq(status, 404, path)
    end
  end)

  T.test('missing file on disk is a 404', function()
    local s = make()
    s.opts.readFile = function() return nil end
    local _, status = s:route('GET', '/')
    T.eq(status, 404)
  end)

  T.test('non-GET is rejected', function()
    local _, status = make():route('POST', '/')
    T.eq(status, 405)
  end)

  T.test('api/state returns the hub snapshot as JSON', function()
    local body, status, headers = make():route('GET', '/api/state')
    T.eq(status, 200)
    T.eq(headers['Content-Type'], 'application/json')
    T.eq(json.decode(body), { versions = { windows = 3 } })
  end)

  T.test('serves app icons as cached PNG', function()
    local body, status, headers = make():route('GET', '/icon/com.apple.Safari.png')
    T.eq({ body, status }, { '\137PNG\r\n\26\n', 200 })
    T.eq(headers['Content-Type'], 'image/png')
    T.eq(headers['Cache-Control'], 'max-age=86400')
  end)

  T.test('unknown or malformed icon requests are 404', function()
    local s = make()
    for _, path in ipairs({ '/icon/com.unknown.png', '/icon/../x.png', '/icon/a b.png' }) do
      local _, status = s:route('GET', path)
      T.eq(status, 404, path)
    end
  end)
end
```

- [ ] **Step 2: Run to verify failure**

Run: `lua tests/run.lua server`
Expected: crash `module 'tabletpanel.server' not found`.

- [ ] **Step 3: Implement `server.lua`**

`tabletpanel/server.lua`:
```lua
-- HTTP + WebSocket server: static UI files, app icons, debug state, and the /ws protocol.
-- route() is pure; hs.httpserver is only touched in start/stop/send.
local json = require('tabletpanel.json')

local Server = {}
Server.__index = Server

local PLAIN = { ['Content-Type'] = 'text/plain; charset=utf-8' }
local STATIC = { ['/'] = 'index.html', ['/index.html'] = 'index.html', ['/app.css'] = 'app.css', ['/app.js'] = 'app.js' }
local TYPES = {
  html = 'text/html; charset=utf-8',
  css = 'text/css; charset=utf-8',
  js = 'application/javascript; charset=utf-8',
}

local function readFile(path)
  local f = io.open(path, 'rb')
  if not f then return nil end
  local body = f:read('a')
  f:close()
  return body
end

-- opts: port, webDir (trailing slash), hub, icon(bundleId) -> png|nil, log (hs.logger), readFile
function Server.new(opts)
  opts.readFile = opts.readFile or readFile
  return setmetatable({ opts = opts }, Server)
end

function Server:route(method, path)
  if method ~= 'GET' then return 'method not allowed', 405, PLAIN end
  local clean = path:match('^[^?#]*')

  local file = STATIC[clean]
  if file then
    local body = self.opts.readFile(self.opts.webDir .. file)
    if not body then return 'not found', 404, PLAIN end
    return body, 200, { ['Content-Type'] = TYPES[file:match('%.(%w+)$')], ['Cache-Control'] = 'no-store' }
  end

  if clean == '/api/state' then
    return json.encode(self.opts.hub:snapshot()), 200,
      { ['Content-Type'] = 'application/json', ['Cache-Control'] = 'no-store' }
  end

  local bundleId = clean:match('^/icon/([%w%.%-_]+)%.png$')
  local png = bundleId and self.opts.icon and self.opts.icon(bundleId)
  if png then
    return png, 200, { ['Content-Type'] = 'image/png', ['Cache-Control'] = 'max-age=86400' }
  end

  return 'not found', 404, PLAIN
end

function Server:start()
  if self.http then return end
  local http = hs.httpserver.new(false, false)
  http:setPort(self.opts.port)
  http:setCallback(function(method, path)
    local ok, body, status, headers = pcall(self.route, self, method, path)
    if not ok then
      self.opts.log.e('http error: ' .. tostring(body))
      return 'internal error', 500, PLAIN
    end
    return body, status, headers
  end)
  http:websocket('/ws', function(message)
    local ok, reply = pcall(self.opts.hub.handleMessage, self.opts.hub, message)
    if not ok then
      self.opts.log.e('ws error: ' .. tostring(reply))
      return '{"type":"reply","ok":false,"error":"internal_error"}'
    end
    return reply
  end)
  http:start()
  self.http = http
end

function Server:send(message)
  if self.http then self.http:send(message) end
end

function Server:stop()
  if self.http then
    self.http:stop()
    self.http = nil
  end
end

return Server
```

- [ ] **Step 4: Run tests**

Run: `lua tests/run.lua`
Expected: all pass.

- [ ] **Step 5: Implement `init.lua` and the stub page**

`tabletpanel/init.lua`:
```lua
-- Tablet control panel: serves the tablet UI and pushes Mac state to it over a WebSocket.
-- Usage in ~/.hammerspoon/init.lua:
--   tabletpanel = require("tabletpanel").start({ homeRouterMACs = { "aa:bb:cc:dd:ee:ff" } })
local Hub = require('tabletpanel.hub')
local Server = require('tabletpanel.server')
local netguard = require('tabletpanel.netguard')

local M = {}

M.config = {
  port = 8765,
  homeRouterMACs = {}, -- empty = netguard disabled, server always on
}

local DIR = debug.getinfo(1, 'S').source:match('^@(.*/)')
local log = hs.logger.new('tabletpanel', 'info')

function M.start(overrides)
  for k, v in pairs(overrides or {}) do M.config[k] = v end

  M.modules = {}
  local server
  local hub = Hub.new({
    send = function(message) server:send(message) end,
    log = function(message) log.i(message) end,
  })
  server = Server.new({ port = M.config.port, webDir = DIR .. 'web/', hub = hub, log = log })
  for _, mod in ipairs(M.modules) do hub:register(mod) end

  local active = false
  local function setActive(on)
    if on == active then return end
    active = on
    if on then
      for _, mod in ipairs(M.modules) do
        mod.start(function() hub:notify(mod.name) end, log)
      end
      server:start()
      log.i('listening on port ' .. M.config.port)
    else
      server:stop()
      for _, mod in ipairs(M.modules) do mod.stop() end
      log.i('server stopped')
    end
  end

  netguard.start({ macs = M.config.homeRouterMACs, onChange = setActive, log = log })
  M.hub, M.server = hub, server
  return M
end

return M
```

`tabletpanel/web/index.html` (stub, replaced in Task 9):
```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Mac Panel</title></head>
<body style="background:#000;color:#fff;font-family:sans-serif">tabletpanel stub</body></html>
```

- [ ] **Step 6: Install Hammerspoon and tooling**

Run: `brew install --cask hammerspoon && brew install websocat`

- [ ] **Step 7: Create Hammerspoon config and symlink**

First confirm nothing exists: `ls -la ~/.hammerspoon` (expected: no such directory — if it exists, stop and ask the user before touching it).

```bash
mkdir -p ~/.hammerspoon
ln -s "$PWD/tabletpanel" ~/.hammerspoon/tabletpanel
```

`~/.hammerspoon/init.lua`:
```lua
require("hs.ipc")
if not hs.ipc.cliStatus("/opt/homebrew", true) then hs.ipc.cliInstall("/opt/homebrew") end

tabletpanel = require("tabletpanel").start({
  homeRouterMACs = {}, -- filled in during Task 10
})
```

- [ ] **Step 8: USER ACTION — launch Hammerspoon and grant Accessibility**

Ask the user to: open Hammerspoon from /Applications, enable **Accessibility** when prompted (System Settings → Privacy & Security → Accessibility → Hammerspoon on), tick "Launch Hammerspoon at login" in its Preferences, and allow incoming connections if the macOS firewall asks. Then choose "Reload Config" from the menu bar icon. Wait for confirmation.

- [ ] **Step 9: Verify HTTP**

Run: `hs -c 'print("ipc ok")'` → `ipc ok`
Run: `curl -s -i http://localhost:8765/ | head -5` → `HTTP/1.1 200`, `Content-Type: text/html; charset=utf-8`
Run: `curl -s http://localhost:8765/api/state` → `{"versions":{}}`
Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8765/../init.lua` → `404`
Hammerspoon console should show `tabletpanel: homeRouterMACs is empty: netguard disabled…` and `listening on port 8765`.

- [ ] **Step 10: Verify WebSocket request/reply**

Run: `(printf '%s\n' '{"id":1,"cmd":"hello","args":{"ua":"websocat"}}'; sleep 1) | websocat ws://localhost:8765/ws`
Expected: `{"id":1,"ok":true,"type":"reply","updates":[]}`; console shows `client hello: websocat`.
Run: `(printf 'garbage\n'; sleep 1) | websocat ws://localhost:8765/ws` → `{"error":"bad_request","ok":false,"type":"reply"}`

- [ ] **Step 11: Determine `send()` fan-out (spec's open question)**

```bash
SP=/private/tmp/claude-501/-Users-miika-Work-Control/244e3ba3-8355-4128-b69f-1e229710c197/scratchpad
(sleep 6) | websocat ws://localhost:8765/ws > $SP/ws_a.log &
sleep 1
(sleep 5) | websocat ws://localhost:8765/ws > $SP/ws_b.log &
sleep 1
hs -c 'tabletpanel.server:send("{\"type\":\"probe\"}")'
sleep 5; echo A:; cat $SP/ws_a.log; echo B:; cat $SP/ws_b.log
```
Record which clients received `{"type":"probe"}`: both (broadcast) or only B (last connected). Either outcome is supported by the design (ping fallback). Note the result in the final report and in README "How it works" (Task 10).

- [ ] **Step 12: Commit**

```bash
git add tabletpanel/server.lua tests/test_server.lua tabletpanel/init.lua tabletpanel/web/index.html
git commit -m "feat: add HTTP/WebSocket server and module wiring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `windows.lua` — window tracking, icons, focus

**Files:**
- Create: `tabletpanel/windows.lua`
- Modify: `tabletpanel/init.lua` (register module, wire icons)

**Interfaces:**
- Consumes: `windows_model` (Task 3); module runtime contract (Task 6).
- Produces: module `windows` with `state()` (spec shape), `actions.focus({ id })` → `true` | `false, 'not_found'`, and `W.icon(bundleId) -> png bytes|nil`.

- [ ] **Step 1: Implement**

`tabletpanel/windows.lua`:
```lua
-- Window switcher: tracks standard windows on all Spaces (best effort) and focuses them.
local Model = require('tabletpanel.windows_model')

local W = { name = 'windows', actions = {} }

local wf = hs.window.filter
local EVENTS = {
  wf.windowCreated, wf.windowDestroyed, wf.windowTitleChanged, wf.windowFocused,
  wf.windowMinimized, wf.windowUnminimized, wf.windowHidden, wf.windowUnhidden,
  wf.windowInCurrentSpace, wf.windowNotInCurrentSpace, wf.windowsChanged,
}
local DEBOUNCE_SECONDS = 0.05

local model, allFilter, spaceFilter, spacesWatcher, debounceTimer, notify
local iconCache = {}

local function schedule()
  if debounceTimer then debounceTimer:stop() end
  debounceTimer = hs.timer.doAfter(DEBOUNCE_SECONDS, function()
    debounceTimer = nil
    notify()
  end)
end

function W.start(notifyFn)
  notify = notifyFn
  model = Model.new()
  -- Copies of the default filter keep its rejections of background/system apps;
  -- an empty default rule also admits minimized and hidden windows.
  allFilter = wf.new(nil):setDefaultFilter({})
  spaceFilter = wf.new(nil):setDefaultFilter({ currentSpace = true })
  allFilter:subscribe(EVENTS, schedule)
  spaceFilter:subscribe(EVENTS, schedule)
  spacesWatcher = hs.spaces.watcher.new(schedule):start()
  schedule()
end

function W.stop()
  if debounceTimer then debounceTimer:stop(); debounceTimer = nil end
  if allFilter then allFilter:unsubscribeAll(); allFilter = nil end
  if spaceFilter then spaceFilter:unsubscribeAll(); spaceFilter = nil end
  if spacesWatcher then spacesWatcher:stop(); spacesWatcher = nil end
end

function W.state()
  if not allFilter then return Model.new():build({}, nil) end
  local onSpace = {}
  for _, w in ipairs(spaceFilter:getWindows()) do
    local id = w:id()
    if id then onSpace[id] = true end
  end
  local raw = {}
  for _, w in ipairs(allFilter:getWindows()) do
    local app, id = w:application(), w:id()
    if app and id then
      raw[#raw + 1] = {
        id = id, title = w:title(), bundleId = app:bundleID(), appName = app:name(),
        appHidden = app:isHidden(), minimized = w:isMinimized(),
        onCurrentSpace = onSpace[id] == true, standard = w:isStandard(),
      }
    end
  end
  local focused = hs.window.focusedWindow()
  return model:build(raw, focused and focused:id() or nil)
end

local function findWindow(id)
  if not allFilter then return nil end
  for _, w in ipairs(allFilter:getWindows()) do
    if w:id() == id then return w end
  end
end

function W.actions.focus(args)
  local win = findWindow(tonumber(args.id))
  if not win then return false, 'not_found' end
  local app = win:application()
  if app and app:isHidden() then app:unhide() end
  if win:isMinimized() then win:unminimize() end
  win:focus() -- macOS switches Space if the window lives on another one (best effort)
  return true
end

-- PNG bytes of the app icon, cached per bundle id (false = no icon available).
function W.icon(bundleId)
  if iconCache[bundleId] == nil then
    local bytes = false
    local img = hs.image.imageFromAppBundle(bundleId)
    if img then
      local url = img:setSize({ w = 128, h = 128 }):encodeAsURLString(false, 'PNG')
      local b64 = url and url:match('^data:image/png;base64,(.+)$')
      bytes = b64 and hs.base64.decode(b64) or false
    end
    iconCache[bundleId] = bytes
  end
  return iconCache[bundleId] or nil
end

return W
```

- [ ] **Step 2: Wire into `init.lua`**

In `tabletpanel/init.lua`, after `local netguard = require('tabletpanel.netguard')` add:
```lua
local windows = require('tabletpanel.windows')
```
Replace `M.modules = {}` with:
```lua
  M.modules = { windows }
```
Replace the `server = Server.new(...)` line with:
```lua
  server = Server.new({ port = M.config.port, webDir = DIR .. 'web/', hub = hub, icon = windows.icon, log = log })
```

- [ ] **Step 3: Run unit tests (nothing pure changed, guard against regressions)**

Run: `lua tests/run.lua` → `0 failed`.

- [ ] **Step 4: Reload and verify state**

Run: `hs -c 'hs.reload()'; sleep 2; curl -s http://localhost:8765/api/state | jq '.windows.apps[] | {name, n: (.windows|length)}'`
Expected: one entry per app with open windows; counts match reality. `jq '.windows.focusedId'` is a number.
Minimize a window (⌘M) → `curl … | jq '[.windows.apps[].windows[] | select(.minimized)] | length'` ≥ 1.
Hide an app (⌘H) → its `hidden` is `true`.

- [ ] **Step 5: Verify icons are real PNGs (confirms binary bodies work)**

Run: `SP=/private/tmp/claude-501/-Users-miika-Work-Control/244e3ba3-8355-4128-b69f-1e229710c197/scratchpad; curl -s http://localhost:8765/icon/com.apple.finder.png -o $SP/finder.png -w '%{http_code} %{content_type}\n'; file $SP/finder.png`
Expected: `200 image/png` and `PNG image data, 128 x 128` (or 256×256 on Retina — either is fine).
If `file` reports text/data instead of PNG, hs.httpserver mangled the binary body: stop and report (fallback would be serving the base64 data URL text and having the client set `img.src` to it).

- [ ] **Step 6: Verify push latency**

Run: `(printf '%s\n' '{"id":1,"cmd":"hello"}'; sleep 20) | websocat ws://localhost:8765/ws | cut -c1-120`
While it runs: open a new Finder window (⌘N), retitle by navigating, close it, focus another app.
Expected: a `{"data":…,"module":"windows","type":"state","v":N…}` line appears within a fraction of a second of each change.

- [ ] **Step 7: Verify focus**

Pick a minimized window id from step 4 and run:
`(printf '{"id":2,"cmd":"windows.focus","args":{"id":%s}}\n' <ID>; sleep 1) | websocat ws://localhost:8765/ws`
Expected: window unminimizes and comes to front; reply `"ok":true`. With a bogus id `999999999` → `"error":"not_found"`.

- [ ] **Step 8: Commit**

```bash
git add tabletpanel/windows.lua tabletpanel/init.lua
git commit -m "feat: add window switcher module with icons and focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `spotify.lua` — Spotify state and commands

**Files:**
- Create: `tabletpanel/spotify.lua`
- Modify: `tabletpanel/init.lua` (register module)

**Interfaces:**
- Consumes: `spotify_model` (Task 4); module runtime contract (Task 6).
- Produces: module `spotify`, `state()` (spec shape minus `at`; `{ running = false }` when closed), actions `playpause`, `next`, `previous`, `shuffle`, `repeat`, `seek({ ms })`, `volume({ value })`; each returns `true` or `false, 'not_running'|'bad_args'|'applescript_failed'`.

- [ ] **Step 1: Implement**

`tabletpanel/spotify.lua`:
```lua
-- Spotify panel: event-driven state reads and transport commands via AppleScript.
-- Every AppleScript call is guarded by a running check so Spotify is never launched by us.
local Model = require('tabletpanel.spotify_model')

local S = { name = 'spotify', actions = {} }

local BUNDLE_ID = 'com.spotify.client'
local POLL_SECONDS = 2 -- volume/shuffle/repeat changed inside Spotify emit no notification

local current = { running = false }
local notify, log, lastError
local watchers = {}

local function isRunning()
  return hs.application.get(BUNDLE_ID) ~= nil
end

local function read()
  if not isRunning() then
    current = { running = false }
    return
  end
  local ok, out, raw = hs.osascript.applescript(Model.READ_SCRIPT)
  local state, err
  if ok then
    state, err = Model.parse(out)
  else
    err = 'AppleScript failed: ' .. hs.inspect(raw)
  end
  if state then
    current, lastError = state, nil
  elseif err ~= lastError then -- keep last good state, log each distinct error once
    lastError = err
    log.w('spotify: ' .. err)
  end
end

local function refresh()
  read()
  notify()
end

local function tell(command)
  if not isRunning() then return false, 'not_running' end
  if not hs.osascript.applescript('tell application "Spotify" to ' .. command) then
    return false, 'applescript_failed'
  end
  read()
  return true
end

S.actions.playpause = function() return tell('playpause') end
S.actions.next = function() return tell('next track') end
S.actions.previous = function() return tell('previous track') end
S.actions.shuffle = function() return tell('set shuffling to not shuffling') end
S.actions['repeat'] = function() return tell('set repeating to not repeating') end

S.actions.seek = function(args)
  local ms = tonumber(args.ms)
  if not ms or ms < 0 then return false, 'bad_args' end
  ms = math.floor(ms)
  -- Built with integer math so the decimal point never depends on the locale.
  return tell(string.format('set player position to %d.%03d', ms // 1000, ms % 1000))
end

S.actions.volume = function(args)
  local v = tonumber(args.value)
  if not v then return false, 'bad_args' end
  return tell(string.format('set sound volume to %d', math.max(0, math.min(100, math.floor(v + 0.5)))))
end

function S.state()
  return current
end

function S.start(notifyFn, logger)
  notify, log = notifyFn, logger
  watchers.notification = hs.distributednotifications.new(refresh, 'com.spotify.client.PlaybackStateChanged'):start()
  watchers.app = hs.application.watcher.new(function(name, event, app)
    local bundleId = app and app:bundleID()
    if bundleId ~= BUNDLE_ID and name ~= 'Spotify' then return end
    if event == hs.application.watcher.launched then
      watchers.launchDelay = hs.timer.doAfter(1.5, refresh) -- AppleScript isn't ready immediately
    elseif event == hs.application.watcher.terminated then
      current = { running = false }
      notify()
    end
  end):start()
  watchers.poll = hs.timer.doEvery(POLL_SECONDS, function()
    if current.running or isRunning() then refresh() end
  end)
  read()
end

function S.stop()
  for _, w in pairs(watchers) do w:stop() end
  watchers = {}
end

return S
```

- [ ] **Step 2: Wire into `init.lua`**

After `local windows = require('tabletpanel.windows')` add:
```lua
local spotify = require('tabletpanel.spotify')
```
Replace `M.modules = { windows }` with:
```lua
  M.modules = { windows, spotify }
```

- [ ] **Step 3: Unit tests still green**

Run: `lua tests/run.lua` → `0 failed`.

- [ ] **Step 4: USER ACTION — Automation permission**

Reload (`hs -c 'hs.reload()'`) with Spotify open and a track loaded. macOS will ask "Hammerspoon wants to control Spotify" — ask the user to click **Allow**. Wait for confirmation.

- [ ] **Step 5: Verify state**

Run: `curl -s http://localhost:8765/api/state | jq .spotify`
Expected (playing): `running: true`, `state: "playing"`, track fields filled, `artworkUrl` starts with `https://i.scdn.co/`, `positionMs` sane (not truncated to whole seconds ×1000 only — check it has non-zero last 3 digits across a few runs), `volume` 0–100.

- [ ] **Step 6: Verify commands and pushes**

Run: `(for c in playpause playpause next shuffle shuffle; do printf '{"id":1,"cmd":"spotify.%s"}\n' $c; sleep 1.5; done) | websocat ws://localhost:8765/ws | cut -c1-160`
Expected: Spotify pauses, resumes, skips; each reply `"ok":true`; state pushes show the change; a track change from Spotify's own UI also pushes instantly.
Run: `(printf '%s\n' '{"id":1,"cmd":"spotify.seek","args":{"ms":60000}}' '{"id":2,"cmd":"spotify.volume","args":{"value":40}}'; sleep 1) | websocat ws://localhost:8765/ws`
Expected: playback jumps to 1:00, Spotify volume 40.

- [ ] **Step 7: Verify Spotify is never relaunched (Review Focus #2)**

Quit Spotify (⌘Q). Wait 5 s. Run:
`(printf '%s\n' '{"id":1,"cmd":"spotify.playpause"}' '{"id":2,"cmd":"spotify.volume","args":{"value":50}}'; sleep 3) | websocat ws://localhost:8765/ws`
Expected: replies `"error":"not_running"`; `curl -s localhost:8765/api/state | jq .spotify` → `{"running":false}`; `pgrep -x Spotify` prints nothing after 5 more seconds.

- [ ] **Step 8: Commit**

```bash
git add tabletpanel/spotify.lua tabletpanel/init.lua
git commit -m "feat: add Spotify module with event-driven state and commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Tablet UI (`index.html`, `app.css`, `app.js`) with mock mode

**Files:**
- Modify (replace stub): `tabletpanel/web/index.html`
- Create: `tabletpanel/web/app.css`, `tabletpanel/web/app.js`, `tests/web.test.js`

**Interfaces:**
- Consumes: WS protocol (Task 2): send `{id, cmd, args?, versions?}`; receive `state` / `reply` (with `updates`). Commands used: `hello {ua}`, `ping` (top-level `versions`), `windows.focus {id}`, `spotify.playpause|next|previous|shuffle|repeat`, `spotify.seek {ms}`, `spotify.volume {value}`. Icons at `icon/<bundleId>.png`.
- Produces (node exports from `app.js`): `esc(s)`, `formatTime(ms)`, `estimatePosition(sp, receivedAt, now)`, `seekFraction(clientX, rect)`, `backoff(attempt)`, `makeThrottle(fn, ms, clock?)`, `mockState(variant)`.
- Extension point for future modules: add a renderer to `renderers` in `boot()` and a container element.

- [ ] **Step 1: Write failing JS tests**

`tests/web.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../tabletpanel/web/app.js');

function fakeClock() {
  const c = {
    t: 0, timers: [],
    now: () => c.t,
    setTimeout: (f, d) => { c.timers.push({ at: c.t + d, f }); },
    advance(ms) {
      c.t += ms;
      const due = c.timers.filter((x) => x.at <= c.t);
      c.timers = c.timers.filter((x) => x.at > c.t);
      due.forEach((x) => x.f());
    },
  };
  return c;
}

test('esc escapes HTML special characters', () => {
  assert.equal(h.esc(`<b a="x">&'</b>`), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;');
  assert.equal(h.esc(null), '');
  assert.equal(h.esc('Café 😀'), 'Café 😀');
});

test('formatTime renders m:ss', () => {
  assert.equal(h.formatTime(0), '0:00');
  assert.equal(h.formatTime(59999), '0:59');
  assert.equal(h.formatTime(61000), '1:01');
  assert.equal(h.formatTime(3725000), '62:05');
  assert.equal(h.formatTime(-5), '0:00');
  assert.equal(h.formatTime(undefined), '0:00');
});

test('estimatePosition interpolates only while playing and clamps to duration', () => {
  const sp = { state: 'playing', positionMs: 1000, track: { durationMs: 5000 } };
  assert.equal(h.estimatePosition(sp, 100, 600), 1500);
  assert.equal(h.estimatePosition(sp, 100, 99999), 5000);
  assert.equal(h.estimatePosition({ ...sp, state: 'paused' }, 100, 600), 1000);
  assert.equal(h.estimatePosition({ state: 'stopped' }, 0, 10), 0);
  assert.equal(h.estimatePosition(sp, 600, 100), 1000);
});

test('seekFraction maps x to 0..1', () => {
  const rect = { left: 100, width: 200 };
  assert.equal(h.seekFraction(200, rect), 0.5);
  assert.equal(h.seekFraction(50, rect), 0);
  assert.equal(h.seekFraction(400, rect), 1);
  assert.equal(h.seekFraction(150, { left: 0, width: 0 }), 0);
});

test('backoff doubles from 500ms and caps at 5s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(h.backoff), [500, 1000, 2000, 4000, 5000, 5000]);
});

test('makeThrottle runs immediately, then coalesces into one trailing call with the last args', () => {
  const clock = fakeClock();
  const calls = [];
  const fn = h.makeThrottle((v) => calls.push([clock.t, v]), 100, clock);
  fn(1);
  clock.advance(30); fn(2);
  clock.advance(30); fn(3);
  clock.advance(40);
  assert.deepEqual(calls, [[0, 1], [100, 3]]);
  clock.advance(200); fn(4);
  assert.deepEqual(calls[2], [300, 4]);
});

test('mockState variants', () => {
  assert.equal(h.mockState('nospotify').spotify.running, false);
  assert.equal(h.mockState('idle').spotify.state, 'stopped');
  assert.equal(h.mockState('').spotify.state, 'playing');
  assert.ok(h.mockState('').windows.apps.length >= 3);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/web.test.js`
Expected: FAIL, `Cannot find module '../tabletpanel/web/app.js'`.

- [ ] **Step 3: Write `index.html`**

`tabletpanel/web/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <meta name="theme-color" content="#000000">
  <title>Mac Panel</title>
  <link rel="stylesheet" href="app.css">
</head>
<body>
  <div id="shell" class="shell no-spotify">
    <main id="windows" class="windows"></main>
    <aside id="spotify" class="spotify" hidden></aside>
  </div>
  <div id="overlay" class="overlay" hidden>Reconnecting…</div>
  <div id="dot" class="dot"></div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write `app.css`**

`tabletpanel/web/app.css`:
```css
:root {
  --bg: #000;
  --surface: #121418;
  --surface-2: #1d2027;
  --rail: #2b2f37;
  --text: #f2f3f5;
  --muted: #8b919b;
  --accent: #4c9dff;
  --green: #1ed760;
  --radius: 14px;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

html, body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.3 system-ui, Roboto, -apple-system, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

button { font: inherit; color: inherit; touch-action: manipulation; cursor: pointer; }

/* ---------- Layout ---------- */
.shell {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
  height: 100vh;
  padding: 12px;
  transition: transform 1s;
}
.shell.no-spotify { grid-template-columns: 1fr; }

/* ---------- Window grid ---------- */
.windows { overflow-y: auto; overscroll-behavior: contain; min-width: 0; }
.empty { color: var(--muted); padding: 48px; text-align: center; font-size: 18px; }

.app-group + .app-group { margin-top: 16px; }
.app-head {
  display: flex; align-items: center; gap: 8px;
  margin: 0 2px 8px;
  color: var(--muted); font-size: 14px; font-weight: 600;
}
.app-head img { width: 20px; height: 20px; }

.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }

.tile {
  position: relative;
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  min-height: 110px;
  padding: 12px;
  border: 2px solid transparent;
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
}
.tile:active { background: var(--surface-2); transform: scale(0.98); }
.tile.focused { border-color: var(--accent); }
.tile.minimized, .tile.app-hidden { opacity: 0.5; }
.tile-icon { width: 48px; height: 48px; }
.tile-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 16px; line-height: 1.25;
  overflow-wrap: anywhere;
}
.badge {
  position: absolute; top: 10px; right: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--muted); font-size: 12px;
}
.tile.shake { animation: shake 0.4s; }
@keyframes shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }

/* ---------- Spotify ---------- */
.spotify {
  min-width: 0;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.spotify.idle { align-self: start; }
.sp-full { display: flex; flex-direction: column; gap: 14px; height: 100%; }
.spotify .sp-idle { display: none; }
.spotify.idle .sp-full { display: none; }
.spotify.idle .sp-idle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.idle-text { color: var(--muted); font-size: 18px; }

.art { width: 100%; aspect-ratio: 1; border-radius: 10px; background: var(--surface-2); object-fit: cover; }
.meta { min-width: 0; }
.title, .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title { font-size: 20px; font-weight: 700; }
.sub { color: var(--muted); font-size: 15px; margin-top: 2px; }

.progress { position: relative; height: 32px; touch-action: none; cursor: pointer; }
.progress .rail, .progress .fill { position: absolute; left: 0; top: 14px; height: 4px; border-radius: 2px; }
.progress .rail { right: 0; background: var(--rail); }
.progress .fill { width: 0; background: var(--text); }
.times {
  display: flex; justify-content: space-between;
  margin-top: -6px;
  color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums;
}

.transport { display: flex; justify-content: space-around; align-items: center; }
.btn {
  display: grid; place-items: center;
  width: 64px; height: 64px;
  border: 0; border-radius: 50%;
  background: transparent;
}
.btn:active { background: var(--surface-2); }
.btn svg { width: 30px; height: 30px; fill: currentColor; }
.btn.play { background: var(--text); color: #000; }
.btn.play svg { width: 34px; height: 34px; }
.btn.toggle { color: var(--muted); }
.btn.toggle.on { color: var(--green); }

.row { display: flex; align-items: center; gap: 6px; }
.row input[type=range] { flex: 1; min-width: 0; height: 40px; accent-color: var(--text); }

/* ---------- Status ---------- */
.overlay {
  position: fixed; inset: 0;
  display: grid; place-items: center;
  background: rgba(0, 0, 0, 0.75);
  color: var(--muted); font-size: 22px;
}
.dot {
  position: fixed; right: 5px; bottom: 5px;
  width: 7px; height: 7px; border-radius: 50%;
  background: #b33;
}
.dot.on { background: #2a6; opacity: 0.5; }

/* ---------- Portrait fallback ---------- */
@media (orientation: portrait) {
  .shell, .shell.no-spotify { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .spotify { order: -1; }
  .sp-full { display: grid; grid-template-columns: 112px 1fr; column-gap: 16px; row-gap: 8px; align-items: center; }
  .sp-full .art { grid-row: span 4; }
}
```

- [ ] **Step 5: Write `app.js`**

`tabletpanel/web/app.js`:
```js
'use strict';

/* ---------- Pure helpers (unit-tested in tests/web.test.js) ---------- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const s = total % 60;
  return Math.floor(total / 60) + ':' + (s < 10 ? '0' : '') + s;
}

// Position now, given the state received at `receivedAt` (client clock; Mac and tablet clocks differ).
function estimatePosition(sp, receivedAt, now) {
  if (!sp || !sp.track) return 0;
  const base = sp.positionMs || 0;
  if (sp.state !== 'playing') return base;
  return Math.min(base + Math.max(0, now - receivedAt), sp.track.durationMs || Infinity);
}

function seekFraction(clientX, rect) {
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function backoff(attempt) {
  return Math.min(500 * Math.pow(2, attempt), 5000);
}

// Calls fn at most once per `ms`; the last call in a burst always runs (trailing).
function makeThrottle(fn, ms, clock) {
  clock = clock || { now: () => Date.now(), setTimeout: (f, d) => setTimeout(f, d) };
  let last = -Infinity;
  let timer = null;
  let pendingArgs = null;
  return function (...args) {
    const wait = last + ms - clock.now();
    if (wait <= 0 && !timer) {
      last = clock.now();
      fn(...args);
      return;
    }
    pendingArgs = args;
    if (!timer) {
      timer = clock.setTimeout(() => {
        timer = null;
        last = clock.now();
        const a = pendingArgs;
        pendingArgs = null;
        fn(...a);
      }, Math.max(0, wait));
    }
  };
}

/* ---------- Mock mode (?mock, ?mock=idle, ?mock=nospotify) ---------- */

function mockState(variant) {
  const spotify = variant === 'nospotify' ? { running: false }
    : variant === 'idle' ? { running: true, state: 'stopped' }
    : {
      running: true, state: 'playing',
      track: { id: 'spotify:track:mock', name: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", durationMs: 243000, artworkUrl: '' },
      positionMs: 61000, volume: 65, shuffle: false, repeat: true,
    };
  return {
    windows: {
      focusedId: 11,
      apps: [
        { bundleId: 'com.apple.Safari', name: 'Safari', hidden: false, windows: [
          { id: 11, title: 'GitHub – Pull requests', minimized: false, otherSpace: false },
          { id: 12, title: 'Hammerspoon docs: hs.window.filter', minimized: false, otherSpace: false },
          { id: 13, title: 'A very long window title that should be clamped to two lines on the tile, really', minimized: true, otherSpace: false },
        ] },
        { bundleId: 'com.microsoft.VSCode', name: 'Code', hidden: false, windows: [
          { id: 21, title: 'app.js — Control', minimized: false, otherSpace: false },
          { id: 22, title: 'init.lua — Control', minimized: false, otherSpace: true },
        ] },
        { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack', hidden: true, windows: [
          { id: 31, title: 'Slack — #general <b>&amp;</b> 😀', minimized: false, otherSpace: false },
        ] },
        { bundleId: 'com.apple.Terminal', name: 'Terminal', hidden: false, windows: [
          { id: 41, title: '~ — zsh', minimized: false, otherSpace: false },
        ] },
      ],
    },
    spotify,
  };
}

function mockIcon(bundleId) {
  let hue = 0;
  for (const c of bundleId) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const letter = bundleId.split('.').pop()[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="hsl(${hue},55%,45%)"/><text x="24" y="32" font-size="24" font-family="sans-serif" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Stands in for WebSocket: same events and message shapes as the Mac side.
class MockSocket {
  constructor(variant) {
    this.readyState = 0;
    this.state = mockState(variant);
    this.v = 1;
    setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 50);
  }

  stateMsg(mod) {
    return { type: 'state', module: mod, v: this.v, data: JSON.parse(JSON.stringify(this.state[mod])) };
  }

  send(raw) {
    const msg = JSON.parse(raw);
    const args = msg.args || {};
    const [mod, action] = msg.cmd.split('.');
    const sp = this.state.spotify;
    const reply = { type: 'reply', id: msg.id, ok: true, updates: [] };
    if (msg.cmd === 'hello') {
      reply.updates = Object.keys(this.state).map((m) => this.stateMsg(m));
    } else if (msg.cmd === 'windows.focus') {
      const exists = this.state.windows.apps.some((a) => a.windows.some((w) => w.id === args.id));
      if (exists) this.state.windows.focusedId = args.id;
      else Object.assign(reply, { ok: false, error: 'not_found' });
    } else if (mod === 'spotify' && sp.running) {
      if (action === 'playpause') sp.state = sp.state === 'playing' ? 'paused' : 'playing';
      else if (action === 'seek') sp.positionMs = args.ms;
      else if (action === 'volume') sp.volume = args.value;
      else if (action === 'shuffle') sp.shuffle = !sp.shuffle;
      else if (action === 'repeat') sp.repeat = !sp.repeat;
    }
    if (mod in this.state) {
      this.v += 1;
      reply.updates = [this.stateMsg(mod)];
    }
    setTimeout(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify(reply) }); }, 30);
  }

  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
}

/* ---------- App (browser only) ---------- */

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM9.5 12 18 18V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
};

const PING_MS = 2000;
const STALE_MS = 7000; // no message for this long => socket is dead (e.g. after tablet sleep)
const SHIFT_MS = 180000; // AMOLED burn-in: nudge the whole UI every 3 minutes
const SHIFTS = [[0, 0], [1, 1], [2, 0], [1, -1], [0, -2], [-1, -1], [-2, 0], [-1, 1]];

function boot() {
  const params = new URLSearchParams(location.search);
  const MOCK = params.has('mock');
  const $ = (id) => document.getElementById(id);
  const shell = $('shell');
  const winEl = $('windows');
  const spEl = $('spotify');
  const overlay = $('overlay');
  const dot = $('dot');

  const store = { windows: null, spotify: null, spotifyAt: 0 };
  const conn = { ws: null, attempt: 0, nextId: 1, pending: new Map(), lastRx: 0, versions: {} };
  let overlayTimer = null;

  /* ----- connection ----- */

  function connect() {
    const ws = MOCK ? new MockSocket(params.get('mock')) : new WebSocket('ws://' + location.host + '/ws');
    conn.ws = ws;
    ws.onopen = () => {
      conn.attempt = 0;
      conn.versions = {}; // the Mac may have restarted and reset its version counters
      conn.lastRx = Date.now();
      setConnected(true);
      send('hello', { ua: navigator.userAgent });
    };
    ws.onmessage = (ev) => {
      conn.lastRx = Date.now();
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handle(msg);
    };
    ws.onclose = () => reconnect(ws);
    ws.onerror = () => reconnect(ws);
  }

  function reconnect(ws) {
    if (conn.ws !== ws) return;
    conn.ws = null;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch (_) { /* already closed */ }
    setConnected(false);
    setTimeout(connect, backoff(conn.attempt++));
  }

  function setConnected(on) {
    dot.classList.toggle('on', on);
    clearTimeout(overlayTimer);
    if (on) overlay.hidden = true;
    else overlayTimer = setTimeout(() => { overlay.hidden = false; }, 2000);
  }

  function send(cmd, args) {
    const ws = conn.ws;
    if (!ws || ws.readyState !== 1) return Promise.resolve({ ok: false, error: 'offline' });
    const id = conn.nextId++;
    const msg = { id, cmd };
    if (args) msg.args = args;
    if (cmd === 'ping') msg.versions = conn.versions;
    ws.send(JSON.stringify(msg));
    return new Promise((resolve) => {
      conn.pending.set(id, resolve);
      setTimeout(() => { if (conn.pending.delete(id)) resolve({ ok: false, error: 'timeout' }); }, 4000);
    });
  }

  function handle(msg) {
    if (msg.type === 'state') {
      applyState(msg);
    } else if (msg.type === 'reply') {
      (msg.updates || []).forEach(applyState);
      const resolve = conn.pending.get(msg.id);
      if (resolve) {
        conn.pending.delete(msg.id);
        resolve(msg);
      }
    }
  }

  const renderers = { windows: renderWindows, spotify: renderSpotify };

  function applyState(msg) {
    conn.versions[msg.module] = msg.v;
    store[msg.module] = msg.data;
    if (msg.module === 'spotify') store.spotifyAt = Date.now();
    const render = renderers[msg.module];
    if (render) render();
  }

  setInterval(() => {
    const ws = conn.ws;
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - conn.lastRx > STALE_MS) { reconnect(ws); return; }
    send('ping');
  }, PING_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && conn.ws && conn.ws.readyState === 1) send('ping');
  });

  /* ----- windows ----- */

  function iconUrl(bundleId) {
    return MOCK ? mockIcon(bundleId) : 'icon/' + encodeURIComponent(bundleId) + '.png';
  }

  function tileHtml(app, win, focusedId) {
    const cls = ['tile'];
    if (win.id === focusedId) cls.push('focused');
    if (win.minimized) cls.push('minimized');
    if (app.hidden) cls.push('app-hidden');
    const badge = win.minimized ? 'Minimized' : win.otherSpace ? 'Other Space' : app.hidden ? 'Hidden' : '';
    return `<button class="${cls.join(' ')}" data-id="${win.id}">
        <img class="tile-icon" src="${esc(iconUrl(app.bundleId))}" alt="">
        <span class="tile-title">${esc(win.title)}</span>
        ${badge ? `<span class="badge">${badge}</span>` : ''}
      </button>`;
  }

  function renderWindows() {
    const w = store.windows;
    if (!w || !w.apps || !w.apps.length) {
      winEl.innerHTML = '<div class="empty">No windows</div>';
      return;
    }
    const scroll = winEl.scrollTop;
    winEl.innerHTML = w.apps.map((app) => `
      <section class="app-group">
        <header class="app-head"><img src="${esc(iconUrl(app.bundleId))}" alt="">${esc(app.name)}</header>
        <div class="tiles">${app.windows.map((win) => tileHtml(app, win, w.focusedId)).join('')}</div>
      </section>`).join('');
    winEl.scrollTop = scroll;
  }

  function shake(id) {
    const tile = winEl.querySelector(`.tile[data-id="${id}"]`);
    if (!tile) return;
    tile.classList.remove('shake');
    void tile.offsetWidth; // restart the animation
    tile.classList.add('shake');
  }

  winEl.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || !store.windows) return;
    const id = Number(tile.dataset.id);
    const previous = store.windows.focusedId;
    store.windows.focusedId = id; // optimistic
    renderWindows();
    send('windows.focus', { id }).then((r) => {
      if (r.ok) return;
      if (store.windows && store.windows.focusedId === id) {
        store.windows.focusedId = previous;
        renderWindows();
      }
      shake(id);
    });
  });

  /* ----- spotify ----- */

  spEl.innerHTML = `
    <div class="sp-full">
      <img class="art" id="sp-art" alt="">
      <div class="meta"><div class="title" id="sp-title"></div><div class="sub" id="sp-sub"></div></div>
      <div>
        <div class="progress" id="sp-progress"><div class="rail"></div><div class="fill" id="sp-fill"></div></div>
        <div class="times"><span id="sp-pos">0:00</span><span id="sp-dur">0:00</span></div>
      </div>
      <div class="transport">
        <button class="btn" data-cmd="previous" aria-label="Previous">${ICONS.prev}</button>
        <button class="btn play" data-cmd="playpause" id="sp-play" aria-label="Play/Pause">${ICONS.play}</button>
        <button class="btn" data-cmd="next" aria-label="Next">${ICONS.next}</button>
      </div>
      <div class="row">
        <button class="btn toggle" data-cmd="shuffle" id="sp-shuffle" aria-label="Shuffle">${ICONS.shuffle}</button>
        <input type="range" min="0" max="100" step="1" id="sp-vol" aria-label="Volume">
        <button class="btn toggle" data-cmd="repeat" id="sp-repeat" aria-label="Repeat">${ICONS.repeat}</button>
      </div>
    </div>
    <div class="sp-idle">
      <div class="idle-text">Nothing playing</div>
      <button class="btn play" data-cmd="playpause" aria-label="Play">${ICONS.play}</button>
    </div>`;

  const artEl = $('sp-art'), titleEl = $('sp-title'), subEl = $('sp-sub');
  const progEl = $('sp-progress'), fillEl = $('sp-fill'), posEl = $('sp-pos'), durEl = $('sp-dur');
  const playBtn = $('sp-play'), shuffleBtn = $('sp-shuffle'), repeatBtn = $('sp-repeat'), volEl = $('sp-vol');
  let volDragging = false;
  let volReleaseTimer = null;

  function renderSpotify() {
    const sp = store.spotify;
    const running = !!(sp && sp.running);
    shell.classList.toggle('no-spotify', !running);
    spEl.hidden = !running;
    if (!running) return;
    const hasTrack = sp.state !== 'stopped' && !!sp.track;
    spEl.classList.toggle('idle', !hasTrack);
    if (!hasTrack) return;

    const t = sp.track;
    if (t.artworkUrl) {
      if (artEl.getAttribute('src') !== t.artworkUrl) artEl.src = t.artworkUrl;
    } else {
      artEl.removeAttribute('src');
    }
    titleEl.textContent = t.name;
    subEl.textContent = [t.artist, t.album].filter(Boolean).join(' · ');
    durEl.textContent = formatTime(t.durationMs);
    playBtn.innerHTML = sp.state === 'playing' ? ICONS.pause : ICONS.play;
    shuffleBtn.classList.toggle('on', !!sp.shuffle);
    repeatBtn.classList.toggle('on', !!sp.repeat);
    if (!volDragging) volEl.value = sp.volume;
    tickProgress();
  }

  function tickProgress() {
    const sp = store.spotify;
    if (!sp || !sp.track) return;
    const pos = estimatePosition(sp, store.spotifyAt, Date.now());
    const dur = sp.track.durationMs;
    fillEl.style.width = (dur ? Math.min(100, (pos / dur) * 100) : 0) + '%';
    posEl.textContent = formatTime(pos);
  }
  setInterval(tickProgress, 500);

  spEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    const sp = store.spotify;
    if (!btn || !sp) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'playpause' && sp.track) { // optimistic
      sp.positionMs = estimatePosition(sp, store.spotifyAt, Date.now());
      store.spotifyAt = Date.now();
      sp.state = sp.state === 'playing' ? 'paused' : 'playing';
    } else if (cmd === 'shuffle') {
      sp.shuffle = !sp.shuffle;
    } else if (cmd === 'repeat') {
      sp.repeat = !sp.repeat;
    }
    renderSpotify();
    send('spotify.' + cmd);
  });

  progEl.addEventListener('pointerdown', (e) => {
    const sp = store.spotify;
    if (!sp || !sp.track || !sp.track.durationMs) return;
    const ms = Math.round(seekFraction(e.clientX, progEl.getBoundingClientRect()) * sp.track.durationMs);
    sp.positionMs = ms;
    store.spotifyAt = Date.now();
    tickProgress();
    send('spotify.seek', { ms });
  });

  const sendVolume = makeThrottle((value) => send('spotify.volume', { value }), 100);
  volEl.addEventListener('input', () => {
    volDragging = true;
    clearTimeout(volReleaseTimer);
    sendVolume(Number(volEl.value));
  });
  volEl.addEventListener('change', () => {
    const value = Number(volEl.value);
    if (store.spotify) store.spotify.volume = value;
    send('spotify.volume', { value });
    volReleaseTimer = setTimeout(() => { volDragging = false; }, 1000);
  });

  /* ----- burn-in protection ----- */

  let shiftIndex = 0;
  setInterval(() => {
    shiftIndex = (shiftIndex + 1) % SHIFTS.length;
    const [x, y] = SHIFTS[shiftIndex];
    shell.style.transform = `translate(${x}px, ${y}px)`;
  }, SHIFT_MS);

  console.log('tabletpanel UA:', navigator.userAgent);
  renderWindows();
  connect();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, formatTime, estimatePosition, seekFraction, backoff, makeThrottle, mockState };
}
if (typeof document !== 'undefined') boot();
```

- [ ] **Step 6: Run JS tests**

Run: `node --test tests/web.test.js`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 7: Visual check in mock mode**

Run: `python3 -m http.server 8000 -d tabletpanel/web` (background).
With Playwright (or desktop Chrome devtools device toolbar), take screenshots at 1024×768 of:
- `http://localhost:8000/?mock` — grid left ~2/3 with 4 app groups, Safari tile 11 outlined in blue, tile 13 dimmed with "Minimized", Code tile 22 "Other Space", Slack tile dimmed "Hidden" with title shown literally as `<b>&amp;</b> 😀` (escaped, not bold), long title clamped to 2 lines; Spotify panel right with grey art placeholder, "Midnight City", progress advancing, repeat green.
- `?mock=nospotify` — grid full width, no panel.
- `?mock=idle` — slim "Nothing playing" card at top of right column.
- `?mock` at 768×1024 (portrait) — Spotify compact strip on top, grid below.
Interact on `?mock`: tap a tile → outline moves instantly; tap play/pause → icon flips and progress stops; tap the progress bar → time jumps; drag volume; toggle shuffle. No console errors.
Stop the python server.

- [ ] **Step 8: Commit**

```bash
git add tabletpanel/web tests/web.test.js
git commit -m "feat: add tablet UI with live WebSocket client and mock mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end on desktop, netguard config, README

**Files:**
- Create: `README.md`
- Modify (outside repo): `~/.hammerspoon/init.lua` (router MAC)

- [ ] **Step 1: Desktop end-to-end**

Open `http://localhost:8765/` in desktop Chrome at 1024×768. Verify:
- Real windows and icons appear; opening/closing/minimizing windows updates within ~0.1 s.
- Clicking a tile focuses that window (including minimized and hidden-app windows).
- Spotify panel mirrors Spotify; controls work; quitting Spotify removes the panel and the grid goes full width; relaunching brings it back within ~2 s.
- Reconnect (Review Focus #3): `hs -c 'hs.reload()'` → "Reconnecting…" may flash; the page recovers by itself within ~5 s with correct state and keeps receiving updates (open a new window afterwards to confirm pushes still arrive).
- Also open the same URL in a second browser tab: both stay in sync (the non-push one within ≤ 2 s if Task 6 Step 11 showed last-client-only).

- [ ] **Step 2: Configure netguard with the real router MAC**

Run: `arp -n $(route -n get default | awk '/gateway/{print $2}')`
Copy the MAC into `~/.hammerspoon/init.lua`'s `homeRouterMACs = { "<mac>" }`, then `hs -c 'hs.reload()'`.
Expected console: `tabletpanel: home network (gateway … is …)` and `listening on port 8765`.
Negative check: temporarily set a wrong MAC (`"00:00:00:00:00:01"`), reload → `not on home network (…)` and `curl -s -o /dev/null -w '%{http_code}' localhost:8765/` fails to connect (`000`). Restore the right MAC and reload.

- [ ] **Step 3: Write `README.md`**

`README.md`:
````markdown
# Mac Panel for Galaxy Tab S2

A Hammerspoon module that turns a spare Android tablet into an instant window switcher and Spotify remote for your Mac. The Mac pushes changes over a WebSocket, so the tablet updates the moment a window opens, closes, gets focus, or a track changes.

## How it works

- `tabletpanel/` is a Hammerspoon module. It serves the tablet page (`tabletpanel/web/`) and a WebSocket at `ws://<mac>:8765/ws`.
- Window changes come from `hs.window.filter` events; Spotify changes from Spotify's `PlaybackStateChanged` notification (plus a 2 s check for volume/shuffle/repeat changed inside Spotify).
- The tablet sends a `ping` every 2 s; replies carry anything it missed, so even a client that doesn't receive pushes stays within 2 s.
- The server only runs when the Mac's default gateway has your home router's MAC address (no Location permission needed; works on Wi-Fi and Ethernet).
- No authentication: anyone on your home network can use the panel.

## Mac setup

1. **Install Hammerspoon**: `brew install --cask hammerspoon`, open it, and in its Preferences tick *Launch Hammerspoon at login*.
2. **Grant Accessibility**: System Settings → Privacy & Security → Accessibility → enable Hammerspoon. (Screen Recording is *not* needed.)
3. **Link the module** (from this repo's root):
   ```bash
   mkdir -p ~/.hammerspoon
   ln -s "$PWD/tabletpanel" ~/.hammerspoon/tabletpanel
   ```
4. **Find your router's MAC** while on your home network:
   ```bash
   arp -n $(route -n get default | awk '/gateway/{print $2}')
   ```
5. **Add to `~/.hammerspoon/init.lua`**:
   ```lua
   require("hs.ipc")
   if not hs.ipc.cliStatus("/opt/homebrew", true) then hs.ipc.cliInstall("/opt/homebrew") end

   tabletpanel = require("tabletpanel").start({
     homeRouterMACs = { "aa:bb:cc:dd:ee:ff" }, -- from step 4; {} = always on
   })
   ```
   Keep the global `tabletpanel =` assignment — it stops Lua from garbage-collecting the server.
6. **Reload** Hammerspoon (menu bar icon → Reload Config). The console should show `tabletpanel: listening on port 8765`.
7. **Spotify**: the first time it runs, macOS asks *"Hammerspoon wants to control Spotify"* — click **Allow**.
8. **Firewall**: if the macOS firewall is on, allow incoming connections for Hammerspoon when prompted (or in System Settings → Network → Firewall → Options).
9. **Give the Mac a fixed IP**: in your router's DHCP settings, reserve an address for the Mac (`ipconfig getifaddr en0` shows the current one; use `en1` etc. for other interfaces). The tablet URL is `http://<that-ip>:8765/`.

## Test on the Mac first

```bash
curl -s http://localhost:8765/api/state | jq             # full state
(printf '%s\n' '{"id":1,"cmd":"hello"}'; sleep 30) | websocat ws://localhost:8765/ws   # watch pushes live
open "http://localhost:8765/"                              # real UI in a desktop browser
open "http://localhost:8765/?mock"                         # UI with fake data, no Mac state
```

Unit tests: `lua tests/run.lua` and `node --test tests/web.test.js` (needs `brew install lua`).

## Tablet setup (Galaxy Tab S2, Android 7)

1. **Update the browser engine**: Play Store → *Android System WebView* (and *Chrome*) → Update. On Android 7 they top out around version 119, which this page targets. After connecting, the Hammerspoon console logs the tablet's user agent (`client hello: … Chrome/119…`) so you can confirm.
2. **Install Fully Kiosk Browser** from the Play Store.
3. In Fully's settings:
   - *Web Content Settings → Start URL*: `http://<mac-ip>:8765/`
   - *Web Auto Reload → Auto Reload on Network Reconnect*: on (belt and braces; the page also reconnects by itself)
   - *Device Management → Keep Screen On*: on; *Launch on Boot*: on
   - *Appearance*: hide status bar and navigation bar for full screen
   - *Device Management → Screen Orientation*: landscape
   - Optional (Fully PLUS licence): *Screensaver/Scheduled Sleep* to turn the screen off at night, and *Motion Detection* to wake on approach.
4. **AMOLED burn-in**: the page uses a pure black background and nudges itself 1–2 px every 3 minutes, but a scheduled screen-off overnight is still the best protection. Keep brightness moderate.
5. Keep the tablet on its charger; in Android *Settings → Battery*, exclude Fully Kiosk from battery optimisation.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tablet can't load the page | Mac and tablet on the same network? `curl http://<mac-ip>:8765/` from another machine; check the macOS firewall allows Hammerspoon; check the Hammerspoon console for `not on home network`. |
| Console says `not on home network` at home | Re-run the `arp` command from setup step 4 and compare with `homeRouterMACs` (format doesn't matter: `0:1e:a:…` and `00:1E:0A:…` both match). Mesh/extender networks may expose a different gateway MAC — add it to the list. |
| `homeRouterMACs is empty` warning | Expected until you configure step 5; the server is then always on. |
| "Reconnecting…" never clears | Hammerspoon running? Mac asleep? IP changed (set a DHCP reservation)? |
| Windows missing | Accessibility permission (toggle it off/on after Hammerspoon updates). Windows on other Spaces only appear once Hammerspoon has seen them. Untitled and non-standard windows (palettes, popups) are hidden by design. |
| Spotify panel missing or stale | Spotify must be running. Check System Settings → Privacy & Security → Automation → Hammerspoon → Spotify is on. Console warnings start with `tabletpanel: spotify:`. |
| Changes to the page don't show | The page is served with `no-store`; reload in Fully (swipe from left → Reload). Lua changes need a Hammerspoon reload. |
| Icons missing | `curl -o x.png http://localhost:8765/icon/com.apple.finder.png && file x.png` should say PNG. |

## Extending

Each feature is a module with `name`, `start(notify, log)`, `stop()`, `state()` and `actions`. Add a file in `tabletpanel/`, put it in `M.modules` in `tabletpanel/init.lua`, and add a renderer to `renderers` in `web/app.js`. Planned: window thumbnails (needs Screen Recording), clock/next calendar event, mic mute, system volume.
````

Fill in the Task 6 Step 11 finding by appending one sentence to the "How it works" ping bullet, e.g. "(Hammerspoon pushes only to the most recently connected client.)" or "(Hammerspoon pushes to all connected clients.)".

- [ ] **Step 4: Run all tests**

Run: `lua tests/run.lua && node --test tests/web.test.js`
Expected: both report 0 failures.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add setup, testing and troubleshooting README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: USER ACTION — tablet verification checklist**

Hand the user this checklist (they do it on the tablet, following the README "Tablet setup"):
1. Page loads full screen in landscape; console logs `client hello: …` with the Chrome version.
2. Tap a tile → that window comes to front on the Mac immediately.
3. Open/close a window on the Mac → tile appears/disappears instantly.
4. Skip a track in Spotify on the Mac → tablet updates instantly; tablet controls work; progress bar seek works.
5. Turn the tablet screen off for a minute and on again → "Reconnecting…" clears within ~5 s, state is current.
6. Reload Hammerspoon → tablet recovers by itself.
````
