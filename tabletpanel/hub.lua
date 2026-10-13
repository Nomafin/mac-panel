-- Module registry, change detection and the WebSocket message protocol.
-- Pure: no hs.* calls; the server injects send/log.
local json = require('tabletpanel.json')
local util = require('tabletpanel.util')

local Hub = {}
Hub.__index = Hub

-- opts.send(string): push a message to the WebSocket client
-- opts.log(string): optional logger
function Hub.new(opts)
  return setmetatable({
    modules = {}, order = {}, versions = {}, last = {},
    send = opts.send, log = opts.log or function() end,
  }, Hub)
end

function Hub:register(mod)
  self.modules[mod.name] = mod
  self.order[#self.order + 1] = mod.name
  self.versions[mod.name] = 0
end

function Hub:stateMessage(name)
  return { type = 'state', module = name, v = self.versions[name], data = self.last[name] }
end

-- Recompute a module's state; bump its version if it changed. Returns true when changed.
function Hub:refresh(name)
  local ok, state = pcall(self.modules[name].state)
  if not ok then
    self.log('state() failed for ' .. name .. ': ' .. tostring(state))
    return false
  end
  if self.versions[name] > 0 and util.deepEqual(state, self.last[name]) then return false end
  self.last[name] = state
  self.versions[name] = self.versions[name] + 1
  return true
end

function Hub:notify(name)
  if not self:refresh(name) then return end
  local ok, err = pcall(self.send, json.encode(self:stateMessage(name)))
  if not ok then self.log('send failed: ' .. tostring(err)) end
end

local function ensureFresh(self, name)
  if self.versions[name] == 0 then self:refresh(name) end
end

function Hub:snapshot()
  local out = { versions = {} }
  for _, name in ipairs(self.order) do
    ensureFresh(self, name)
    out[name] = self.last[name]
    out.versions[name] = self.versions[name]
  end
  return out
end

-- State messages for every module whose version differs from the client's.
function Hub:updatesFor(clientVersions)
  local updates = json.array({})
  for _, name in ipairs(self.order) do
    ensureFresh(self, name)
    if self.versions[name] > 0 and clientVersions[name] ~= self.versions[name] then
      updates[#updates + 1] = self:stateMessage(name)
    end
  end
  return updates
end

local function reply(id, ok, extra)
  local msg = { type = 'reply', id = id, ok = ok }
  for k, v in pairs(extra or {}) do msg[k] = v end
  return json.encode(msg)
end

function Hub:handleMessage(raw)
  local decoded, msg = pcall(json.decode, raw)
  if not decoded or type(msg) ~= 'table' or type(msg.cmd) ~= 'string' then
    return reply(nil, false, { error = 'bad_request' })
  end
  local id, args = msg.id, type(msg.args) == 'table' and msg.args or {}

  if msg.cmd == 'hello' then
    self.log('client hello: ' .. tostring(args.ua))
    return reply(id, true, { updates = self:updatesFor({}) })
  end
  if msg.cmd == 'ping' then
    return reply(id, true, { updates = self:updatesFor(type(msg.versions) == 'table' and msg.versions or {}) })
  end

  local modName, action = msg.cmd:match('^([%w_]+)%.([%w_]+)$')
  local mod = modName and self.modules[modName]
  local fn = mod and mod.actions and mod.actions[action]
  if not fn then return reply(id, false, { error = 'unknown_command' }) end

  local called, ok, err = pcall(fn, args)
  if not called then
    self.log('action ' .. msg.cmd .. ' failed: ' .. tostring(ok))
    return reply(id, false, { error = 'internal_error' })
  end
  if not ok then return reply(id, false, { error = err or 'failed' }) end

  self:notify(modName)
  return reply(id, true, { updates = json.array({ self:stateMessage(modName) }) })
end

return Hub
