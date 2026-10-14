-- Buttons for the Mac's front app, from tabletpanel/shortcuts.lua. Pure.
local json = require('tabletpanel.json')

local Shortcuts = {}

local MAX_BUTTONS = 6

-- config: { [bundleId] = { { label, mods, key }, ... } }
function Shortcuts.buttons(config, bundleId)
  local out = {}
  for _, entry in ipairs((bundleId and config[bundleId]) or {}) do
    local label, mods, key = entry[1], entry[2], entry[3]
    if type(label) == 'string' and type(mods) == 'table' and type(key) == 'string' and #out < MAX_BUTTONS then
      out[#out + 1] = { label = label, mods = mods, key = key }
    end
  end
  return json.array(out)
end

return Shortcuts
