local Settings = require('tabletpanel.settings')

return function(T)
  T.test('state passes the clock formats from the config to the page', function()
    local s = Settings.new({ port = 8765, timeFormat = 'g:i A', dateFormat = 'd.m.Y', homeRouterMACs = { 'aa' } })
    T.eq(s.name, 'settings')
    T.eq(s.state(), { timeFormat = 'g:i A', dateFormat = 'd.m.Y' })
  end)

  T.test('unset formats are left out, so the page uses its defaults', function()
    T.eq(Settings.new({}).state(), {})
  end)

  T.test('a later config change shows up in the next state', function()
    local config = {}
    local s = Settings.new(config)
    config.dateFormat = 'Y-m-d'
    T.eq(s.state(), { dateFormat = 'Y-m-d' })
  end)
end
