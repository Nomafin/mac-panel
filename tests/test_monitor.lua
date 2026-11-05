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
    timers = {}, notified = 0, logs = {}, tool = opts.tool == nil and '/opt/homebrew/bin/m1ddc' or opts.tool }
  local deps = {
    screenNames = function() return env.screens end,
    findTool = function() return env.tool or nil end,
    run = function(args, cb)
      env.runs[#env.runs + 1] = table.concat(args, ' ')
      env.pending[#env.pending + 1] = cb
    end,
    every = function(_, fn) env.tick = fn; return { stop = function() env.stopped = true end } end,
    after = function(seconds, fn) env.timers[#env.timers + 1] = { seconds = seconds, fn = fn } end,
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
  local mod = Monitor.new({ monitor = opts.config == nil and { name = 'Odyssey', inputs = INPUTS } or opts.config or nil }, deps)
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

  T.test('stop ends polling', function()
    local mod, env = setup()
    mod.stop()
    T.ok(env.stopped)
  end)
end
