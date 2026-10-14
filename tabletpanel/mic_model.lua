-- Muting the Mac's microphone. Pure: the device is passed in as functions.
-- dev: { muted() -> bool|nil, setMuted(bool) -> bool, volume() -> number|nil, setVolume(number) -> bool }
local Mic = {}
Mic.__index = Mic

local FALLBACK_VOLUME = 75

function Mic.new()
  return setmetatable({ savedVolume = nil }, Mic)
end

function Mic:isMuted(dev)
  if dev.muted() then return true end
  return dev.volume() == 0
end

-- Uses the mic's own mute; a mic without one is muted by turning its input volume to 0.
function Mic:setMuted(dev, on)
  if dev.setMuted(on) then
    if not on and dev.volume() == 0 then dev.setVolume(self.savedVolume or FALLBACK_VOLUME) end
    return true
  end
  if on then
    local volume = dev.volume()
    if volume and volume > 0 then self.savedVolume = volume end
    return dev.setVolume(0)
  end
  local ok = dev.setVolume(self.savedVolume or FALLBACK_VOLUME)
  self.savedVolume = nil
  return ok
end

return Mic
