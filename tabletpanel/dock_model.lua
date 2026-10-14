-- The Mac Dock's pinned apps, from com.apple.dock's preferences. Pure.
local Dock = {}

local FINDER = 'com.apple.finder'

-- plist: the decoded com.apple.dock preferences (or nil). Finder always leads, as in the Dock.
function Dock.pins(plist)
  local pins = { { bundleId = FINDER, name = 'Finder' } }
  for _, entry in ipairs((plist and plist['persistent-apps']) or {}) do
    local data = entry['tile-data'] or {}
    local bid = data['bundle-identifier']
    if type(bid) == 'string' and bid ~= '' and bid ~= FINDER then
      pins[#pins + 1] = { bundleId = bid, name = data['file-label'] or bid }
    end
  end
  return pins
end

return Dock
