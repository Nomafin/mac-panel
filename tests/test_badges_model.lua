local Badges = require('tabletpanel.badges_model')
local json = require('tabletpanel.json')

return function(T)
  T.test('turns Dock item URLs into app paths', function()
    T.eq(Badges.pathFromUrl('file:///Applications/Slack.app/'), '/Applications/Slack.app')
    T.eq(Badges.pathFromUrl('file:///Applications/Microsoft%20Outlook.app/'), '/Applications/Microsoft Outlook.app')
    T.eq(Badges.pathFromUrl('https://example.com'), nil)
    T.eq(Badges.pathFromUrl(nil), nil)
  end)

  T.test('collects badges by bundle id, skipping items without one', function()
    local bundles = { ['/Applications/Slack.app'] = 'com.tinyspeck.slackmacgap', ['/Applications/Mail.app'] = 'com.apple.mail' }
    local items = {
      { url = 'file:///Applications/Slack.app/', label = '3' },
      { url = 'file:///Applications/Mail.app/', label = nil },
      { url = 'file:///Applications/Mail.app/', label = '' },
      { url = 'file:///Applications/Unknown.app/', label = '1' },
      { url = 'file:///Applications/Mail.app/', label = '•' },
    }
    T.eq(Badges.collect(items, function(p) return bundles[p] end), {
      { bundleId = 'com.apple.mail', label = '•' },
      { bundleId = 'com.tinyspeck.slackmacgap', label = '3' },
    })
  end)

  T.test('no badges encodes as an empty array', function()
    T.eq(json.encode({ items = Badges.collect({}, function() end) }), '{"items":[]}')
  end)
end
