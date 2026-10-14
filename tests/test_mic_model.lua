local Mic = require('tabletpanel.mic_model')

-- A fake input device; `hardwareMute = false` models a mic without a mute control.
local function device(opts)
  local d = { mutedFlag = false, vol = opts.volume or 80, hardwareMute = opts.hardwareMute ~= false }
  return {
    muted = function() if d.hardwareMute then return d.mutedFlag end return nil end,
    setMuted = function(on) if not d.hardwareMute then return false end d.mutedFlag = on return true end,
    volume = function() return d.vol end,
    setVolume = function(v) d.vol = v return true end,
    raw = d,
  }
end

return function(T)
  T.test('uses the hardware mute when the mic has one', function()
    local m, dev = Mic.new(), device({})
    T.eq(m:setMuted(dev, true), true)
    T.eq(m:isMuted(dev), true)
    T.eq(dev.raw.vol, 80)
    m:setMuted(dev, false)
    T.eq(m:isMuted(dev), false)
  end)

  T.test('falls back to input volume 0 and restores the old volume', function()
    local m, dev = Mic.new(), device({ hardwareMute = false, volume = 64 })
    T.eq(m:setMuted(dev, true), true)
    T.eq(dev.raw.vol, 0)
    T.eq(m:isMuted(dev), true)
    T.eq(m:setMuted(dev, false), true)
    T.eq(dev.raw.vol, 64)
    T.eq(m:isMuted(dev), false)
  end)

  T.test('unmuting a mic someone turned all the way down picks a usable volume', function()
    local m, dev = Mic.new(), device({ hardwareMute = false, volume = 0 })
    T.eq(m:isMuted(dev), true)
    m:setMuted(dev, false)
    T.ok(dev.raw.vol > 0, 'volume ' .. dev.raw.vol)
  end)
end
