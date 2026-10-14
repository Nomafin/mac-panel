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

-- Untitled windows are usually invisible helpers, but Edge/Chrome web apps (TweetDeck) leave
-- their real window untitled too; a normal-sized one is kept under the app's name.
local MIN_UNTITLED_W, MIN_UNTITLED_H = 200, 150

local function titleFor(w)
  if w.title and w.title ~= '' then return w.title end
  local f = w.frame
  if f and f.w >= MIN_UNTITLED_W and f.h >= MIN_UNTITLED_H then return w.appName or w.bundleId end
  return nil
end

-- raw: array of { id, title, bundleId, appName, appHidden, minimized, onCurrentSpace, standard }
-- dock (optional): { pins = { {bundleId, name} } in Dock order, running = { {bundleId, name, hidden} },
--                   screens = { {id, name, frame} } }
-- Like the Dock: pinned apps first in pin order (running or not), then other apps in first-seen order.
function Model:build(raw, focusedId, dock)
  dock = dock or {}
  local apps, appList, seenApps, seenWins = {}, {}, {}, {}
  local pinIndex = {}
  for i, pin in ipairs(dock.pins or {}) do
    if not pinIndex[pin.bundleId] then pinIndex[pin.bundleId] = i end
  end

  local function appFor(bundleId, name, hidden, running)
    local app = apps[bundleId]
    if not app then
      app = {
        bundleId = bundleId, name = name or bundleId, hidden = hidden == true, running = running,
        pinned = pinIndex[bundleId] ~= nil, windows = json.array({}),
      }
      apps[bundleId] = app
      appList[#appList + 1] = app
    end
    return app
  end

  local function seen(bundleId, name, hidden)
    seenApps[bundleId] = true
    local app = appFor(bundleId, name, hidden, true)
    app._seq = seqFor(self, self.appSeq, bundleId)
    return app
  end

  for _, w in ipairs(raw) do
    -- Minimized windows can report a non-standard AX subrole (Finder on macOS 26),
    -- and panels/popups can't be minimized, so minimized counts as standard.
    local title = titleFor(w)
    if w.id and w.bundleId and (w.standard or w.minimized) and title then
      seenWins[w.id] = true
      local app = seen(w.bundleId, w.appName, w.appHidden)
      app.windows[#app.windows + 1] = {
        id = w.id, title = title, minimized = w.minimized == true,
        otherSpace = not w.minimized and not w.appHidden and not w.onCurrentSpace,
        frame = w.frame, z = w.z, -- for the map page
        _seq = seqFor(self, self.winSeq, w.id),
      }
    end
  end
  for _, r in ipairs(dock.running or {}) do
    if r.bundleId then seen(r.bundleId, r.name, r.hidden) end
  end
  for _, pin in ipairs(dock.pins or {}) do appFor(pin.bundleId, pin.name, false, false) end

  for id in pairs(self.winSeq) do if not seenWins[id] then self.winSeq[id] = nil end end
  for bid in pairs(self.appSeq) do if not seenApps[bid] then self.appSeq[bid] = nil end end

  table.sort(appList, function(a, b)
    local pa, pb = pinIndex[a.bundleId], pinIndex[b.bundleId]
    if pa and pb then return pa < pb end
    if pa or pb then return pa ~= nil end
    return a._seq < b._seq
  end)
  for _, app in ipairs(appList) do
    table.sort(app.windows, function(a, b) return a._seq < b._seq end)
    for _, w in ipairs(app.windows) do w._seq = nil end
    app._seq = nil
  end

  return { focusedId = focusedId, apps = json.array(appList), screens = dock.screens and json.array(dock.screens) }
end

return Model
