-- Tablet control panel: serves the tablet UI and pushes Mac state to it over a WebSocket.
-- Usage in ~/.hammerspoon/init.lua:
--   tabletpanel = require("tabletpanel").start({ homeRouterMACs = { "aa:bb:cc:dd:ee:ff" } })
-- Every key of M.config can be set there.
local Hub = require('tabletpanel.hub')
local Server = require('tabletpanel.server')
local netguard = require('tabletpanel.netguard')
local windows = require('tabletpanel.windows')
local spotify = require('tabletpanel.spotify')
local display = require('tabletpanel.display')
local badges = require('tabletpanel.badges')
local mic = require('tabletpanel.mic')
local system = require('tabletpanel.system')
local shortcutButtons = require('tabletpanel.shortcut_buttons')
local pad = require('tabletpanel.pad')
local Settings = require('tabletpanel.settings')
local authenticator = require('tabletpanel.authenticator')

local M = {}

M.config = {
  port = 8765,
  homeRouterMACs = {}, -- empty = netguard disabled, server always on
  -- The tablet's clock, in PHP date() letters (H, G, h, g, i, A, a; d, j, D, m, n, M, Y, y).
  timeFormat = 'H:i',  -- e.g. 'g:i A' for 9:05 AM
  dateFormat = nil,    -- e.g. 'd.m.Y' or 'D, M j'; nil = the tablet's language decides
}

local DIR = debug.getinfo(1, 'S').source:match('^@(.*/)')
local log = hs.logger.new('tabletpanel', 'info')

function M.start(overrides)
  for k, v in pairs(overrides or {}) do M.config[k] = v end

  M.modules = { windows, spotify, display, badges, mic, system, shortcutButtons, pad, authenticator, Settings.new(M.config) }
  local server
  local hub = Hub.new({
    send = function(message) server:send(message) end,
    log = function(message) log.i(message) end,
  })
  server = Server.new({ port = M.config.port, webDir = DIR .. 'web/', hub = hub, icon = windows.icon, thumb = windows.thumb, log = log })
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
