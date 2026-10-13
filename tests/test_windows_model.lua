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

  T.test('keeps minimized windows that AX reports as non-standard (Finder on macOS 26)', function()
    local m = Model.new()
    T.eq(ids(m:build({ win(1, 'a.A', 'Downloads', { minimized = true, standard = false }) })), { 1 })
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
