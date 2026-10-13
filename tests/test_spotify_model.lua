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

  T.test('read script uses unit separator and guards missing values', function()
    T.ok(Model.READ_SCRIPT:find('character id 31', 1, true))
    T.ok(Model.READ_SCRIPT:find('try', 1, true))
  end)
end
