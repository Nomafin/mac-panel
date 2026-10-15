local Server = require('tabletpanel.server')
local json = require('tabletpanel.json')

local function make()
  local files = {
    ['/web/index.html'] = '<html>hi</html>',
    ['/web/js/main.js'] = 'console.log(1)',
    ['/web/js/map-page.js'] = 'export {}',
    ['/web/css/base.css'] = 'body{}',
    ['/web/fonts/bricolage-latin.woff2'] = 'wOF2',
  }
  local icons = { ['com.apple.Safari'] = '\137PNG\r\n\26\n' }
  return Server.new({
    webDir = '/web/',
    hub = { snapshot = function() return { versions = { windows = 3 } } end },
    readFile = function(p) return files[p] end,
    icon = function(b) return icons[b] end,
    thumb = function(id) return id == 42 and '\255\216\255' or nil end,
    log = {},
  })
end

return function(T)
  T.test('serves index for / and ignores the query string', function()
    local s = make()
    for _, path in ipairs({ '/', '/?mock', '/index.html' }) do
      local body, status, headers = s:route('GET', path)
      T.eq({ body, status }, { '<html>hi</html>', 200 }, path)
      T.eq(headers['Content-Type'], 'text/html; charset=utf-8')
      T.eq(headers['Cache-Control'], 'no-store')
    end
  end)

  T.test('serves js and css with the right types', function()
    local s = make()
    local jsBody, jsStatus, js = s:route('GET', '/js/main.js')
    local _, _, css = s:route('GET', '/css/base.css')
    T.eq({ jsBody, jsStatus }, { 'console.log(1)', 200 })
    T.eq(js['Content-Type'], 'application/javascript; charset=utf-8')
    T.eq(js['Cache-Control'], 'no-store')
    T.eq(css['Content-Type'], 'text/css; charset=utf-8')
    T.eq(select(2, s:route('GET', '/js/map-page.js')), 200)
  end)

  T.test('serves woff2 fonts, cached for a day', function()
    local body, status, headers = make():route('GET', '/fonts/bricolage-latin.woff2')
    T.eq({ body, status }, { 'wOF2', 200 })
    T.eq(headers['Content-Type'], 'font/woff2')
    T.eq(headers['Cache-Control'], 'max-age=86400')
  end)

  T.test('only whitelisted files are served', function()
    local s = make()
    for _, path in ipairs({ '/missing.js', '/../init.lua', '/%2e%2e/init.lua', '/web/js/main.js', '/init.lua',
      '/js/../init.lua', '/js/main.css', '/css/base.js', '/js/sub/x.js', '/js/.hidden.js', '/js/missing.js',
      '/fonts/OFL.txt', '/fonts/x.js', '/js/x.woff2', '/fonts/../init.woff2' }) do
      local _, status = s:route('GET', path)
      T.eq(status, 404, path)
    end
  end)

  T.test('missing file on disk is a 404', function()
    local s = make()
    s.opts.readFile = function() return nil end
    local _, status = s:route('GET', '/')
    T.eq(status, 404)
  end)

  T.test('non-GET is rejected', function()
    local _, status = make():route('POST', '/')
    T.eq(status, 405)
  end)

  T.test('api/state returns the hub snapshot as JSON', function()
    local body, status, headers = make():route('GET', '/api/state')
    T.eq(status, 200)
    T.eq(headers['Content-Type'], 'application/json')
    T.eq(json.decode(body), { versions = { windows = 3 } })
  end)

  T.test('serves app icons as cached PNG', function()
    local body, status, headers = make():route('GET', '/icon/com.apple.Safari.png')
    T.eq({ body, status }, { '\137PNG\r\n\26\n', 200 })
    T.eq(headers['Content-Type'], 'image/png')
    T.eq(headers['Cache-Control'], 'max-age=86400')
  end)

  T.test('unknown or malformed icon requests are 404', function()
    local s = make()
    for _, path in ipairs({ '/icon/com.unknown.png', '/icon/../x.png', '/icon/a b.png' }) do
      local _, status = s:route('GET', path)
      T.eq(status, 404, path)
    end
  end)

  T.test('serves window previews as uncached JPEG', function()
    local body, status, headers = make():route('GET', '/thumb/42.jpg?t=123')
    T.eq({ body, status, headers['Content-Type'], headers['Cache-Control'] }, { '\255\216\255', 200, 'image/jpeg', 'no-store' })
  end)

  T.test('missing or malformed previews are 404', function()
    for _, path in ipairs({ '/thumb/7.jpg', '/thumb/x.jpg', '/thumb/42.png' }) do
      local _, status = make():route('GET', path)
      T.eq(status, 404, path)
    end
  end)
end
