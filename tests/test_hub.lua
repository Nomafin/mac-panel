local Hub = require('tabletpanel.hub')
local json = require('tabletpanel.json')

local function setup()
  local sent, logs = {}, {}
  local hub = Hub.new({
    send = function(s) sent[#sent + 1] = json.decode(s) end,
    log = function(m) logs[#logs + 1] = m end,
  })
  local mod = { name = 'counter', value = 1, actions = {} }
  mod.state = function() return { value = mod.value } end
  mod.actions.set = function(args)
    if args.value == nil then return false, 'bad_args' end
    mod.value = args.value
    return true
  end
  mod.actions.boom = function() error('kaboom') end
  hub:register(mod)
  return hub, mod, sent, logs
end

local function call(hub, msg)
  return json.decode(hub:handleMessage(json.encode(msg)))
end

local function stateMsg(v, value)
  return { type = 'state', module = 'counter', v = v, data = { value = value } }
end

return function(T)
  T.test('notify pushes state with version 1 the first time', function()
    local hub, _, sent = setup()
    hub:notify('counter')
    T.eq(sent, { stateMsg(1, 1) })
  end)

  T.test('notify does not push when state is unchanged', function()
    local hub, _, sent = setup()
    hub:notify('counter'); hub:notify('counter')
    T.eq(#sent, 1)
  end)

  T.test('notify pushes again with bumped version after a change', function()
    local hub, mod, sent = setup()
    hub:notify('counter')
    mod.value = 2
    hub:notify('counter')
    T.eq(sent[2], stateMsg(2, 2))
  end)

  T.test('hello replies with every module as updates and logs the user agent', function()
    local hub, _, _, logs = setup()
    T.eq(call(hub, { id = 1, cmd = 'hello', args = { ua = 'TestAgent/1' } }),
      { type = 'reply', id = 1, ok = true, updates = { stateMsg(1, 1) } })
    T.ok(table.concat(logs, '\n'):find('TestAgent/1', 1, true), 'user agent logged')
  end)

  T.test('ping with current versions returns an empty updates array', function()
    local hub = setup()
    call(hub, { id = 1, cmd = 'hello' })
    local raw = hub:handleMessage(json.encode({ id = 2, cmd = 'ping', versions = { counter = 1 } }))
    T.ok(raw:find('"updates":[]', 1, true), 'updates encoded as empty array: ' .. raw)
  end)

  T.test('ping with a stale version returns that module', function()
    local hub, mod = setup()
    call(hub, { id = 1, cmd = 'hello' })
    mod.value = 5
    hub:notify('counter')
    T.eq(call(hub, { id = 2, cmd = 'ping', versions = { counter = 1 } }).updates, { stateMsg(2, 5) })
  end)

  T.test('ping with a version from before a reload (higher number) still returns state', function()
    local hub = setup()
    T.eq(call(hub, { id = 3, cmd = 'ping', versions = { counter = 99 } }).updates, { stateMsg(1, 1) })
  end)

  T.test('successful action replies ok with fresh state and pushes it', function()
    local hub, _, sent = setup()
    call(hub, { id = 1, cmd = 'hello' })
    T.eq(call(hub, { id = 2, cmd = 'counter.set', args = { value = 9 } }),
      { type = 'reply', id = 2, ok = true, updates = { stateMsg(2, 9) } })
    T.eq(sent[#sent], stateMsg(2, 9))
  end)

  T.test('action returning false replies with its error', function()
    local hub = setup()
    T.eq(call(hub, { id = 4, cmd = 'counter.set', args = {} }),
      { type = 'reply', id = 4, ok = false, error = 'bad_args' })
  end)

  T.test('action that throws replies internal_error and logs', function()
    local hub, _, _, logs = setup()
    T.eq(call(hub, { id = 5, cmd = 'counter.boom' }), { type = 'reply', id = 5, ok = false, error = 'internal_error' })
    T.ok(table.concat(logs, '\n'):find('kaboom', 1, true), 'error logged')
  end)

  T.test('unknown module or action replies unknown_command', function()
    local hub = setup()
    T.eq(call(hub, { id = 6, cmd = 'nope.set' }).error, 'unknown_command')
    T.eq(call(hub, { id = 7, cmd = 'counter.nope' }).error, 'unknown_command')
    T.eq(call(hub, { id = 8, cmd = 'counter' }).error, 'unknown_command')
  end)

  T.test('malformed messages reply bad_request', function()
    local hub = setup()
    T.eq(json.decode(hub:handleMessage('not json')), { type = 'reply', ok = false, error = 'bad_request' })
    T.eq(json.decode(hub:handleMessage('[1,2]')).error, 'bad_request')
    T.eq(json.decode(hub:handleMessage('{"id":1}')).error, 'bad_request')
  end)

  T.test('a throwing state() is logged and does not push', function()
    local hub, mod, sent, logs = setup()
    mod.state = function() error('state broke') end
    hub:notify('counter')
    T.eq(#sent, 0)
    T.ok(table.concat(logs, '\n'):find('state broke', 1, true), 'logged')
  end)

  T.test('a throwing send is logged, not raised', function()
    local logs = {}
    local hub = Hub.new({ send = function() error('socket gone') end, log = function(m) logs[#logs + 1] = m end })
    hub:register({ name = 'm', state = function() return { a = 1 } end, actions = {} })
    hub:notify('m')
    T.ok(table.concat(logs, '\n'):find('socket gone', 1, true), 'logged')
  end)

  T.test('snapshot returns versions and state of all modules', function()
    local hub = setup()
    T.eq(hub:snapshot(), { versions = { counter = 1 }, counter = { value = 1 } })
  end)
end
