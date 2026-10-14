-- Window switcher: tracks standard windows on all Spaces (best effort) and focuses them.
-- Like the Dock, it also lists the Dock's pinned apps and running apps without windows.
local Model = require('tabletpanel.windows_model')
local Dock = require('tabletpanel.dock_model')

local W = { name = 'windows', actions = {} }

local wf = hs.window.filter
local EVENTS = {
  wf.windowCreated, wf.windowDestroyed, wf.windowTitleChanged, wf.windowFocused,
  wf.windowMinimized, wf.windowUnminimized, wf.windowHidden, wf.windowUnhidden,
  wf.windowInCurrentSpace, wf.windowNotInCurrentSpace, wf.windowsChanged,
}
local DEBOUNCE_SECONDS = 0.05

local DOCK_PLIST = os.getenv('HOME') .. '/Library/Preferences/com.apple.dock.plist'

local model, allFilter, spaceFilter, spacesWatcher, appWatcher, dockWatcher, debounceTimer, notify
local iconCache = {}
local pins = Dock.pins(nil)

local function readPins()
  pins = Dock.pins(hs.plist.read(DOCK_PLIST))
end

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
  -- Window events miss apps that have no windows (launching, quitting, Finder with all closed).
  appWatcher = hs.application.watcher.new(schedule):start()
  readPins()
  -- The Dock rewrites its plist when pins change; watch the folder, as the write replaces the file.
  dockWatcher = hs.pathwatcher.new(DOCK_PLIST:match('^(.*)/'), function(paths)
    for _, path in ipairs(paths) do
      if path:sub(-#'com.apple.dock.plist') == 'com.apple.dock.plist' then
        readPins()
        schedule()
        return
      end
    end
  end):start()
  schedule()
end

function W.stop()
  if debounceTimer then debounceTimer:stop(); debounceTimer = nil end
  if allFilter then allFilter:unsubscribeAll(); allFilter = nil end
  if spaceFilter then spaceFilter:unsubscribeAll(); spaceFilter = nil end
  if spacesWatcher then spacesWatcher:stop(); spacesWatcher = nil end
  if appWatcher then appWatcher:stop(); appWatcher = nil end
  if dockWatcher then dockWatcher:stop(); dockWatcher = nil end
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
  -- Apps that would show in the Dock (kind 1: regular apps, not agents or background tools).
  local running = {}
  for _, app in ipairs(hs.application.runningApplications()) do
    local bid = app:bundleID()
    if bid and app:kind() == 1 then
      running[#running + 1] = { bundleId = bid, name = app:name(), hidden = app:isHidden() }
    end
  end
  local focused = hs.window.focusedWindow()
  return model:build(raw, focused and focused:id() or nil, { pins = pins, running = running })
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

-- Opens an app like a click in the Dock: launches it, or brings it forward and, if it has
-- no windows, asks it for one (the "reopen" event `open` sends).
function W.actions.launch(args)
  local bid = args.bundleId
  if type(bid) ~= 'string' or not bid:match('^[%w%.%-_]+$') then return false, 'bad_bundle_id' end
  hs.task.new('/usr/bin/open', nil, { '-b', bid }):start()
  return true
end

-- A JPEG preview of a window (needs Screen Recording permission), or nil.
-- Minimized windows and windows on other Spaces can't be captured.
local THUMB_WIDTH = 480

function W.thumb(id)
  if not hs.screenRecordingState() then return nil end
  local win = findWindow(id)
  if not win or win:isMinimized() then return nil end
  local img = win:snapshot()
  if not img then return nil end
  local size = img:size()
  if size.w <= 0 then return nil end
  img = img:setSize({ w = THUMB_WIDTH, h = math.floor(size.h * THUMB_WIDTH / size.w) }, true)
  local url = img:encodeAsURLString(false, 'JPEG')
  local b64 = url and url:match('^data:image/jpeg;base64,(.+)$')
  return b64 and hs.base64.decode(b64) or nil
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
