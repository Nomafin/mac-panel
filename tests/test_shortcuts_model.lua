local Shortcuts = require('tabletpanel.shortcuts_model')

local config = {
  ['com.x.Code'] = {
    { 'Palette', { 'cmd', 'shift' }, 'p' },
    { 'Terminal', { 'ctrl' }, '`' },
    { 'Broken' }, -- no key: skipped
  },
  ['com.x.Many'] = {
    { 'a', {}, 'a' }, { 'b', {}, 'b' }, { 'c', {}, 'c' }, { 'd', {}, 'd' },
    { 'e', {}, 'e' }, { 'f', {}, 'f' }, { 'g', {}, 'g' },
  },
}

return function(T)
  T.test('buttons for the front app, valid entries only', function()
    T.eq(Shortcuts.buttons(config, 'com.x.Code'), {
      { label = 'Palette', mods = { 'cmd', 'shift' }, key = 'p' },
      { label = 'Terminal', mods = { 'ctrl' }, key = '`' },
    })
  end)

  T.test('at most six buttons', function()
    T.eq(#Shortcuts.buttons(config, 'com.x.Many'), 6)
  end)

  T.test('no set for the app gives an empty list', function()
    T.eq(Shortcuts.buttons(config, 'com.x.Other'), {})
    T.eq(Shortcuts.buttons(config, nil), {})
  end)
end
