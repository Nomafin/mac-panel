-- 2FA codes for the tablet's Authenticator page. The accounts' secrets stay on the Mac, in the
-- login Keychain; the tablet only gets names, and a tap puts the code on the Mac's clipboard.
-- Importing, renaming and removing happen on the Mac (authenticator_ui.lua), never over the network.
local Otp = require('tabletpanel.otp_model')
local json = require('tabletpanel.json')

local A = { name = 'authenticator', actions = {} }

A.keychainService = 'mac-panel.authenticator'
local CLEAR_SECONDS = 30
-- `security -i` cuts lines at about 4 KB, so the value is stored in numbered parts:
-- accounts.1, accounts.2, … (as many as needed; reading stops at the first missing one).
local CHUNK = 3000

local function shellQuote(s) return "'" .. s:gsub("'", "'\\''") .. "'" end

local function readPart(n)
  local p = io.popen(string.format('/usr/bin/security find-generic-password -s %s -a accounts.%d -w 2>/dev/null',
    shellQuote(A.keychainService), n))
  local out = p:read('a')
  local ok, _, code = p:close()
  if ok then return (out:gsub('%s+$', '')) end
  return nil, code == 44 and 'missing' or 'error' -- 44: no such item
end

local function readKeychain()
  local parts = {}
  while true do
    local part, err = readPart(#parts + 1)
    if not part then
      if err ~= 'missing' then return nil, 'error' end
      if #parts == 0 then return nil, 'missing' end
      return table.concat(parts)
    end
    parts[#parts + 1] = part
  end
end

-- `security -i` reads the commands from stdin, so the secrets never show up in a process list.
-- The value is base64, which needs no quoting there. Read back to be sure it was saved.
local function deleteParts(from)
  local n = from
  while readPart(n) do
    os.execute(string.format('/usr/bin/security delete-generic-password -s %s -a accounts.%d >/dev/null 2>&1',
      shellQuote(A.keychainService), n))
    n = n + 1
  end
end

local function writeKeychain(value)
  local p = io.popen('/usr/bin/security -i >/dev/null 2>&1', 'w')
  local count = math.max(1, math.ceil(#value / CHUNK))
  for n = 1, count do
    p:write(string.format('add-generic-password -U -s %s -a accounts.%d -l "Mac Panel authenticator" -w %s\n',
      A.keychainService, n, value:sub((n - 1) * CHUNK + 1, n * CHUNK)))
  end
  p:close()
  deleteParts(count + 1) -- parts left over from a longer list
  return readKeychain() == value
end

local function randomId()
  local f = io.open('/dev/urandom', 'rb')
  local bytes = f:read(8)
  f:close()
  return (bytes:gsub('.', function(c) return string.format('%02x', c:byte()) end))
end

A.keychain = { read = readKeychain, write = writeKeychain, delete = function() deleteParts(1) end } -- for checking against the real Keychain

A.deps = {
  readKeychain = readKeychain,
  writeKeychain = writeKeychain,
  deleteKeychain = function() deleteParts(1) end,
  setClipboard = function(s) hs.pasteboard.setContents(s) end,
  getClipboard = function() return hs.pasteboard.getContents() end,
  clearClipboard = function() hs.pasteboard.clearContents() end,
  now = function() return hs.timer.secondsSinceEpoch() end,
  after = function(seconds, fn) return hs.timer.doAfter(seconds, fn) end,
  hmac = function(algorithm, key, msg)
    return hs.hash.new('hmac' .. algorithm, key):append(msg):finish():value(true)
  end,
  randomId = randomId,
  startUI = function(mod) require('tabletpanel.authenticator_ui').start(mod) end,
  stopUI = function() require('tabletpanel.authenticator_ui').stop() end,
}

local accounts = {}
local readable = true -- false when the Keychain item exists but can't be read: never overwrite it
local lastSaved -- the Keychain value as last read or written, to put back if a save fails halfway
local notify, log = function() end, nil
local copied, seq = nil, 0
local waitTimer, clearTimer, pendingClear

local function warn(message)
  if log then log.w('authenticator: ' .. message) end
end

local function valid(a)
  return type(a) == 'table' and type(a.id) == 'string' and type(a.secret) == 'string'
    and a.secret ~= '' and Otp.base32Decode(a.secret) ~= nil
    and math.tointeger(a.period) and a.period > 0 and a.period <= 3600
    and (a.digits == 6 or a.digits == 8)
    and (a.algorithm == 'SHA1' or a.algorithm == 'SHA256' or a.algorithm == 'SHA512')
end

local function load()
  accounts, readable, lastSaved = {}, true, nil
  local stored, err = A.deps.readKeychain()
  if not stored then
    if err ~= 'missing' then
      readable = false
      warn('could not read the Keychain item ' .. A.keychainService)
    end
    return
  end
  local bytes = Otp.base64Decode(stored)
  local ok, list = pcall(json.decode, bytes or '')
  if not bytes or not ok or type(list) ~= 'table' then
    readable = false
    warn('the Keychain item ' .. A.keychainService .. ' is not readable; leaving it untouched')
    return
  end
  lastSaved = stored
  for _, a in ipairs(list) do
    if valid(a) then
      accounts[#accounts + 1] = { id = a.id, issuer = tostring(a.issuer or ''), name = tostring(a.name or ''),
        secret = a.secret, algorithm = a.algorithm, digits = math.tointeger(a.digits), period = math.tointeger(a.period) }
    end
  end
end

-- A save that fails (maybe halfway through the parts) puts the previous value back, so the
-- Keychain never keeps a mix of old and new parts.
local function save()
  local ok, saved = pcall(function()
    local value = Otp.base64Encode(json.encode(json.array(accounts)))
    if A.deps.writeKeychain(value) then return value end
  end)
  if ok and saved then
    lastSaved = saved
    return true
  end
  warn('saving to the Keychain failed' .. (ok and '' or ': ' .. tostring(saved)))
  pcall(function()
    if lastSaved then A.deps.writeKeychain(lastSaved) else A.deps.deleteKeychain() end
  end)
  return false
end

local function find(id)
  for i, a in ipairs(accounts) do
    if a.id == id then return a, i end
  end
end

-- Clear the clipboard now if it still holds the copied code (and only then).
local function runPendingClear()
  if pendingClear and A.deps.getClipboard() == pendingClear then A.deps.clearClipboard() end
  pendingClear = nil
end

local function cancelTimers()
  if waitTimer then waitTimer:stop(); waitTimer = nil end
  if clearTimer then clearTimer:stop(); clearTimer = nil end
end

function A.start(notifyFn, logger)
  notify, log = notifyFn or function() end, logger
  load()
  A.deps.startUI(A)
end

function A.stop()
  cancelTimers()
  runPendingClear()
  A.deps.stopUI()
  accounts, copied = {}, nil
end

-- Names only: the tablet never sees a secret or a code.
function A.list()
  local out = json.array({})
  for _, a in ipairs(accounts) do
    out[#out + 1] = { id = a.id, issuer = a.issuer, name = a.name, period = a.period }
  end
  return out
end

function A.state()
  return { accounts = A.list(), copied = copied and { id = copied.id, seq = copied.seq, status = copied.status } }
end

-- args: { id }. Copies at once, or waits for the next code when this one is about to expire.
function A.actions.copy(args)
  local account = find(args.id)
  if not account then return false, 'unknown_account' end
  cancelTimers()
  seq = seq + 1
  local mine = seq
  local timing = Otp.copyTiming(A.deps.now(), account.period)

  local function copyNow()
    runPendingClear() -- an earlier code still on the clipboard goes before the new one lands
    local code = Otp.totp(account, timing.at, A.deps.hmac)
    A.deps.setClipboard(code)
    pendingClear = code
    copied = { id = account.id, seq = mine, status = 'copied' }
    clearTimer = A.deps.after(CLEAR_SECONDS, function()
      clearTimer = nil
      runPendingClear()
      copied = nil
      notify()
    end)
  end

  if timing.wait > 0 then
    copied = { id = account.id, seq = mine, status = 'waiting' }
    waitTimer = A.deps.after(timing.wait, function()
      waitTimer = nil
      copyNow()
      notify()
    end)
  else
    copyNow()
  end
  return true
end

-- The scanner's text: an export or single-account link. Called from the scanner window only.
function A.importText(text)
  if not readable then return { ok = false, error = 'keychain_unreadable' } end
  local parsed, err = Otp.parseImport(text)
  if not parsed then return { ok = false, error = err } end
  local imported, duplicates, before = 0, 0, #accounts
  for _, incoming in ipairs(parsed.accounts) do
    local known = false
    for _, a in ipairs(accounts) do
      if Otp.sameAccount(a, incoming) then known = true; break end
    end
    if known then
      duplicates = duplicates + 1
    else
      incoming.id = A.deps.randomId()
      accounts[#accounts + 1] = incoming
      imported = imported + 1
    end
  end
  if imported > 0 then
    if not save() then
      for i = #accounts, before + 1, -1 do accounts[i] = nil end
      return { ok = false, error = 'save_failed' }
    end
    notify()
  end
  return { ok = true, imported = imported, duplicates = duplicates, skipped = parsed.skipped,
    batchIndex = parsed.batchIndex, batchSize = parsed.batchSize, batchId = parsed.batchId }
end

local function change(id, apply)
  if not readable then return false end
  local account, index = find(id)
  if not account then return false end
  local undo = {}
  for k, v in pairs(account) do undo[k] = v end
  apply(account, index)
  if not save() then
    if index and not find(id) then table.insert(accounts, index, undo) else
      for k, v in pairs(undo) do account[k] = v end
    end
    return false
  end
  notify()
  return true
end

function A.rename(id, issuer, name)
  return change(id, function(account) account.issuer, account.name = issuer, name end)
end

function A.remove(id)
  return change(id, function(_, index) table.remove(accounts, index) end)
end

return A
