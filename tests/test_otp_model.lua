local M = require('tabletpanel.otp_model')

-- HMAC for the tests: macOS's openssl, since plain Lua has none. The message goes through a temp
-- file because it's binary.
local function hmac(alg, key, msg)
  local path = os.tmpname()
  local f = assert(io.open(path, 'wb'))
  f:write(msg)
  f:close()
  local hex = key:gsub('.', function(c) return string.format('%02x', c:byte()) end)
  local p = io.popen(string.format('openssl dgst -%s -mac HMAC -macopt hexkey:%s -binary < %s',
    alg:lower(), hex, path))
  local out = p:read('a')
  p:close()
  os.remove(path)
  return out
end

-- A tiny protobuf writer, to build Google Authenticator export payloads.
local function varint(n)
  local out = {}
  repeat
    local b = n & 0x7f
    n = n >> 7 -- logical shift: negative numbers become 10 bytes, as protobuf encodes int32
    out[#out + 1] = string.char(n ~= 0 and (b | 0x80) or b)
  until n == 0
  return table.concat(out)
end
local function field(num, value)
  if type(value) == 'number' then return varint(num << 3) .. varint(value) end
  return varint((num << 3) | 2) .. varint(#value) .. value
end
local function otp(p)
  return field(1, p.secret) .. field(2, p.name) .. (p.issuer and field(3, p.issuer) or '')
    .. field(4, p.algorithm or 0) .. field(5, p.digits or 0) .. field(6, p.type or 2)
end

local function migrationUri(payload)
  local b64 = M.base64Encode(payload)
  return 'otpauth-migration://offline?data=' .. b64:gsub('[+/=]', function(c)
    return string.format('%%%02X', c:byte())
  end)
end

return function(T)
  T.test('base32 decodes RFC 4648 vectors, lowercase and spaces', function()
    T.eq(M.base32Decode(''), '')
    T.eq(M.base32Decode('MY======'), 'f')
    T.eq(M.base32Decode('MZXW6YTBOI======'), 'foobar')
    T.eq(M.base32Decode('mzxw 6ytb oi'), 'foobar')
    T.eq(M.base32Decode('MZ1W'), nil)
  end)

  T.test('base32 encodes without padding and round-trips', function()
    T.eq(M.base32Encode('foobar'), 'MZXW6YTBOI')
    T.eq(M.base32Encode(''), '')
    local bytes = '\0\1\2\255\128hello'
    T.eq(M.base32Decode(M.base32Encode(bytes)), bytes)
  end)

  T.test('base64 decodes standard and URL alphabets, with or without padding', function()
    T.eq(M.base64Decode('Zm9vYmFy'), 'foobar')
    T.eq(M.base64Decode('Zm9vYg=='), 'foob')
    T.eq(M.base64Decode('Zm9vYg'), 'foob')
    T.eq(M.base64Decode('-_8='), '\251\255')
    T.eq(M.base64Decode('+/8='), '\251\255')
    T.eq(M.base64Decode('Zm9v!'), nil)
    T.eq(M.base64Encode('foob'), 'Zm9vYg==')
  end)

  T.test('urlDecode turns %XX and + back into characters', function()
    T.eq(M.urlDecode('a%2Bb%2F%3D%20c+d'), 'a+b/= c d')
  end)

  T.test('otpauth: label forms, parameter precedence and defaults', function()
    T.eq(M.parseOtpauth('otpauth://totp/GitHub:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'),
      { issuer = 'GitHub', name = 'me@example.com', secret = 'JBSWY3DPEHPK3PXP', algorithm = 'SHA1', digits = 6, period = 30 })
    T.eq(M.parseOtpauth('otpauth://totp/Old:me?secret=jbswy3dpehpk3pxp&issuer=New&algorithm=SHA256&digits=8&period=60'),
      { issuer = 'New', name = 'me', secret = 'JBSWY3DPEHPK3PXP', algorithm = 'SHA256', digits = 8, period = 60 })
    T.eq(M.parseOtpauth('otpauth://totp/justme?secret=JBSWY3DPEHPK3PXP'),
      { issuer = '', name = 'justme', secret = 'JBSWY3DPEHPK3PXP', algorithm = 'SHA1', digits = 6, period = 30 })
  end)

  T.test('otpauth: HOTP and broken links are refused', function()
    T.eq({ M.parseOtpauth('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1') }, { nil, 'hotp' })
    T.eq({ M.parseOtpauth('otpauth://totp/x?issuer=a') }, { nil, 'invalid' })
    T.eq({ M.parseOtpauth('otpauth://totp/x?secret=not*base32') }, { nil, 'invalid' })
    T.eq({ M.parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=7') }, { nil, 'invalid' })
    for _, bad in ipairs({ 'period=1e400', 'period=0.5', 'period=2.5', 'period=99999', 'digits=8.5' }) do
      T.eq({ M.parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&' .. bad) }, { nil, 'invalid' }, bad)
    end
    -- "6.0" is six: kept as a whole number, so codes are zero-padded, not space-padded
    T.eq(math.type(M.parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=6.0').digits), 'integer')
  end)

  T.test('migration: decodes accounts, skips HOTP, reads the batch fields', function()
    local payload = field(1, otp({ secret = 'abcdefghij', name = 'GitHub:me', issuer = 'GitHub' }))
      .. field(1, otp({ secret = '0123456789', name = 'counter', type = 1 }))
      .. field(1, otp({ secret = 'zyxwvutsrq', name = 'admin', issuer = 'AWS', algorithm = 2, digits = 2 }))
      .. field(2, 1) .. field(3, 3) .. field(4, 1) .. field(5, -5)
    local r = M.parseMigration(migrationUri(payload))
    T.eq(r, {
      accounts = {
        { issuer = 'GitHub', name = 'me', secret = M.base32Encode('abcdefghij'), algorithm = 'SHA1', digits = 6, period = 30 },
        { issuer = 'AWS', name = 'admin', secret = M.base32Encode('zyxwvutsrq'), algorithm = 'SHA256', digits = 8, period = 30 },
      },
      skipped = 1, batchIndex = 1, batchSize = 3, batchId = -5,
    })
  end)

  T.test('migration: a name with another issuer prefix is kept as it is', function()
    local payload = field(1, otp({ secret = 'abcdefghij', name = 'Other:me', issuer = 'GitHub' }))
    T.eq(M.parseMigration(migrationUri(payload)).accounts[1].name, 'Other:me')
  end)

  T.test('migration: fields of the wrong type are invalid, not a crash', function()
    local wrongName = field(1, field(1, 'abcdefghij') .. field(2, 5) .. field(3, 7))
    local wrongBatch = field(1, otp({ secret = 'abcdefghij', name = 'me' })) .. field(3, 'x') .. field(5, 'y')
    local wrongSecret = field(1, field(1, 3) .. field(2, 'me'))
    local emptySecret = field(1, otp({ secret = '', name = 'me' }))
    for _, payload in ipairs({ wrongName, wrongBatch, wrongSecret, emptySecret }) do
      T.eq({ M.parseMigration(migrationUri(payload)) }, { nil, 'invalid' })
    end
  end)

  T.test('migration: a literal + in the data is base64, not a space', function()
    local secret, b64
    for pad = 0, 2 do -- a secret whose payload's base64 has a + in it (0xfbefbe is '++++' when aligned)
      secret = string.rep('a', pad) .. string.rep('\251\239\190', 3)
      b64 = M.base64Encode(field(1, otp({ secret = secret, name = 'plus' })))
      if b64:find('+', 1, true) then break end
    end
    T.ok(b64:find('+', 1, true), 'test payload needs a +')
    local r = M.parseMigration('otpauth-migration://offline?data=' .. b64)
    T.eq(r.accounts[1].secret, M.base32Encode(secret))
  end)

  T.test('migration: garbage is invalid', function()
    T.eq({ M.parseMigration('otpauth-migration://offline?data=%%%') }, { nil, 'invalid' })
    T.eq({ M.parseMigration('otpauth-migration://offline?data=' .. M.base64Encode('\10\200')) }, { nil, 'invalid' })
  end)

  T.test('parseImport handles both link kinds and refuses other text', function()
    local one = M.parseImport('otpauth://totp/A:b?secret=JBSWY3DPEHPK3PXP')
    T.eq(one.batchSize, 1); T.eq(one.batchIndex, 0); T.eq(one.skipped, 0); T.eq(#one.accounts, 1)
    local hotp = M.parseImport('otpauth://hotp/A:b?secret=JBSWY3DPEHPK3PXP')
    T.eq({ #hotp.accounts, hotp.skipped }, { 0, 1 })
    T.eq({ M.parseImport('https://example.com') }, { nil, 'not_otp' })
    T.eq({ M.parseImport('otpauth://totp/x') }, { nil, 'invalid' })
  end)

  T.test('totp matches the RFC 6238 test vectors', function()
    local secrets = {
      SHA1 = '12345678901234567890',
      SHA256 = '12345678901234567890123456789012',
      SHA512 = '1234567890123456789012345678901234567890123456789012345678901234',
    }
    local vectors = {
      { 59, '94287082', '46119246', '90693936' },
      { 1111111109, '07081804', '68084774', '25091201' },
      { 2000000000, '69279037', '90698825', '38618901' },
      { 20000000000, '65353130', '77737706', '47863826' },
    }
    for _, v in ipairs(vectors) do
      for i, alg in ipairs({ 'SHA1', 'SHA256', 'SHA512' }) do
        local acct = { secret = M.base32Encode(secrets[alg]), algorithm = alg, digits = 8, period = 30 }
        T.eq(M.totp(acct, v[1], hmac), v[i + 1], alg .. ' @ ' .. v[1])
      end
    end
  end)

  T.test('totp gives 6 digits by default, zero-padded', function()
    local acct = { secret = M.base32Encode('12345678901234567890'), algorithm = 'SHA1', digits = 6, period = 30 }
    T.eq(M.totp(acct, 1111111109, hmac), '081804')
  end)

  T.test('copyTiming waits for the next code when 3 s or less remain', function()
    T.eq(M.copyTiming(1000027, 30), { wait = 0, at = 1000027 }) -- 1000027 % 30 = 7: 23 s left
    T.eq(M.copyTiming(60 + 26.9, 30), { wait = 0, at = 86.9 })
    T.eq(M.copyTiming(60 + 27, 30), { wait = 3, at = 90 })
    T.eq(M.copyTiming(60 + 28.5, 30), { wait = 1.5, at = 90 })
  end)

  T.test('sameAccount compares secret, issuer and name', function()
    local a = { secret = 'AAAA', issuer = 'X', name = 'me', digits = 6 }
    T.ok(M.sameAccount(a, { secret = 'AAAA', issuer = 'X', name = 'me', digits = 8 }))
    T.ok(not M.sameAccount(a, { secret = 'AAAB', issuer = 'X', name = 'me' }))
    T.ok(not M.sameAccount(a, { secret = 'AAAA', issuer = 'Y', name = 'me' }))
  end)
end
