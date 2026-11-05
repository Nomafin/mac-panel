-- The external monitor's input source, read and switched over DDC/CI with m1ddc
-- (brew install m1ddc). Configured in init.lua:
--   monitor = { name = 'Odyssey', inputs = { { label = 'Mac', code = 17 }, { label = 'PC', code = 18 } } }
-- name is matched against the screen names; codes are DDC input values (HDMI 1 = 17, HDMI 2 = 18,
-- DisplayPort 1 = 15, USB-C = 27; m1ddc help lists more).
local Monitor = {}

local POLL_SECONDS = 4
local READ_BACK_SECONDS = 2 -- a monitor takes a moment to report the input it switched to
local TIMEOUT_SECONDS = 10
local TOOL_PATHS = { '/opt/homebrew/bin/m1ddc', '/usr/local/bin/m1ddc' }

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

local function cleanInputs(list)
  local out = {}
  for _, i in ipairs(type(list) == 'table' and list or {}) do
    if type(i) == 'table' and type(i.label) == 'string' and math.tointeger(i.code) then
      out[#out + 1] = { label = i.label, code = math.tointeger(i.code) }
    end
  end
  return out
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
  every = function(seconds, fn) return hs.timer.doEvery(seconds, fn) end,
  after = function(seconds, fn) return hs.timer.doAfter(seconds, fn) end,
}

-- config: the panel's config table; deps: replaced in tests.
function Monitor.new(config, deps)
  deps = deps or defaultDeps
  local M = { name = 'monitor', actions = {} }
  local settings, inputs, timer, notify, log
  local tool, uuid, current
  local queue, busy = {}, false
  local warned = {}

  local function warnOnce(key, message)
    if warned[key] then return end
    warned[key] = true
    log.w(message)
  end

  -- One m1ddc at a time: DDC requests to the same monitor must not interleave.
  local function runNext()
    if busy or #queue == 0 then return end
    local job = table.remove(queue, 1)
    busy = true
    deps.run(job.args, function(code, out)
      busy = false
      job.cb(code, out)
      runNext()
    end, tool)
  end

  local function enqueue(args, cb)
    queue[#queue + 1] = { args = args, cb = cb }
    runNext()
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
    inputs = cleanInputs(settings.inputs)
    timer = deps.every(POLL_SECONDS, poll)
    poll()
  end

  function M.stop()
    if timer then timer:stop(); timer = nil end
    uuid, current, queue = nil, nil, {}
  end

  function M.state()
    if not uuid then return { available = false } end
    return { available = true, current = current, inputs = inputs }
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
    return true
  end

  return M
end

return Monitor
