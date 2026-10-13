-- Window switcher: tracks standard windows on all Spaces (best effort) and focuses them.
local Model = require('tabletpanel.windows_model')

local W = { name = 'windows', actions = {} }

local wf = hs.window.filter
local EVENTS = {
  wf.windowCreated, wf.windowDestroyed, wf.windowTitleChanged, wf.windowFocused,
  wf.windowMinimized, wf.windowUnminimized, wf.windowHidden, wf.windowUnhidden,
  wf.windowInCurrentSpace, wf.windowNotInCurrentSpace, wf.windowsChanged,
}
local DEBOUNCE_SECONDS = 0.05

local model, allFilter, spaceFilter, spacesWatcher, debounceTimer, notify
local iconCache = {}

local function schedule()
  if debounceTimer then debounceTimer:stop() end
  debounceTimer = hs.timer.doAfter(DEBOUNCE_SECONDS, function()
    debounceTimer = nil
    notify()
  end)
end

function W.start(notifyFn)
  notify = notifyFn
  model = Model.new()
  -- Copies of the default filter keep its rejections of background/system apps;
  -- an empty default rule also admits minimized and hidden windows.
  allFilter = wf.new(nil):setDefaultFilter({})
  spaceFilter = wf.new(nil):setDefaultFilter({ currentSpace = true })
  allFilter:subscribe(EVENTS, schedule)
  spaceFilter:subscribe(EVENTS, schedule)
  spacesWatcher = hs.spaces.watcher.new(schedule):start()
  schedule()
end

function W.stop()
  if debounceTimer then debounceTimer:stop(); debounceTimer = nil end
  if allFilter then allFilter:unsubscribeAll(); allFilter = nil end
  if spaceFilter then spaceFilter:unsubscribeAll(); spaceFilter = nil end
  if spacesWatcher then spacesWatcher:stop(); spacesWatcher = nil end
end

function W.state()
  if not allFilter then return Model.new():build({}, nil) end
  local onSpace = {}
  for _, w in ipairs(spaceFilter:getWindows()) do
    local id = w:id()
    if id then onSpace[id] = true end
  end
  local raw = {}
  for _, w in ipairs(allFilter:getWindows()) do
    local app, id = w:application(), w:id()
    if app and id then
      raw[#raw + 1] = {
        id = id, title = w:title(), bundleId = app:bundleID(), appName = app:name(),
        appHidden = app:isHidden(), minimized = w:isMinimized(),
        onCurrentSpace = onSpace[id] == true, standard = w:isStandard(),
      }
    end
  end
  local focused = hs.window.focusedWindow()
  return model:build(raw, focused and focused:id() or nil)
end

local function findWindow(id)
  if not allFilter then return nil end
  for _, w in ipairs(allFilter:getWindows()) do
    if w:id() == id then return w end
  end
end

function W.actions.focus(args)
  local win = findWindow(tonumber(args.id))
  if not win then return false, 'not_found' end
  local app = win:application()
  if app and app:isHidden() then app:unhide() end
  if win:isMinimized() then win:unminimize() end
  win:focus() -- macOS switches Space if the window lives on another one (best effort)
  return true
end

-- PNG bytes of the app icon, cached per bundle id (false = no icon available).
function W.icon(bundleId)
  if iconCache[bundleId] == nil then
    local bytes = false
    local img = hs.image.imageFromAppBundle(bundleId)
    if img then
      local url = img:setSize({ w = 128, h = 128 }):encodeAsURLString(false, 'PNG')
      local b64 = url and url:match('^data:image/png;base64,(.+)$')
      bytes = b64 and hs.base64.decode(b64) or false
    end
    iconCache[bundleId] = bytes
  end
  return iconCache[bundleId] or nil
end

return W
