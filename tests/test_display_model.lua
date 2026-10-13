local Model = require('tabletpanel.display_model')

local function run(m, ...)
  for _, e in ipairs({ ... }) do m:event(e) end
  return m:state().awake
end

return function(T)
  T.test('starts awake, or asleep when seeded as locked', function()
    T.eq(Model.new():state(), { awake = true })
    T.eq(Model.new({ locked = true }):state(), { awake = false })
  end)

  T.test('display sleep and wake', function()
    local m = Model.new()
    T.eq(m:event('screensDidSleep'), true)
    T.eq(m:state().awake, false)
    T.eq(m:event('screensDidWake'), true)
    T.eq(m:state().awake, true)
  end)

  T.test('stays asleep after screens wake while still locked, until unlock', function()
    local m = Model.new()
    T.eq(run(m, 'screensDidLock', 'screensDidSleep', 'screensDidWake'), false)
    T.eq(run(m, 'screensDidUnlock'), true)
  end)

  T.test('screensaver and system sleep count as not awake', function()
    T.eq(run(Model.new(), 'screensaverDidStart'), false)
    T.eq(run(Model.new(), 'screensaverDidStart', 'screensaverDidStop'), true)
    T.eq(run(Model.new(), 'systemWillSleep'), false)
    T.eq(run(Model.new(), 'systemWillSleep', 'systemDidWake'), true)
  end)

  T.test('unlock clears everything (the user is at the Mac)', function()
    T.eq(run(Model.new(), 'screensaverDidStart', 'screensDidLock', 'screensDidUnlock'), true)
  end)

  T.test('unknown events and repeats report no change', function()
    local m = Model.new()
    T.eq(m:event('sessionDidBecomeActive'), false)
    T.eq(m:event(nil), false)
    m:event('screensDidSleep')
    T.eq(m:event('screensDidSleep'), false)
  end)
end
