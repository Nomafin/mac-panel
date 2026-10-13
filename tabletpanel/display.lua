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
