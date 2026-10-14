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
end
