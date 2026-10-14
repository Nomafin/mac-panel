local System = require('tabletpanel.system_model')

return function(T)
  T.test('CPU percent from two tick samples', function()
    T.eq(System.cpuPercent({ active = 100, idle = 900 }, { active = 400, idle = 1600 }), 30)
    T.eq(System.cpuPercent(nil, { active = 1, idle = 1 }), nil)
    T.eq(System.cpuPercent({ active = 5, idle = 5 }, { active = 5, idle = 5 }), nil)
  end)

  T.test('memory used like Activity Monitor: app memory + wired + compressed', function()
    local vm = { pageSize = 16384, memSize = 16384 * 1000,
      anonymousPages = 500, pagesPurgeable = 50, pagesWiredDown = 150, pagesUsedByVMCompressor = 100 }
    T.eq(System.memoryPercent(vm), 70)
    T.eq(System.memoryPercent({}), nil)
  end)

  T.test('MacBook battery, or nothing on a Mac without one', function()
    T.eq(System.battery(83.6, 'AC Power', true), { level = 84, onPower = true, charging = true })
    T.eq(System.battery(15, 'Battery Power', false), { level = 15, onPower = false, charging = false })
    T.eq(System.battery(nil, nil, nil), nil)
  end)
end
