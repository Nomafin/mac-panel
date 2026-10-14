-- Unread badges from the Dock's accessibility items (they exist even while the Dock is hidden). Pure.
local json = require('tabletpanel.json')

local Badges = {}

-- 'file:///Applications/Microsoft%20Outlook.app/' -> '/Applications/Microsoft Outlook.app'
function Badges.pathFromUrl(url)
  if type(url) ~= 'string' then return nil end
  local path = url:match('^file://(/.*)$')
  if not path then return nil end
  path = path:gsub('%%(%x%x)', function(hex) return string.char(tonumber(hex, 16)) end)
  return (path:gsub('/$', ''))
end

-- items: { {url, label} }; bundleFor(path) -> bundle id or nil. Sorted for stable change detection.
function Badges.collect(items, bundleFor)
  local out = {}
  for _, item in ipairs(items) do
    local label = item.label
    if type(label) == 'string' and label ~= '' then
      local path = Badges.pathFromUrl(item.url)
      local bid = path and bundleFor(path)
      if bid then out[#out + 1] = { bundleId = bid, label = label } end
    end
  end
  table.sort(out, function(a, b) return a.bundleId < b.bundleId end)
  return json.array(out)
end

return Badges
