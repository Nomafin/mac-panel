-- The Mac's microphone: whether an app is using it (a call), and muting it from the tablet.
local Mic = require('tabletpanel.mic_model')

local M = { name = 'mic', actions = {} }

local POLL_SECONDS = 1

local model, timer, notify

-- hs.audiodevice as the plain functions mic_model expects.
local function adapter(dev)
  return {
    muted = function() return dev:inputMuted() end,
    setMuted = function(on) return dev:setInputMuted(on) == true end,
    volume = function() return dev:inputVolume() end,
    setVolume = function(v) return dev:setInputVolume(v) == true end,
  }
end

function M.start(notifyFn)
  notify = notifyFn
  model = Mic.new()
  -- Polling is simpler than per-device watchers, which must be re-attached when the default mic changes.
  timer = hs.timer.doEvery(POLL_SECONDS, function() notify() end)
end

function M.stop()
  if timer then timer:stop(); timer = nil end
end

function M.state()
  local dev = hs.audiodevice.defaultInputDevice()
  if not dev or not model then return { available = false, inUse = false, muted = false } end
  return { available = true, name = dev:name(), inUse = dev:inUse() == true, muted = model:isMuted(adapter(dev)) }
end

function M.actions.set(args)
  local dev = hs.audiodevice.defaultInputDevice()
  if not dev then return false, 'no_microphone' end
  if not model:setMuted(adapter(dev), args.muted == true) then return false, 'mute_failed' end
  return true
end

return M
