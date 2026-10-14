-- Buttons for whichever app is in front on the Mac (sets in tabletpanel/shortcuts.lua).
local Shortcuts = require('tabletpanel.shortcuts_model')
local config = require('tabletpanel.shortcuts')

local S = { name = 'shortcuts', actions = {} }

local watcher, notify

local function front()
  local app = hs.application.frontmostApplication()
  return app, app and app:bundleID()
end

function S.start(notifyFn)
  notify = notifyFn
  watcher = hs.application.watcher.new(function(_, event)
    if event == hs.application.watcher.activated then notify() end
  end):start()
end

function S.stop()
  if watcher then watcher:stop(); watcher = nil end
end

function S.state()
  local app, bid = front()
  local buttons = {}
  for _, b in ipairs(Shortcuts.buttons(config, bid)) do buttons[#buttons + 1] = { label = b.label } end
  return { bundleId = bid, name = app and app:name(), buttons = require('tabletpanel.json').array(buttons) }
end

-- args: { bundleId, index }. The bundle id guards against the front app changing in between.
function S.actions.run(args)
  local app, bid = front()
  if not bid or bid ~= args.bundleId then return false, 'front_app_changed' end
  local b = Shortcuts.buttons(config, bid)[tonumber(args.index)]
  if not b then return false, 'not_found' end
  hs.eventtap.keyStroke(b.mods, b.key, 0, app)
  return true
end

return S
