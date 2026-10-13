-- Tablet control panel: serves the tablet UI and pushes Mac state to it over a WebSocket.
-- Usage in ~/.hammerspoon/init.lua:
--   tabletpanel = require("tabletpanel").start({ homeRouterMACs = { "aa:bb:cc:dd:ee:ff" } })
local Hub = require('tabletpanel.hub')
local Server = require('tabletpanel.server')
local netguard = require('tabletpanel.netguard')
local windows = require('tabletpanel.windows')

local M = {}

M.config = {
  port = 8765,
  homeRouterMACs = {}, -- empty = netguard disabled, server always on
}

local DIR = debug.getinfo(1, 'S').source:match('^@(.*/)')
local log = hs.logger.new('tabletpanel', 'info')

function M.start(overrides)
  for k, v in pairs(overrides or {}) do M.config[k] = v end

  M.modules = { windows }
  local server
  local hub = Hub.new({
    send = function(message) server:send(message) end,
    log = function(message) log.i(message) end,
  })
  server = Server.new({ port = M.config.port, webDir = DIR .. 'web/', hub = hub, icon = windows.icon, log = log })
  for _, mod in ipairs(M.modules) do hub:register(mod) end

  local active = false
  local function setActive(on)
    if on == active then return end
    active = on
    if on then
      for _, mod in ipairs(M.modules) do
        local ok, err = pcall(mod.start, function() hub:notify(mod.name) end, log)
        if not ok then log.e('module ' .. mod.name .. ' failed to start: ' .. tostring(err)) end
      end
      server:start()
      log.i('listening on port ' .. M.config.port)
    else
      server:stop()
      for _, mod in ipairs(M.modules) do mod.stop() end
      log.i('server stopped')
    end
  end

  netguard.start({ macs = M.config.homeRouterMACs, onChange = setActive, log = log })
  M.hub, M.server = hub, server
  return M
end

return M
