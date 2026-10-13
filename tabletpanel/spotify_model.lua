-- Spotify state: the AppleScript that reads it and the parser for its output. Pure.
local Model = {}

Model.SEP = string.char(31) -- ASCII unit separator; never appears in track metadata

-- Reads everything in one AppleScript round trip. Each field is guarded with `try`
-- because podcasts, ads and local files can return `missing value`.
Model.READ_SCRIPT = [[
tell application "Spotify"
  set d to character id 31
  set st to (player state as string)
  if st is "stopped" then return "stopped"
  set t to current track
  set tId to ""
  set tName to ""
  set tArtist to ""
  set tAlbum to ""
  set tDur to 0
  set tArt to ""
  set pos to 0
  try
    set tId to (id of t) as string
  end try
  try
    set tName to (name of t) as string
  end try
  try
    set tArtist to (artist of t) as string
  end try
  try
    set tAlbum to (album of t) as string
  end try
  try
    set tDur to duration of t
  end try
  try
    set tArt to (artwork url of t) as string
  end try
  try
    set pos to player position
  end try
  return st & d & tId & d & tName & d & tArtist & d & tAlbum & d & (tDur as string) & d & (pos as string) & d & tArt & d & ((sound volume) as string) & d & (shuffling as string) & d & (repeating as string)
end tell
]]

-- AppleScript formats reals with the user's locale, e.g. "73,5" on fi_FI.
local function num(s)
  if not s or s == '' then return nil end
  return tonumber((s:gsub(',', '.')))
end

local function round(x) return math.floor(x + 0.5) end

function Model.parse(output)
  if type(output) ~= 'string' then return nil, 'no output' end
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

return Model
