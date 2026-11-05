local Monitor = require('tabletpanel.monitor')

local LIST = [[
[1] Unknown Display (37D8832A-2D66-02CA-B9F7-8F30A301B230)
[2] Odyssey G95NC (A9A90B46-65C5-4FB8-90F7-804AFAB30122)
]]
local UUID = 'A9A90B46-65C5-4FB8-90F7-804AFAB30122'
local INPUTS = { { label = 'Mac', code = 17 }, { label = 'PC', code = 18 } }

-- A monitor module with a fake m1ddc: runs wait in env.pending until env.finish answers them.
local function setup(opts)
  opts = opts or {}
  local env = { screens = opts.screens or { 'Built-in Retina Display', 'Odyssey G95NC' }, runs = {}, pending = {},
    timers = {}, notified = 0, logs = {}, logi = {}, posts = {}, key = 'secret', tool = opts.tool == nil and '/opt/homebrew/bin/m1ddc' or opts.tool }
  local deps = {
    screenNames = function() return env.screens end,
    findTool = function() return env.tool or nil end,
    run = function(args, cb)
      env.runs[#env.runs + 1] = table.concat(args, ' ')
      env.pending[#env.pending + 1] = cb
    end,
    every = function(_, fn) env.tick = fn; return { stop = function() env.stopped = true end } end,
    after = function(seconds, fn) env.timers[#env.timers + 1] = { seconds = seconds, fn = fn } end,
    runLogi = function(args, cb)
      env.logi[#env.logi + 1] = table.concat(args, ' ')
      env.pending[#env.pending + 1] = cb
    end,
    agentKey = function(cb) cb(env.key) end,
    postAgent = function(channels, key, cb)
      env.posts[#env.posts + 1] = { channels = channels, key = key }
      env.agentCb = cb
    end,
  }
  -- Answer the oldest waiting command.
  function env.finish(code, out)
    local cb = table.remove(env.pending, 1)
    assert(cb, 'no command waiting')
    cb(code, out)
  end
  function env.fireTimers()
    local t = env.timers
    env.timers = {}
    for _, h in ipairs(t) do h.fn() end
  end
  local config = opts.config
  if config == nil then config = { name = 'Odyssey', inputs = INPUTS } end
  local mod = Monitor.new({ monitor = config or nil, pc = opts.pc == nil and { address = '192.168.1.58', port = 8766 } or opts.pc or nil }, deps)
  local logger = function(m) env.logs[#env.logs + 1] = m end
  mod.start(function() env.notified = env.notified + 1 end, { i = logger, w = logger, e = logger })
  return mod, env
end

-- Connected and read: the list, then the input.
local function connect(mod, env, input)
  env.tick()
  env.finish(0, LIST)
  env.finish(0, (input or 17) .. '\n')
end

local DEVICE_INPUTS = {
  { label = 'Mac', code = 17, devices = { mouse = 2, keyboard = 1 } },
  { label = 'PC', code = 18, devices = { mouse = 1, keyboard = 2 } },
}

-- Connected, with device channels configured; then a tap on `code` with the monitor switched.
local function tap(code, opts)
  local mod, env = setup({ config = { name = 'Odyssey', inputs = DEVICE_INPUTS }, pc = opts and opts.pc })
  if opts and opts.key == false then env.key = nil end
  connect(mod, env)
  mod.actions.set({ code = code })
  env.finish(0, '') -- the monitor's set input
  return mod, env
end

return function(T)
  T.test('parseDisplayList finds the display by name and gives its UUID', function()
    T.eq(Monitor.parseDisplayList(LIST, 'Odyssey'), UUID)
    T.eq(Monitor.parseDisplayList(LIST, 'Dell'), nil)
    T.eq(Monitor.parseDisplayList('', 'Odyssey'), nil)
  end)

  T.test('parseInput reads the number m1ddc prints', function()
    T.eq(Monitor.parseInput('17\n'), 17)
    T.eq(Monitor.parseInput('Could not find a suitable external display.'), nil)
    T.eq(Monitor.parseInput(nil), nil)
  end)

  T.test('reads the current input once the monitor is found', function()
    local mod, env = setup()
    T.eq(mod.state(), { available = false })
    connect(mod, env, 17)
    T.eq(env.runs, { 'display list', 'display ' .. UUID .. ' get input' })
    T.eq(mod.state(), { available = true, current = 17, inputs = INPUTS })
    T.ok(env.notified > 0)
  end)

  T.test('later polls skip the display list', function()
    local mod, env = setup()
    connect(mod, env)
    env.tick()
    env.finish(0, '18\n')
    T.eq(env.runs[3], 'display ' .. UUID .. ' get input')
    T.eq(mod.state().current, 18)
  end)

  T.test('no matching screen: nothing runs and the switch is hidden', function()
    local mod, env = setup({ screens = { 'Built-in Retina Display' } })
    env.tick()
    T.eq(#env.runs, 0)
    T.eq(mod.state(), { available = false })
  end)

  T.test('a monitor that is unplugged is forgotten, and listed again when it comes back', function()
    local mod, env = setup()
    connect(mod, env)
    env.screens = { 'Built-in Retina Display' }
    env.tick()
    T.eq(mod.state(), { available = false })
    env.screens = { 'Odyssey G95NC' }
    env.tick()
    T.eq(env.runs[#env.runs], 'display list')
  end)

  T.test('without m1ddc or without a configured monitor the module stays off', function()
    local mod, env = setup({ tool = false })
    env.tick()
    T.eq(#env.runs, 0)
    T.eq(mod.state(), { available = false })
    T.ok(#env.logs > 0)
    local off, offEnv = setup({ config = false })
    T.eq(offEnv.tick, nil)
    T.eq(off.state(), { available = false })
  end)

  T.test('commands never overlap: a poll while one runs is skipped', function()
    local mod, env = setup()
    env.tick()
    env.tick()
    T.eq(#env.runs, 1)
    env.finish(0, LIST)
    env.finish(0, '17\n')
    T.eq(mod.state().current, 17)
  end)

  T.test('a failed read keeps the switch but shows no input as current', function()
    local mod, env = setup()
    connect(mod, env)
    env.tick()
    env.finish(1, '')
    T.eq(mod.state(), { available = true, inputs = INPUTS })
  end)

  T.test('set switches the input and reads it back', function()
    local mod, env = setup()
    connect(mod, env, 17)
    T.eq({ mod.actions.set({ code = 18 }) }, { true })
    T.eq(env.runs[#env.runs], 'display ' .. UUID .. ' set input 18')
    env.finish(0, '')
    env.fireTimers()
    T.eq(env.runs[#env.runs], 'display ' .. UUID .. ' get input')
    env.finish(0, '18\n')
    T.eq(mod.state().current, 18)
  end)

  T.test('set waits for a running command instead of overlapping it', function()
    local mod, env = setup()
    connect(mod, env)
    env.tick() -- a poll is running
    T.eq({ mod.actions.set({ code = 18 }) }, { true })
    T.eq(#env.runs, 3)
    env.finish(0, '17\n')
    T.eq(env.runs[4], 'display ' .. UUID .. ' set input 18')
  end)

  T.test('set refuses inputs that are not configured, and works only with the monitor found', function()
    local mod, env = setup()
    T.eq({ mod.actions.set({ code = 18 }) }, { false, 'no_monitor' })
    connect(mod, env)
    T.eq({ mod.actions.set({ code = 27 }) }, { false, 'unknown_input' })
    T.eq({ mod.actions.set({ code = '18; rm -rf' }) }, { false, 'unknown_input' })
  end)

  T.test('devices follow the monitor: local first, then the agent for what is not here', function()
    local mod, env = tap(17)
    T.eq(env.logi, { 'set-host keyboard=1 mouse=2' })
    env.finish(0, '{"keyboard": "not_here", "mouse": "not_here"}')
    T.eq(env.posts, { { channels = { keyboard = 1, mouse = 2 }, key = 'secret' } })
    env.agentCb(200, '{"result": {"keyboard": "sent", "mouse": "sent"}}')
    T.eq(mod.state().switch, { seq = 1, ok = true })
  end)

  T.test('only what the Mac could not send goes to the agent', function()
    local mod, env = tap(17)
    env.finish(0, '{"keyboard": "already", "mouse": "not_here"}')
    T.eq(env.posts[1].channels, { mouse = 2 })
    env.agentCb(200, '{"result": {"mouse": "sent"}}')
    T.eq(mod.state().switch.ok, true)
  end)

  T.test('the agent is skipped when every device was handled on the Mac', function()
    local mod, env = tap(18)
    T.eq(env.logi, { 'set-host keyboard=2 mouse=1' })
    env.finish(0, '{"keyboard": "sent", "mouse": "sent"}')
    T.eq(#env.posts, 0)
    T.eq(mod.state().switch, { seq = 1, ok = true })
  end)

  T.test('agent down: the note names the buttons, the monitor still switched', function()
    local mod, env = tap(17)
    T.eq(env.runs[#env.runs], 'display ' .. UUID .. ' set input 17')
    env.finish(0, '{"keyboard": "not_here", "mouse": "not_here"}')
    env.agentCb(0, '')
    T.eq(mod.state().switch, { seq = 1, ok = false, note = 'Keyboard and mouse: press 1 and 2' })
  end)

  T.test('a device the agent does not find either is named alone', function()
    local mod, env = tap(17)
    env.finish(0, '{"keyboard": "already", "mouse": "not_here"}')
    env.agentCb(200, '{"result": {"mouse": "not_here"}}')
    T.eq(mod.state().switch.note, 'Mouse: press 2')
    local mod2, env2 = tap(17)
    env2.finish(0, '{"keyboard": "not_here", "mouse": "sent"}')
    env2.agentCb(403, '{"error": "forbidden"}')
    T.eq(mod2.state().switch.note, 'Keyboard: press 1')
  end)

  T.test('no key: the note says so and nothing is posted', function()
    local mod, env = tap(17, { key = false })
    env.finish(0, '{"keyboard": "not_here", "mouse": "not_here"}')
    T.eq(#env.posts, 0)
    T.eq(mod.state().switch, { seq = 1, ok = false, note = 'Keyboard and mouse: no PC agent key in the Keychain' })
  end)

  T.test('no PC configured: the devices not on the Mac are a note', function()
    local mod, env = tap(17, { pc = false })
    env.finish(0, '{"keyboard": "not_here", "mouse": "not_here"}')
    T.eq(#env.posts, 0)
    T.eq(mod.state().switch.note, 'Keyboard and mouse: press 1 and 2')
  end)

  T.test('a failed or garbled local run counts every device as not here', function()
    local mod, env = tap(17)
    env.finish(1, 'Traceback …')
    T.eq(env.posts[1].channels, { keyboard = 1, mouse = 2 })
  end)

  T.test('an input without devices only switches the monitor', function()
    local mod, env = setup()
    connect(mod, env)
    mod.actions.set({ code = 18 })
    env.finish(0, '')
    T.eq(#env.logi, 0)
    T.eq(mod.state().switch, nil)
  end)

  T.test('two taps: each result is reported, the second with the next seq', function()
    local mod, env = tap(18)
    mod.actions.set({ code = 17 })
    env.finish(0, '{"keyboard": "sent", "mouse": "sent"}') -- first tap's devices
    T.eq(mod.state().switch, { seq = 1, ok = true })
    env.finish(0, '') -- second tap's monitor
    env.finish(0, '{"keyboard": "not_here", "mouse": "not_here"}')
    env.agentCb(200, '{"result": {"keyboard": "sent", "mouse": "sent"}}')
    T.eq(mod.state().switch, { seq = 2, ok = true })
  end)

  T.test('device channels stay out of the state the page gets', function()
    local mod, env = setup({ config = { name = 'Odyssey', inputs = DEVICE_INPUTS } })
    connect(mod, env)
    T.eq(mod.state().inputs, INPUTS)
  end)

  T.test('stop ends polling', function()
    local mod, env = setup()
    mod.stop()
    T.ok(env.stopped)
  end)
end
