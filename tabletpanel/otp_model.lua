-- 2FA codes: base32/base64, otpauth:// links, Google Authenticator export links, TOTP codes and
-- when to copy them. Pure: HMAC comes in as a parameter (hs.hash on the Mac, openssl in tests).
local M = {}

local B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

-- Bits in, bytes out: shared by both decoders. `values` maps a character to its value.
local function decodeBits(s, values, bitsPerChar)
  local out, acc, nbits = {}, 0, 0
  for c in s:gmatch('.') do
    local v = values[c]
    if not v then return nil end
    acc = (acc << bitsPerChar) | v
    nbits = nbits + bitsPerChar
    if nbits >= 8 then
      nbits = nbits - 8
      out[#out + 1] = string.char((acc >> nbits) & 0xff)
      acc = acc & ((1 << nbits) - 1)
    end
  end
  return table.concat(out)
end

local function encodeBits(bytes, alphabet, bitsPerChar)
  local out, acc, nbits = {}, 0, 0
  local mask = (1 << bitsPerChar) - 1
  for i = 1, #bytes do
    acc = (acc << 8) | bytes:byte(i)
    nbits = nbits + 8
    while nbits >= bitsPerChar do
      nbits = nbits - bitsPerChar
      local v = (acc >> nbits) & mask
      out[#out + 1] = alphabet:sub(v + 1, v + 1)
    end
    acc = acc & ((1 << nbits) - 1)
  end
  if nbits > 0 then
    local v = (acc << (bitsPerChar - nbits)) & mask
    out[#out + 1] = alphabet:sub(v + 1, v + 1)
  end
  return table.concat(out)
end

local B32_VALUES, B64_VALUES = {}, {}
for i = 1, #B32 do B32_VALUES[B32:sub(i, i)] = i - 1 end
for i = 1, #B64 do B64_VALUES[B64:sub(i, i)] = i - 1 end
B64_VALUES['-'], B64_VALUES['_'] = 62, 63 -- the URL-safe alphabet

function M.base32Decode(s)
  return decodeBits(s:upper():gsub('[%s=]', ''), B32_VALUES, 5)
end

function M.base32Encode(bytes)
  return encodeBits(bytes, B32, 5)
end

function M.base64Decode(s)
  return decodeBits(s:gsub('[%s=]', ''), B64_VALUES, 6)
end

function M.base64Encode(bytes)
  local s = encodeBits(bytes, B64, 6)
  return s .. string.rep('=', (4 - #s % 4) % 4)
end

local function percentDecode(s)
  return (s:gsub('%%(%x%x)', function(h) return string.char(tonumber(h, 16)) end))
end

-- Form decoding (+ is a space), for labels.
function M.urlDecode(s)
  return percentDecode(s:gsub('+', ' '))
end

local function query(uri)
  local params = {}
  for k, v in (uri:match('%?(.*)$') or ''):gmatch('([^&=]+)=([^&]*)') do
    params[percentDecode(k):lower()] = percentDecode(v) -- a URI query: + is a + (base64 has them)
  end
  return params
end

local ALGORITHMS = { SHA1 = true, SHA256 = true, SHA512 = true }

-- otpauth://totp/<issuer:account>?secret=…&issuer=…&algorithm=…&digits=…&period=…
function M.parseOtpauth(uri)
  local kind, label = uri:match('^otpauth://(%a+)/([^?]*)')
  if kind and kind:lower() == 'hotp' then return nil, 'hotp' end
  if not kind or kind:lower() ~= 'totp' then return nil, 'invalid' end
  local p = query(uri)
  local secret = p.secret and p.secret:upper():gsub('[%s=]', '')
  if not secret or secret == '' or not M.base32Decode(secret) then return nil, 'invalid' end
  label = M.urlDecode(label)
  local labelIssuer, name = label:match('^([^:]*):%s*(.*)$')
  if not labelIssuer then name = label end
  local algorithm = (p.algorithm or 'SHA1'):upper()
  local digits = math.tointeger(tonumber(p.digits or '6'))
  local period = math.tointeger(tonumber(p.period or '30'))
  if not ALGORITHMS[algorithm] or (digits ~= 6 and digits ~= 8) or not period or period < 1 or period > 3600 then
    return nil, 'invalid'
  end
  return { issuer = p.issuer or labelIssuer or '', name = name, secret = secret,
    algorithm = algorithm, digits = digits, period = period }
end

-- Protobuf: the fields of one message as { [number] = { values… } }; nil if malformed.
local function readVarint(s, i)
  local n, shift = 0, 0
  while true do
    local b = s:byte(i)
    if not b or shift > 63 then return nil end
    n = n | ((b & 0x7f) << shift)
    i, shift = i + 1, shift + 7
    if b < 0x80 then return n, i end
  end
end

local function readMessage(s)
  local fields, i = {}, 1
  while i <= #s do
    local key, value
    key, i = readVarint(s, i)
    if not key then return nil end
    local num, wire = key >> 3, key & 7
    if wire == 0 then
      value, i = readVarint(s, i)
      if not value then return nil end
    elseif wire == 2 then
      local len
      len, i = readVarint(s, i)
      if not len or len < 0 or i + len - 1 > #s then return nil end
      value, i = s:sub(i, i + len - 1), i + len
    else
      return nil -- Google's export only uses varints and byte strings
    end
    fields[num] = fields[num] or {}
    table.insert(fields[num], value)
  end
  return fields
end

local function int32(n)
  n = (n or 0) & 0xffffffff -- callers check n is an integer
  return n >= 0x80000000 and n - 0x100000000 or n
end

local MIGRATION_ALGORITHMS = { [0] = 'SHA1', [1] = 'SHA1', [2] = 'SHA256', [3] = 'SHA512' }
local MIGRATION_DIGITS = { [0] = 6, [1] = 6, [2] = 8 }

-- otpauth-migration://offline?data=<base64 MigrationPayload>, from Google Authenticator's export.
function M.parseMigration(uri)
  local data = query(uri).data
  local bytes = data and M.base64Decode(data)
  local payload = bytes and readMessage(bytes)
  if not payload then return nil, 'invalid' end
  -- Every field must have the type the format says, or the payload is not Google's.
  local function fieldOf(fields, n, kind)
    local v = (fields[n] or {})[1]
    if v ~= nil and math.type(v) ~= kind and type(v) ~= kind then error('wrong type', 0) end
    return v
  end
  local ok, result = pcall(function()
    local accounts, skipped = {}, 0
    for _, raw in ipairs(payload[1] or {}) do
      local p = type(raw) == 'string' and readMessage(raw)
      if not p then error('bad account', 0) end
      local secret = fieldOf(p, 1, 'string')
      local name, issuer = fieldOf(p, 2, 'string') or '', fieldOf(p, 3, 'string') or ''
      local alg, digits, kind = fieldOf(p, 4, 'integer') or 0, fieldOf(p, 5, 'integer') or 0, fieldOf(p, 6, 'integer') or 0
      if not secret or secret == '' then error('no secret', 0) end
      local algorithm = MIGRATION_ALGORITHMS[alg]
      if kind == 1 or not algorithm then -- HOTP (counter-based), or MD5
        skipped = skipped + 1
      else
        if issuer ~= '' and name:sub(1, #issuer + 1) == issuer .. ':' then
          name = name:sub(#issuer + 2):gsub('^%s+', '')
        end
        accounts[#accounts + 1] = { issuer = issuer, name = name, secret = M.base32Encode(secret),
          algorithm = algorithm, digits = MIGRATION_DIGITS[digits] or 6, period = 30 }
      end
    end
    return { accounts = accounts, skipped = skipped, batchIndex = int32(fieldOf(payload, 4, 'integer')),
      batchSize = math.max(1, int32(fieldOf(payload, 3, 'integer'))), batchId = int32(fieldOf(payload, 5, 'integer')) }
  end)
  if not ok then return nil, 'invalid' end
  return result
end


-- Whatever the scanner read: a Google export link or a single-account link.
function M.parseImport(text)
  if type(text) ~= 'string' then return nil, 'not_otp' end
  if text:match('^otpauth%-migration://') then return M.parseMigration(text) end
  if not text:match('^otpauth://') then return nil, 'not_otp' end
  local account, reason = M.parseOtpauth(text)
  if not account and reason ~= 'hotp' then return nil, reason end
  return { accounts = { account }, skipped = account and 0 or 1, batchIndex = 0, batchSize = 1, batchId = 0 }
end

-- RFC 6238. hmac(algorithm, keyBytes, msgBytes) returns the raw digest.
function M.totp(account, unixSeconds, hmac)
  local counter = math.floor(unixSeconds / account.period)
  local digest = hmac(account.algorithm, M.base32Decode(account.secret), string.pack('>I8', counter))
  local offset = (digest:byte(#digest) & 0x0f) + 1
  local b1, b2, b3, b4 = digest:byte(offset, offset + 3)
  local n = ((b1 & 0x7f) << 24) | (b2 << 16) | (b3 << 8) | b4
  return string.format('%0' .. account.digits .. 'd', n % (10 ^ account.digits // 1))
end

-- A code with 3 s or less left would expire before it's pasted: wait for the next one.
local LAST_SECONDS = 3

function M.copyTiming(unixSeconds, period)
  local nextStart = (unixSeconds // period + 1) * period -- exact, so the next code is never missed
  local left = nextStart - unixSeconds
  if left > LAST_SECONDS then return { wait = 0, at = unixSeconds } end
  return { wait = left, at = nextStart }
end

function M.sameAccount(a, b)
  return a.secret == b.secret and a.issuer == b.issuer and a.name == b.name
end

return M
