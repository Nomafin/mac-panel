local Dock = require('tabletpanel.dock_model')

local function tile(bid, label, extra)
  local t = { ['tile-data'] = { ['bundle-identifier'] = bid, ['file-label'] = label }, ['tile-type'] = 'file-tile' }
  for k, v in pairs(extra or {}) do t[k] = v end
  return t
end

return function(T)
  T.test('Finder first, then the pinned apps in Dock order', function()
    T.eq(Dock.pins({ ['persistent-apps'] = { tile('com.a', 'A'), tile('com.b', 'B') } }), {
      { bundleId = 'com.apple.finder', name = 'Finder' },
      { bundleId = 'com.a', name = 'A' },
      { bundleId = 'com.b', name = 'B' },
    })
  end)

  T.test('skips spacers and entries without a bundle id, and a pinned Finder', function()
    local spacer = { ['tile-data'] = {}, ['tile-type'] = 'spacer-tile' }
    T.eq(Dock.pins({ ['persistent-apps'] = { spacer, tile(nil, 'Odd'), tile('com.apple.finder', 'Finder'), tile('com.a', 'A') } }), {
      { bundleId = 'com.apple.finder', name = 'Finder' },
      { bundleId = 'com.a', name = 'A' },
    })
  end)

  T.test('falls back to the bundle id for a missing label', function()
    T.eq(Dock.pins({ ['persistent-apps'] = { tile('com.a', nil) } })[2], { bundleId = 'com.a', name = 'com.a' })
  end)

  T.test('an unreadable Dock plist still gives Finder', function()
    T.eq(Dock.pins(nil), { { bundleId = 'com.apple.finder', name = 'Finder' } })
    T.eq(Dock.pins({}), { { bundleId = 'com.apple.finder', name = 'Finder' } })
  end)
end
