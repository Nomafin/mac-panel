local Layout = require('tabletpanel.layout_model')

local screen = { x = -7680, y = -285, w = 7680, h = 2130 }

return function(T)
  T.test('thirds of a 32:9 screen', function()
    T.eq(Layout.frame('left-third', screen), { x = -7680, y = -285, w = 2560, h = 2130 })
    T.eq(Layout.frame('middle-third', screen), { x = -5120, y = -285, w = 2560, h = 2130 })
    T.eq(Layout.frame('right-third', screen), { x = -2560, y = -285, w = 2560, h = 2130 })
  end)

  T.test('halves, centre two-thirds and maximise', function()
    T.eq(Layout.frame('left-half', screen), { x = -7680, y = -285, w = 3840, h = 2130 })
    T.eq(Layout.frame('right-half', screen), { x = -3840, y = -285, w = 3840, h = 2130 })
    T.eq(Layout.frame('center', screen), { x = -6400, y = -285, w = 5120, h = 2130 })
    T.eq(Layout.frame('max', screen), screen)
  end)

  T.test('unknown presets give nil', function()
    T.eq(Layout.frame('diagonal', screen), nil)
  end)

  local screens = {
    { frame = { x = -7680, y = -285, w = 7680, h = 2130 } },
    { frame = { x = 0, y = 57, w = 2992, h = 1877 } },
  }

  T.test('clamp leaves a frame that fits on a screen alone', function()
    local f = { x = -5000, y = 0, w = 2000, h = 1200 }
    T.eq(Layout.clamp(f, screens), f)
  end)

  T.test('clamp pulls a frame dragged off the edge back onto the screen it overlaps most', function()
    T.eq(Layout.clamp({ x = 2500, y = 1500, w = 1000, h = 800 }, screens), { x = 1992, y = 1134, w = 1000, h = 800 })
    T.eq(Layout.clamp({ x = -9000, y = -900, w = 1000, h = 800 }, screens), { x = -7680, y = -285, w = 1000, h = 800 })
  end)

  T.test('clamp puts a frame that is off every screen on the nearest one', function()
    T.eq(Layout.clamp({ x = 9000, y = 100, w = 1000, h = 800 }, screens), { x = 1992, y = 100, w = 1000, h = 800 })
  end)

  T.test('clamp shrinks a frame bigger than its screen', function()
    T.eq(Layout.clamp({ x = 0, y = 57, w = 5000, h = 5000 }, screens), { x = 0, y = 57, w = 2992, h = 1877 })
  end)

  T.test('clamp rejects sizes below the minimum and numbers that are not finite', function()
    T.eq(Layout.clamp({ x = 0, y = 57, w = 40, h = 800 }, screens), nil)
    T.eq(Layout.clamp({ x = 0, y = 57, w = math.huge, h = 800 }, screens), nil)
    T.eq(Layout.clamp({ x = 0 / 0, y = 57, w = 800, h = 800 }, screens), nil)
    T.eq(Layout.clamp({ x = 0, y = 57, w = 800, h = 800 }, {}), nil)
  end)
end
