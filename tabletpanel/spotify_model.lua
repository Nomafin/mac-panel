-- Spotify state: the AppleScript that reads it and the parser for its output. Pure.
local Model = {}

Model.SEP = string.char(31) -- ASCII unit separator; never appears in track metadata

-- Every script checks `is running` itself, right before talking to Spotify: a check in Lua
-- races with Spotify quitting, and a `tell` to a just-quit app relaunches it.

-- Reads everything in one AppleScript round trip. Each field is guarded with `try`
-- because podcasts, ads and local files can return `missing value`.
Model.READ_SCRIPT = [[
if application "Spotify" is not running then return "notrunning"
tell application "Spotify"
  set sepChar to character id 31
  set pState to (player state as string)
  if pState is "stopped" then return "stopped"
  set trk to current track
  set tId to ""
  set tName to ""
  set tArtist to ""
  set tAlbum to ""
  set tDur to 0
  set tArt to ""
  set tPos to 0
  try
    set tId to (id of trk) as string
  end try
  try
    set tName to (name of trk) as string
  end try
  try
    set tArtist to (artist of trk) as string
  end try
  try
    set tAlbum to (album of trk) as string
  end try
  try
    set tDur to duration of trk
  end try
  try
    set tArt to (artwork url of trk) as string
  end try
  try
    set tPos to player position
  end try
  return pState & sepChar & tId & sepChar & tName & sepChar & tArtist & sepChar & tAlbum & sepChar & (tDur as string) & sepChar & (tPos as string) & sepChar & tArt & sepChar & ((sound volume) as string) & sepChar & (shuffling as string) & sepChar & (repeating as string)
end tell
]]

-- AppleScript formats reals with the user's locale, e.g. "73,5" on fi_FI.
local function num(s)
  if not s or s == '' then return nil end
  return tonumber((s:gsub(',', '.')))
end

function Model.commandScript(command)
  return 'if application "Spotify" is running then tell application "Spotify" to ' .. command
end

-- Spotify posts {"Player State" = "Stopped"} as it quits, before its process is gone.
-- Reading it then (even behind an `is running` check) relaunches Spotify.
function Model.isStopNotification(info)
  return type(info) == 'table' and info['Player State'] == 'Stopped'
end

local function round(x) return math.floor(x + 0.5) end

function Model.parse(output)
  if type(output) ~= 'string' then return nil, 'no output' end
  if output == 'notrunning' then return { running = false } end
  if output == 'stopped' then return { running = true, state = 'stopped' } end

  local f = {}
  for part in (output .. Model.SEP):gmatch('(.-)' .. Model.SEP) do f[#f + 1] = part end
  if #f ~= 11 then return nil, 'unexpected output: ' .. output:sub(1, 80) end
  if f[1] ~= 'playing' and f[1] ~= 'paused' then return nil, 'unknown player state: ' .. f[1] end

  return {
    running = true,
    state = f[1],
    track = {
      id = f[2], name = f[3], artist = f[4], album = f[5],
      durationMs = round(num(f[6]) or 0),
      artworkUrl = f[8],
    },
    positionMs = round((num(f[7]) or 0) * 1000),
    volume = round(num(f[9]) or 0),
    shuffle = f[10] == 'true',
    ['repeat'] = f[11] == 'true',
  }
end

-- Spotify applies commands asynchronously, so an immediate re-read returns the old state.
-- This predicts the outcome so replies are right at once; a delayed read confirms it.
function Model.applyCommand(state, cmd, args)
  if not state.track or state.state == 'stopped' then return state end
  local predicted = {}
  for k, v in pairs(state) do predicted[k] = v end
  if cmd == 'playpause' then
    predicted.state = state.state == 'playing' and 'paused' or 'playing'
  elseif cmd == 'shuffle' then
    predicted.shuffle = not state.shuffle
  elseif cmd == 'repeat' then
    predicted['repeat'] = not state['repeat']
  elseif cmd == 'volume' then
    predicted.volume = args.value
  elseif cmd == 'seek' then
    predicted.positionMs = args.ms
  else
    return state
  end
  return predicted
end

return Model
