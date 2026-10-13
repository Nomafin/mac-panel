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
