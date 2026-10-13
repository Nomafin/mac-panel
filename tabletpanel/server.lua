-- HTTP + WebSocket server: static UI files, app icons, debug state, and the /ws protocol.
-- route() is pure; hs.httpserver is only touched in start/stop/send.
local json = require('tabletpanel.json')

local Server = {}
Server.__index = Server

local PLAIN = { ['Content-Type'] = 'text/plain; charset=utf-8' }
local STATIC = { ['/'] = 'index.html', ['/index.html'] = 'index.html', ['/app.css'] = 'app.css', ['/app.js'] = 'app.js' }
local TYPES = {
  html = 'text/html; charset=utf-8',
  css = 'text/css; charset=utf-8',
  js = 'application/javascript; charset=utf-8',
}

local function readFile(path)
  local f = io.open(path, 'rb')
  if not f then return nil end
  local body = f:read('a')
  f:close()
  return body
end

-- opts: port, webDir (trailing slash), hub, icon(bundleId) -> png|nil, log (hs.logger), readFile
function Server.new(opts)
  opts.readFile = opts.readFile or readFile
  return setmetatable({ opts = opts }, Server)
end

function Server:route(method, path)
  if method ~= 'GET' then return 'method not allowed', 405, PLAIN end
  local clean = path:match('^[^?#]*')

  local file = STATIC[clean]
  if file then
    local body = self.opts.readFile(self.opts.webDir .. file)
    if not body then return 'not found', 404, PLAIN end
    return body, 200, { ['Content-Type'] = TYPES[file:match('%.(%w+)$')], ['Cache-Control'] = 'no-store' }
  end

  if clean == '/api/state' then
    return json.encode(self.opts.hub:snapshot()), 200,
      { ['Content-Type'] = 'application/json', ['Cache-Control'] = 'no-store' }
  end

  local bundleId = clean:match('^/icon/([%w%.%-_]+)%.png$')
  local png = bundleId and self.opts.icon and self.opts.icon(bundleId)
  if png then
    return png, 200, { ['Content-Type'] = 'image/png', ['Cache-Control'] = 'max-age=86400' }
  end

  return 'not found', 404, PLAIN
end

function Server:start()
  if self.http then return end
  local http = hs.httpserver.new(false, false)
  http:setPort(self.opts.port)
  http:setCallback(function(method, path)
    local ok, body, status, headers = pcall(self.route, self, method, path)
    if not ok then
      self.opts.log.e('http error: ' .. tostring(body))
      return 'internal error', 500, PLAIN
    end
    return body, status, headers
  end)
  http:websocket('/ws', function(message)
    local ok, reply = pcall(self.opts.hub.handleMessage, self.opts.hub, message)
    if not ok then
      self.opts.log.e('ws error: ' .. tostring(reply))
      return '{"type":"reply","ok":false,"error":"internal_error"}'
    end
    return reply
  end)
  http:start()
  self.http = http
end

function Server:send(message)
  if self.http then self.http:send(message) end
end

function Server:stop()
  if self.http then
    self.http:stop()
    self.http = nil
  end
end

return Server
