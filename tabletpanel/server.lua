-- HTTP + WebSocket server: static UI files, app icons, debug state, and the /ws protocol.
-- route() is pure; hs.httpserver is only touched in start/stop/send.
local json = require('tabletpanel.json')

local Server = {}
Server.__index = Server

local PLAIN = { ['Content-Type'] = 'text/plain; charset=utf-8' }
local STATIC = { ['/'] = 'index.html', ['/index.html'] = 'index.html' }
local TYPES = {
  html = 'text/html; charset=utf-8',
  css = 'text/css; charset=utf-8',
  js = 'application/javascript; charset=utf-8',
  woff2 = 'font/woff2',
}
local FOLDERS = { js = 'js', css = 'css', fonts = 'woff2' } -- folder -> the one extension it serves

local function readFile(path)
  local f = io.open(path, 'rb')
  if not f then return nil end
  local body = f:read('a')
  f:close()
  return body
end

-- opts: port, webDir (trailing slash), hub, icon(bundleId) -> png|nil, thumb(windowId) -> jpeg|nil,
--       log (hs.logger), readFile
function Server.new(opts)
  opts.readFile = opts.readFile or readFile
  return setmetatable({ opts = opts }, Server)
end

function Server:route(method, path)
  if method ~= 'GET' then return 'method not allowed', 405, PLAIN end
  local clean = path:match('^[^?#]*')

  -- The page itself, plus its scripts, styles and fonts: /js/<name>.js, /css/<name>.css and
  -- /fonts/<name>.woff2, where the name is letters, digits and dashes only (no dots, so no way
  -- out of the folder).
  local file = STATIC[clean]
  if not file then
    local dir, name, ext = clean:match('^/(%a+)/([%w%-]+)%.(%w+)$')
    if dir and FOLDERS[dir] == ext then file = dir .. '/' .. name .. '.' .. ext end
  end
  if file then
    local body = self.opts.readFile(self.opts.webDir .. file)
    if not body then return 'not found', 404, PLAIN end
    local ext = file:match('%.(%w+)$')
    -- Fonts never change; the page's own files must update on the next reload.
    return body, 200, { ['Content-Type'] = TYPES[ext], ['Cache-Control'] = ext == 'woff2' and 'max-age=86400' or 'no-store' }
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

  local winId = clean:match('^/thumb/(%d+)%.jpg$')
  local jpeg = winId and self.opts.thumb and self.opts.thumb(tonumber(winId))
  if jpeg then
    return jpeg, 200, { ['Content-Type'] = 'image/jpeg', ['Cache-Control'] = 'no-store' }
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
