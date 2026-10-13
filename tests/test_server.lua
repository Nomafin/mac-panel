local Server = require('tabletpanel.server')
local json = require('tabletpanel.json')

local function make()
  local files = {
    ['/web/index.html'] = '<html>hi</html>',
    ['/web/app.js'] = 'console.log(1)',
    ['/web/app.css'] = 'body{}',
  }
  local icons = { ['com.apple.Safari'] = '\137PNG\r\n\26\n' }
  return Server.new({
    webDir = '/web/',
    hub = { snapshot = function() return { versions = { windows = 3 } } end },
    readFile = function(p) return files[p] end,
    icon = function(b) return icons[b] end,
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
    local _, _, js = s:route('GET', '/app.js')
    local _, _, css = s:route('GET', '/app.css')
    T.eq(js['Content-Type'], 'application/javascript; charset=utf-8')
    T.eq(css['Content-Type'], 'text/css; charset=utf-8')
  end)

  T.test('only whitelisted files are served', function()
    local s = make()
    for _, path in ipairs({ '/missing.js', '/../init.lua', '/%2e%2e/init.lua', '/web/app.js', '/init.lua' }) do
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
end
