-- Turns raw window records into the grouped "windows" state.
-- Order is stable: apps and windows keep the order in which they were first seen.
local json = require('tabletpanel.json')

local Model = {}
Model.__index = Model

function Model.new()
  return setmetatable({ nextSeq = 1, appSeq = {}, winSeq = {} }, Model)
end

local function seqFor(self, map, key)
  if not map[key] then
    map[key] = self.nextSeq
    self.nextSeq = self.nextSeq + 1
  end
  return map[key]
end

local function bySeq(a, b) return a._seq < b._seq end

-- raw: array of { id, title, bundleId, appName, appHidden, minimized, onCurrentSpace, standard }
function Model:build(raw, focusedId)
  local apps, appList, seenApps, seenWins = {}, {}, {}, {}

  for _, w in ipairs(raw) do
    if w.id and w.bundleId and w.standard and w.title and w.title ~= '' then
      seenWins[w.id], seenApps[w.bundleId] = true, true
      local app = apps[w.bundleId]
      if not app then
        app = {
          bundleId = w.bundleId, name = w.appName or w.bundleId, hidden = w.appHidden == true,
          windows = json.array({}), _seq = seqFor(self, self.appSeq, w.bundleId),
        }
        apps[w.bundleId] = app
        appList[#appList + 1] = app
      end
      app.windows[#app.windows + 1] = {
        id = w.id, title = w.title, minimized = w.minimized == true,
        otherSpace = not w.minimized and not w.appHidden and not w.onCurrentSpace,
        _seq = seqFor(self, self.winSeq, w.id),
      }
    end
  end

  for id in pairs(self.winSeq) do if not seenWins[id] then self.winSeq[id] = nil end end
  for bid in pairs(self.appSeq) do if not seenApps[bid] then self.appSeq[bid] = nil end end

  table.sort(appList, bySeq)
  for _, app in ipairs(appList) do
    table.sort(app.windows, bySeq)
    for _, w in ipairs(app.windows) do w._seq = nil end
    app._seq = nil
  end

  return { focusedId = focusedId, apps = json.array(appList) }
end

return Model
