-- Spotify panel: event-driven state reads and transport commands via AppleScript.
-- Every AppleScript call is guarded by a running check so Spotify is never launched by us.
local Model = require('tabletpanel.spotify_model')

local S = { name = 'spotify', actions = {} }

local BUNDLE_ID = 'com.spotify.client'
local POLL_SECONDS = 2 -- volume/shuffle/repeat changed inside Spotify emit no notification

local current = { running = false }
local notify, log, lastError
local watchers = {}

local function isRunning()
  return hs.application.get(BUNDLE_ID) ~= nil
end

local holdUntil = 0 -- after a predicted command, Spotify reports stale values for ~1 s

local function read(force)
  if not force and hs.timer.secondsSinceEpoch() < holdUntil then return end
  if not isRunning() then
    current = { running = false }
    return
  end
  local ok, out, raw = hs.osascript.applescript(Model.READ_SCRIPT)
  local state, err
  if ok then
    state, err = Model.parse(out)
  else
    err = 'AppleScript failed: ' .. hs.inspect(raw)
  end
  if state then
    current, lastError = state, nil
  elseif err ~= lastError then -- keep last good state, log each distinct error once
    lastError = err
    log.w('spotify: ' .. err)
  end
end

local function refresh()
  read()
  notify()
end

local HOLD_SECONDS = 1.5
local QUIT_QUIET_SECONDS = 3

-- Runs a command, predicts its effect for an instant reply, then re-reads to confirm.
local function tell(command, name, args)
  if not isRunning() then return false, 'not_running' end
  if not hs.osascript.applescript(Model.commandScript(command)) then
    return false, 'applescript_failed'
  end
  local predicted = Model.applyCommand(current, name, args or {})
  if predicted ~= current then
    current = predicted
    holdUntil = hs.timer.secondsSinceEpoch() + HOLD_SECONDS
    if watchers.confirm then watchers.confirm:stop() end
    watchers.confirm = hs.timer.doAfter(HOLD_SECONDS, function()
      read(true)
      notify()
    end)
  else
    read(true) -- next/previous: nothing to predict; Spotify's notification follows
  end
  return true
end

S.actions.playpause = function() return tell('playpause', 'playpause') end
S.actions.next = function() return tell('next track', 'next') end
S.actions.previous = function() return tell('previous track', 'previous') end
S.actions.shuffle = function() return tell('set shuffling to not shuffling', 'shuffle') end
S.actions['repeat'] = function() return tell('set repeating to not repeating', 'repeat') end

S.actions.seek = function(args)
  local ms = tonumber(args.ms)
  if not ms or ms < 0 then return false, 'bad_args' end
  ms = math.floor(ms)
  -- Built with integer math so the decimal point never depends on the locale.
  return tell(string.format('set player position to %d.%03d', ms // 1000, ms % 1000), 'seek', { ms = ms })
end

S.actions.volume = function(args)
  local v = tonumber(args.value)
  if not v then return false, 'bad_args' end
  v = math.max(0, math.min(100, math.floor(v + 0.5)))
  return tell(string.format('set sound volume to %d', v), 'volume', { value = v })
end

function S.state()
  return current
end

function S.start(notifyFn, logger)
  notify, log = notifyFn, logger
  watchers.notification = hs.distributednotifications.new(function(_, _, info)
    if Model.isStopNotification(info) then
      -- Possibly quitting: no AppleScript until the app watcher has had a chance to see it exit.
      current = { running = true, state = 'stopped' }
      holdUntil = hs.timer.secondsSinceEpoch() + QUIT_QUIET_SECONDS
      notify()
    else
      refresh()
    end
  end, 'com.spotify.client.PlaybackStateChanged'):start()
  watchers.app = hs.application.watcher.new(function(name, event, app)
    local bundleId = app and app:bundleID()
    if bundleId ~= BUNDLE_ID and name ~= 'Spotify' then return end
    if event == hs.application.watcher.launched then
      watchers.launchDelay = hs.timer.doAfter(1.5, refresh) -- AppleScript isn't ready immediately
    elseif event == hs.application.watcher.terminated then
      current = { running = false }
      notify()
    end
  end):start()
  watchers.poll = hs.timer.doEvery(POLL_SECONDS, function()
    if current.running or isRunning() then refresh() end
  end)
  read()
end

function S.stop()
  for _, w in pairs(watchers) do w:stop() end
  watchers = {}
end

return S
