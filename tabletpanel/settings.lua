-- The user's display preferences from init.lua's start({ ... }), passed to the page.
local Settings = {}

-- config: the panel's config table, read on every state() so a later change shows up.
function Settings.new(config)
  return {
    name = 'settings',
    actions = {},
    start = function() end,
    stop = function() end,
    state = function()
      return { timeFormat = config.timeFormat, dateFormat = config.dateFormat }
    end,
  }
end

return Settings
