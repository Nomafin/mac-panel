-- The external monitor's input source, read and switched over DDC/CI with m1ddc
-- (brew install m1ddc). Configured in init.lua:
--   monitor = { name = 'Odyssey', inputs = { { label = 'Mac', code = 17 }, { label = 'PC', code = 18 } } }
-- name is matched against the screen names; codes are DDC input values (HDMI 1 = 17, HDMI 2 = 18,
-- DisplayPort 1 = 15, USB-C = 27; m1ddc help lists more).
--
-- An input can also move Logitech Easy-Switch devices, e.g. devices = { keyboard = 1, mouse = 2 }:
-- the Mac sends those it reaches with hidpp/logi.py, and asks the PC agent (pc-agent/, config
-- pc = { address, port }) for the others. The agent's key is in the Keychain: mac-panel.pc-agent.
local json = require('tabletpanel.json')

local Monitor = {}

local POLL_SECONDS = 4
local READ_BACK_SECONDS = 2 -- a monitor takes a moment to report the input it switched to
local TIMEOUT_SECONDS = 10
local AGENT_TIMEOUT_SECONDS = 3
local TOOL_PATHS = { '/opt/homebrew/bin/m1ddc', '/usr/local/bin/m1ddc' }
local KEYCHAIN_SERVICE = 'mac-panel.pc-agent'
local VENV_PYTHON = os.getenv('HOME') .. '/.local/share/mac-panel/venv/bin/python'
local SOURCE = debug.getinfo(1, 'S').source:match('^@(.*)$')
local KINDS = { 'keyboard', 'mouse' } -- in the order notes name them

-- `m1ddc display list` lines look like "[2] Odyssey G95NC (A9A90B46-…)".
function Monitor.parseDisplayList(out, name)
  for line in (out or ''):gmatch('[^\n]+') do
    local display, uuid = line:match('^%[%d+%]%s+(.-)%s+%(([%x%-]+)%)%s*$')
    if display and display:find(name, 1, true) then return uuid end
  end
  return nil
end

function Monitor.parseInput(out)
  return math.tointeger(tonumber((out or ''):match('^%s*(%d+)%s*$')))
end

local function cleanDevices(t)
  if type(t) ~= 'table' then return nil end
  local out, any = {}, false
  for _, kind in ipairs(KINDS) do
    local ch = math.tointeger(t[kind])
    if ch and ch >= 1 and ch <= 3 then out[kind], any = ch, true end
  end
  return any and out or nil
end

-- The inputs for the page ({ label, code }), and each input's device channels by code.
local function cleanInputs(list)
  local out, devices = {}, {}
  for _, i in ipairs(type(list) == 'table' and list or {}) do
    if type(i) == 'table' and type(i.label) == 'string' and math.tointeger(i.code) then
      local code = math.tointeger(i.code)
      out[#out + 1] = { label = i.label, code = code }
      devices[code] = cleanDevices(i.devices)
    end
  end
  return out, devices
end

-- "Keyboard and mouse: press 1 and 2" for the kinds that didn't follow, with their channels.
function Monitor.note(kinds, channels, reason)
  local names, presses = {}, {}
  for _, kind in ipairs(KINDS) do
    if kinds[kind] then
      names[#names + 1] = kind
      presses[#presses + 1] = tostring(channels[kind])
    end
  end
  local who = table.concat(names, ' and ')
  who = who:sub(1, 1):upper() .. who:sub(2)
  return who .. ': ' .. (reason or ('press ' .. table.concat(presses, ' and ')))
end

local function decodeObject(s)
  local ok, v = pcall(json.decode, s or '')
  return ok and type(v) == 'table' and v or nil
end

local function once(fn)
  local done = false
  return function(...)
    if done then return end
    done = true
    fn(...)
  end
end

local defaultDeps = {
  screenNames = function()
    local names = {}
    for _, s in ipairs(hs.screen.allScreens()) do names[#names + 1] = s:name() or '' end
    return names
  end,
  findTool = function()
    for _, p in ipairs(TOOL_PATHS) do
      if hs.fs.attributes(p) then return p end
    end
  end,
  runLogi = function(args, cb)
    local timer
    local task = hs.task.new(VENV_PYTHON, function(code, out)
      if timer then timer:stop() end
      cb(code, out)
    end, { '-m', 'hidpp.logi', table.unpack(args) })
    -- The repo folder, for `-m hidpp.logi`. ~/.hammerspoon/tabletpanel is usually a symlink to it.
    local real = hs.fs.pathToAbsolute(SOURCE) or SOURCE
    task:setWorkingDirectory(real:match('^(.*/)tabletpanel/') or './')
    if not task:start() then return cb(-1, '') end
    timer = hs.timer.doAfter(15, function()
      if task:isRunning() then task:terminate() end
    end)
  end,
  agentKey = function(cb)
    local task = hs.task.new('/usr/bin/security', function(code, out)
      cb(code == 0 and out:gsub('%s+$', '') ~= '' and (out:gsub('%s+$', '')) or nil)
    end, { 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w' })
    if not task:start() then cb(nil) end
  end,
  run = function(args, cb, tool)
    local timer
    local task = hs.task.new(tool, function(code, out)
      if timer then timer:stop() end
      cb(code, out)
    end, args)
    if not task:start() then return cb(-1, '') end
    timer = hs.timer.doAfter(TIMEOUT_SECONDS, function()
      if task:isRunning() then task:terminate() end
    end)
  end,
  postAgent = function(channels, key, cb, url)
    local reply = once(cb)
    local timer -- referenced from the callback below, so it isn't garbage-collected before it fires
    hs.http.asyncPost(url, json.encode({ channels = channels }),
      { Authorization = 'Bearer ' .. key, ['Content-Type'] = 'application/json' },
      function(status, body)
        if timer then timer:stop() end
        reply(status, body)
      end)
    timer = hs.timer.doAfter(AGENT_TIMEOUT_SECONDS, function() reply(0, '') end) -- the PC is off or asleep
  end,
  every = function(seconds, fn) return hs.timer.doEvery(seconds, fn) end,
  after = function(seconds, fn) return hs.timer.doAfter(seconds, fn) end,
}

-- config: the panel's config table; deps: replaced in tests.
function Monitor.new(config, deps)
  deps = deps or defaultDeps
  local M = { name = 'monitor', actions = {} }
  local settings, inputs, devicesFor, timer, notify, log
  local tool, uuid, current
  local switch, switchSeq = nil, 0
  local queue, busy = {}, false
  local warned = {}

  local function warnOnce(key, message)
    if warned[key] then return end
    warned[key] = true
    log.w(message)
  end

  -- One command at a time: DDC requests to the same monitor must not interleave, and a tap's
  -- device switch waits for its monitor switch. A job is function(done).
  local function runNext()
    if busy or #queue == 0 then return end
    local job = table.remove(queue, 1)
    busy = true
    job(function()
      busy = false
      runNext()
    end)
  end

  local function enqueueJob(job)
    queue[#queue + 1] = job
    runNext()
  end

  local function enqueue(args, cb)
    enqueueJob(function(done)
      deps.run(args, function(code, out)
        cb(code, out)
        done()
      end, tool)
    end)
  end

  local function report(ok, note)
    switchSeq = switchSeq + 1
    switch = { seq = switchSeq, ok = ok, note = note }
    notify()
  end

  -- Ask the PC agent for the devices the Mac couldn't send.
  local function viaAgent(missing, channels)
    local pc = config.pc
    if type(pc) ~= 'table' or type(pc.address) ~= 'string' then return report(false, Monitor.note(missing, channels)) end
    deps.agentKey(function(key)
      if not key then return report(false, Monitor.note(missing, channels, 'no PC agent key in the Keychain')) end
      local wanted = {}
      for kind in pairs(missing) do wanted[kind] = channels[kind] end
      local url = string.format('http://%s:%d/devices/host', pc.address, math.tointeger(pc.port) or 8766)
      deps.postAgent(wanted, key, function(status, body)
        log.i('monitor: PC agent answered ' .. tostring(status) .. ' ' .. tostring(body))
        local result = status == 200 and (decodeObject(body) or {}).result or {}
        local still = {}
        local any = false
        for kind in pairs(missing) do
          if result[kind] ~= 'sent' and result[kind] ~= 'already' then still[kind], any = true, true end
        end
        if any then
          log.w('monitor: devices not switched (agent status ' .. tostring(status) .. ')')
          return report(false, Monitor.note(still, channels))
        end
        report(true)
      end, url)
    end)
  end

  -- Send the devices to an input's channels: locally first, then the agent for the rest.
  local function switchDevices(channels)
    enqueueJob(function(done)
      local args = { 'set-host' }
      for _, kind in ipairs(KINDS) do
        if channels[kind] then args[#args + 1] = kind .. '=' .. channels[kind] end
      end
      deps.runLogi(args, function(code, out)
        log.i('monitor: logi ' .. table.concat(args, ' ') .. ' -> ' .. tostring(code) .. ' ' .. tostring(out))
        local result = code == 0 and decodeObject(out) or {}
        local missing, any = {}, false
        for kind in pairs(channels) do
          if result[kind] ~= 'sent' and result[kind] ~= 'already' then missing[kind], any = true, true end
        end
        if any then viaAgent(missing, channels) else report(true) end
        done()
      end)
    end)
  end

  local function readInput()
    if not uuid then return end
    enqueue({ 'display', uuid, 'get', 'input' }, function(code, out)
      current = code == 0 and Monitor.parseInput(out) or nil
      notify()
    end)
  end

  local function screenPresent()
    for _, n in ipairs(deps.screenNames()) do
      if n:find(settings.name, 1, true) then return true end
    end
    return false
  end

  local function poll()
    if not screenPresent() then
      if uuid then uuid, current = nil, nil; notify() end
      return
    end
    tool = deps.findTool()
    if not tool then return warnOnce('tool', 'monitor: m1ddc not found (brew install m1ddc)') end
    if busy or #queue > 0 then return end
    if uuid then return readInput() end
    enqueue({ 'display', 'list' }, function(code, out)
      uuid = code == 0 and Monitor.parseDisplayList(out, settings.name) or nil
      if uuid then readInput() else warnOnce('list', 'monitor: m1ddc lists no display named ' .. settings.name) end
    end)
  end

  function M.start(notifyFn, logger)
    notify, log = notifyFn, logger
    settings = config.monitor
    if type(settings) ~= 'table' or type(settings.name) ~= 'string' then settings = nil; return end
    inputs, devicesFor = cleanInputs(settings.inputs)
    timer = deps.every(POLL_SECONDS, poll)
    poll()
  end

  function M.stop()
    if timer then timer:stop(); timer = nil end
    uuid, current, queue = nil, nil, {}
  end

  function M.state()
    if not uuid then return { available = false } end
    return { available = true, current = current, inputs = inputs, switch = switch }
  end

  function M.actions.set(args)
    if not uuid then return false, 'no_monitor' end
    local code
    for _, i in ipairs(inputs) do
      if i.code == args.code then code = i.code end
    end
    if not code then return false, 'unknown_input' end
    enqueue({ 'display', uuid, 'set', 'input', tostring(code) }, function(exit)
      if exit ~= 0 then log.w('monitor: switching to input ' .. code .. ' failed') end
      deps.after(READ_BACK_SECONDS, readInput)
    end)
    if devicesFor[code] then switchDevices(devicesFor[code]) end
    return true
  end

  return M
end

return Monitor
