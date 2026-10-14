-- Unread badges (Slack, Mail, …) read from the Dock, which keeps them even while hidden.
local Badges = require('tabletpanel.badges_model')

local B = { name = 'badges', actions = {} }

local POLL_SECONDS = 2

local timer, current, notify
local bundleCache = {}

local function bundleFor(path)
  if bundleCache[path] == nil then
    local info = hs.application.infoForBundlePath(path)
    bundleCache[path] = info and info.CFBundleIdentifier or false
  end
  return bundleCache[path] or nil
end

local function read()
  local dockApp = hs.application.get('com.apple.dock')
  if not dockApp then return Badges.collect({}, bundleFor) end
  local items = {}
  for _, list in ipairs(hs.axuielement.applicationElement(dockApp):attributeValue('AXChildren') or {}) do
    for _, item in ipairs(list:attributeValue('AXChildren') or {}) do
      local label = item:attributeValue('AXStatusLabel')
      if label then
        local url = item:attributeValue('AXURL')
        items[#items + 1] = { url = type(url) == 'table' and url.url or url, label = label }
      end
    end
  end
  return Badges.collect(items, bundleFor)
end

function B.start(notifyFn)
  notify = notifyFn
  current = read()
  timer = hs.timer.doEvery(POLL_SECONDS, function()
    local ok, items = pcall(read)
    if ok then
      current = items
      notify() -- the hub only pushes when the state actually changed
    end
  end)
end

function B.stop()
  if timer then timer:stop(); timer = nil end
end

function B.state()
  return { items = current or Badges.collect({}, bundleFor) }
end

return B
