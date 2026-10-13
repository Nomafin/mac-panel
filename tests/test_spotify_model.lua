local Model = require('tabletpanel.spotify_model')

local function out(...) return table.concat({ ... }, Model.SEP) end

local function playing(overrides)
  local f = { 'playing', 'spotify:track:1', 'Song', 'Artist', 'Album', '215000', '73.5', 'https://i.scdn.co/image/x', '65', 'false', 'true' }
  for i, v in pairs(overrides or {}) do f[i] = v end
  return out(table.unpack(f))
end

return function(T)
  T.test('parses a playing track', function()
    T.eq(Model.parse(playing()), {
      running = true, state = 'playing',
      track = { id = 'spotify:track:1', name = 'Song', artist = 'Artist', album = 'Album',
        durationMs = 215000, artworkUrl = 'https://i.scdn.co/image/x' },
      positionMs = 73500, volume = 65, shuffle = false, ['repeat'] = true,
    })
  end)

  T.test('parses comma decimal separators (fi_FI locale) without truncating', function()
    T.eq(Model.parse(playing({ [7] = '73,123' })).positionMs, 73123)
  end)

  T.test('keeps commas inside text fields', function()
    T.eq(Model.parse(playing({ [5] = "Hurry Up, We're Dreaming" })).track.album, "Hurry Up, We're Dreaming")
  end)

  T.test('parses paused state and toggles', function()
    local s = Model.parse(playing({ [1] = 'paused', [10] = 'true', [11] = 'false' }))
    T.eq({ s.state, s.shuffle, s['repeat'] }, { 'paused', true, false })
  end)

  T.test('empty artwork url becomes an empty string', function()
    T.eq(Model.parse(playing({ [8] = '' })).track.artworkUrl, '')
  end)

  T.test('stopped means running with nothing playing', function()
    T.eq(Model.parse('stopped'), { running = true, state = 'stopped' })
  end)

  T.test('rejects garbage', function()
    local s, err = Model.parse('something odd')
    T.eq(s, nil); T.ok(err)
    T.eq(Model.parse(nil), nil)
    T.eq(Model.parse(playing({ [1] = 'buffering' })), nil)
  end)

  T.test('applyCommand predicts the result of a command without mutating the input', function()
    local s = Model.parse(playing())
    local paused = Model.applyCommand(s, 'playpause', {})
    T.eq(paused.state, 'paused')
    T.eq(s.state, 'playing', 'input untouched')
    T.eq(Model.applyCommand(paused, 'playpause', {}).state, 'playing')
    T.eq(Model.applyCommand(s, 'shuffle', {}).shuffle, true)
    T.eq(Model.applyCommand(s, 'repeat', {})['repeat'], false)
    T.eq(Model.applyCommand(s, 'volume', { value = 40 }).volume, 40)
    T.eq(Model.applyCommand(s, 'seek', { ms = 60000 }).positionMs, 60000)
  end)

  T.test('applyCommand leaves unpredictable or idle states alone', function()
    local s = Model.parse(playing())
    T.eq(Model.applyCommand(s, 'next', {}), s)
    local stopped = { running = true, state = 'stopped' }
    T.eq(Model.applyCommand(stopped, 'playpause', {}), stopped)
  end)

  T.test('notrunning output means Spotify is closed', function()
    T.eq(Model.parse('notrunning'), { running = false })
  end)

  T.test('scripts check Spotify is running before talking to it (never relaunch)', function()
    T.ok(Model.READ_SCRIPT:find('if application "Spotify" is not running then return "notrunning"', 1, true), 'read guard')
    T.eq(Model.commandScript('playpause'),
      'if application "Spotify" is running then tell application "Spotify" to playpause')
  end)

  T.test('a Stopped notification (sent when Spotify quits) is recognised', function()
    T.eq(Model.isStopNotification({ ['Player State'] = 'Stopped' }), true)
    T.eq(Model.isStopNotification({ ['Player State'] = 'Playing', Name = 'Song' }), false)
    T.eq(Model.isStopNotification(nil), false)
  end)

  T.test('read script uses unit separator and guards missing values', function()
    T.ok(Model.READ_SCRIPT:find('character id 31', 1, true))
    T.ok(Model.READ_SCRIPT:find('try', 1, true))
  end)
end
