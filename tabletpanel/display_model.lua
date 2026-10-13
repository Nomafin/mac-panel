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
