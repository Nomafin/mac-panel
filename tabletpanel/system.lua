-- The Mac's CPU, memory and battery for the status line on the tablet.
local System = require('tabletpanel.system_model')

local S = { name = 'system', actions = {} }

local POLL_SECONDS = 5

local timer, prevTicks, cpu, notify

local function sample()
  local ticks = hs.host.cpuUsageTicks().overall
  cpu = System.cpuPercent(prevTicks, ticks) or cpu
  prevTicks = ticks
end

function S.start(notifyFn)
  notify = notifyFn
  sample()
  timer = hs.timer.doEvery(POLL_SECONDS, function()
    sample()
    notify()
  end)
end

function S.stop()
  if timer then timer:stop(); timer = nil end
  prevTicks, cpu = nil, nil
end

function S.state()
  return {
    cpu = cpu,
    memory = System.memoryPercent(hs.host.vmStat()),
    battery = System.battery(hs.battery.percentage(), hs.battery.powerSource(), hs.battery.isCharging()),
  }
end

return S
