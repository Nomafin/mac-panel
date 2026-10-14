-- The Mac's CPU, memory and battery for the status line. Pure.
local System = {}

local function round(x) return math.floor(x + 0.5) end

-- prev/cur: hs.host.cpuUsageTicks().overall samples.
function System.cpuPercent(prev, cur)
  if not prev or not cur then return nil end
  local active, idle = cur.active - prev.active, cur.idle - prev.idle
  if active + idle <= 0 then return nil end
  return round(active * 100 / (active + idle))
end

-- "Memory used" as Activity Monitor counts it: app memory + wired + compressed. vm: hs.host.vmStat().
function System.memoryPercent(vm)
  if not vm.memSize or vm.memSize <= 0 or not vm.pageSize then return nil end
  local pages = (vm.anonymousPages or 0) - (vm.pagesPurgeable or 0)
    + (vm.pagesWiredDown or 0) + (vm.pagesUsedByVMCompressor or 0)
  return math.max(0, math.min(100, round(pages * vm.pageSize * 100 / vm.memSize)))
end

function System.battery(percentage, powerSource, charging)
  if not percentage then return nil end
  return { level = round(percentage), onPower = powerSource == 'AC Power', charging = charging == true }
end

return System
