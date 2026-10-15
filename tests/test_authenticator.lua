local Otp = require('tabletpanel.otp_model')
local json = require('tabletpanel.json')

-- Not a real HMAC: 20 bytes that depend on key and message, enough to tell codes apart.
local function fakeHmac(_, key, msg)
  return (msg .. key .. string.rep('\7', 20)):sub(1, 20)
end

local GITHUB = { id = 'a1', issuer = 'GitHub', name = 'me', secret = 'JBSWY3DPEHPK3PXP', algorithm = 'SHA1', digits = 6, period = 30 }

local function stored(list)
  return Otp.base64Encode(json.encode(json.array(list)))
end

local function decodeStored(s)
  return json.decode(Otp.base64Decode(s))
end

-- A fresh module with fake Keychain, clipboard, clock and timers.
local function setup(keychain, readError)
  package.loaded['tabletpanel.authenticator'] = nil
  local A = require('tabletpanel.authenticator')
  local env = { keychain = keychain, clip = 'before', t = 1000000010, timers = {}, notified = 0, logs = {}, ids = 0, writes = 0 }
  A.deps = {
    readKeychain = function()
      if readError then return nil, readError end
      if not env.keychain then return nil, 'missing' end
      return env.keychain
    end,
    writeKeychain = function(s) env.writes = env.writes + 1; env.keychain = s; return true end,
    setClipboard = function(s) env.clip = s end,
    getClipboard = function() return env.clip end,
    clearClipboard = function() env.clip = nil end,
    now = function() return env.t end,
    after = function(seconds, fn)
      local h = { at = env.t + seconds, fn = fn }
      function h:stop() self.stopped = true end
      env.timers[#env.timers + 1] = h
      return h
    end,
    hmac = fakeHmac,
    randomId = function() env.ids = env.ids + 1; return 'new' .. env.ids end,
    startUI = function() end,
    stopUI = function() end,
  }
  function env.advance(seconds)
    env.t = env.t + seconds
    local ran = true
    while ran do
      ran = false
      for _, h in ipairs(env.timers) do
        if not h.stopped and not h.done and h.at <= env.t then
          h.done, ran = true, true
          h.fn()
        end
      end
    end
  end
  local logger = function(m) env.logs[#env.logs + 1] = m end
  A.start(function() env.notified = env.notified + 1 end, { i = logger, w = logger, e = logger })
  return A, env
end

local function hasKey(t, key)
  if type(t) ~= 'table' then return false end
  for k, v in pairs(t) do
    if k == key or hasKey(v, key) then return true end
  end
  return false
end

return function(T)
  T.test('state lists accounts without secrets', function()
    local A = setup(stored({ GITHUB }))
    T.eq(A.state(), { accounts = { { id = 'a1', issuer = 'GitHub', name = 'me', period = 30 } } })
    T.ok(not hasKey(A.state(), 'secret'))
  end)

  T.test('no Keychain item means no accounts', function()
    local A, env = setup(nil)
    T.eq(#A.state().accounts, 0)
    T.eq(#env.logs, 0)
  end)

  T.test('an unreadable or corrupt Keychain item gives no accounts, a warning, and no overwrite', function()
    for _, case in ipairs({ { 'garbage!!', nil }, { stored({ GITHUB }), 'error' } }) do
      local A, env = setup(case[1], case[2])
      T.eq(#A.state().accounts, 0)
      T.ok(#env.logs > 0)
      T.eq(A.importText('otpauth://totp/A:b?secret=JBSWY3DPEHPK3PXP'), { ok = false, error = 'keychain_unreadable' })
      T.eq(env.writes, 0)
    end
  end)

  T.test('import saves new accounts to the Keychain and notifies', function()
    local A, env = setup(nil)
    local r = A.importText('otpauth://totp/AWS:admin?secret=JBSWY3DPEHPK3PXP')
    T.eq(r, { ok = true, imported = 1, duplicates = 0, skipped = 0, batchIndex = 0, batchSize = 1, batchId = 0 })
    T.eq(decodeStored(env.keychain), { { id = 'new1', issuer = 'AWS', name = 'admin', secret = 'JBSWY3DPEHPK3PXP', algorithm = 'SHA1', digits = 6, period = 30 } })
    T.eq(env.notified, 1)
    T.eq(A.state().accounts, { { id = 'new1', issuer = 'AWS', name = 'admin', period = 30 } })
  end)

  T.test('importing the same account again counts a duplicate and saves nothing', function()
    local A, env = setup(stored({ GITHUB }))
    local r = A.importText('otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP')
    T.eq({ r.imported, r.duplicates }, { 0, 1 })
    T.eq(env.writes, 0)
  end)

  T.test('a save that fails puts the previous Keychain value back', function()
    local A, env = setup(stored({ GITHUB }))
    local before = env.keychain
    local written = {}
    A.deps.writeKeychain = function(s)
      written[#written + 1] = s
      if #written == 1 then env.keychain = 'half-written'; return false end
      env.keychain = s
      return true
    end
    local r = A.importText('otpauth://totp/AWS:admin?secret=MZXW6YTBOI')
    T.eq(r, { ok = false, error = 'save_failed' })
    T.eq(written[2], before)
    T.eq(env.keychain, before)
    T.eq(#A.list(), 1)
  end)

  T.test('a failed first save removes the half-written item', function()
    local A, env = setup(nil)
    local deleted = false
    A.deps.writeKeychain = function(s) env.keychain = s:sub(1, 5); return false end
    A.deps.deleteKeychain = function() deleted = true; env.keychain = nil end
    T.eq(A.importText('otpauth://totp/AWS:admin?secret=MZXW6YTBOI').ok, false)
    T.ok(deleted)
    T.eq(#A.list(), 0)
  end)

  T.test('a save that throws is a failed save, not a crash', function()
    local A, env = setup(stored({ GITHUB }))
    A.deps.writeKeychain = function() error('security tool missing') end
    T.eq(A.importText('otpauth://totp/AWS:admin?secret=MZXW6YTBOI'), { ok = false, error = 'save_failed' })
    T.eq(#A.list(), 1)
    T.ok(#env.logs > 0)
  end)

  T.test('importing several codes at once adds up the results', function()
    local A = setup(stored({ GITHUB }))
    local r = A.importTexts({
      'otpauth://totp/AWS:admin?secret=MZXW6YTBOI',
      'otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP',
      'https://example.com',
    })
    T.eq(r, { imported = 1, duplicates = 1, skipped = 0, failed = 1, codes = 3, error = 'not_otp' })
    T.eq(#A.list(), 2)
  end)

  T.test('importSummary says what happened in plain words', function()
    local A = setup(nil)
    T.eq(A.importSummary({ imported = 3, duplicates = 0, skipped = 0, failed = 0, codes = 1 }), 'Imported 3 accounts')
    T.eq(A.importSummary({ imported = 1, duplicates = 2, skipped = 1, failed = 0, codes = 2 }),
      'Imported 1 account (2 already here, 1 counter-based skipped)')
    T.eq(A.importSummary({ imported = 0, duplicates = 2, skipped = 0, failed = 0, codes = 1 }), 'No new accounts (2 already here)')
    T.eq(A.importSummary({ imported = 0, duplicates = 0, skipped = 0, failed = 1, codes = 1 }), "That's not an authenticator QR code")
    T.eq(A.importSummary({ imported = 0, duplicates = 0, skipped = 0, failed = 0, codes = 0 }), 'No QR code found in the image')
  end)

  T.test('import reports text that is not a 2FA link', function()
    local A = setup(nil)
    T.eq(A.importText('https://example.com'), { ok = false, error = 'not_otp' })
  end)

  T.test('copy puts the code on the clipboard and clears it 30 s later', function()
    local A, env = setup(stored({ GITHUB }))
    T.eq({ A.actions.copy({ id = 'a1' }) }, { true })
    T.eq(env.clip, Otp.totp(GITHUB, env.t, fakeHmac))
    T.eq(A.state().copied, { id = 'a1', seq = 1, status = 'copied' })
    env.advance(29)
    T.ok(env.clip ~= nil)
    env.advance(1)
    T.eq(env.clip, nil)
    T.eq(A.state().copied, nil)
  end)

  T.test('the clipboard is left alone if it changed since the copy', function()
    local A, env = setup(stored({ GITHUB }))
    A.actions.copy({ id = 'a1' })
    env.clip = 'something the user copied'
    env.advance(30)
    T.eq(env.clip, 'something the user copied')
  end)

  T.test('in the last 3 s of a period the next code is copied', function()
    local A, env = setup(stored({ GITHUB }))
    env.t = 1000000018 -- 1000000018 % 30 = 28: 2 s left
    A.actions.copy({ id = 'a1' })
    T.eq(A.state().copied.status, 'waiting')
    T.eq(env.clip, 'before')
    local notifiedBefore = env.notified
    env.advance(2)
    T.eq(env.clip, Otp.totp(GITHUB, 1000000020, fakeHmac))
    T.eq(A.state().copied.status, 'copied')
    T.eq(env.notified, notifiedBefore + 1)
  end)

  T.test('a second copy cancels the first one\'s wait and clear', function()
    local A, env = setup(stored({ GITHUB, { id = 'b2', issuer = 'AWS', name = 'x', secret = 'MZXW6YTBOI', algorithm = 'SHA1', digits = 6, period = 30 } }))
    env.t = 1000000018
    A.actions.copy({ id = 'a1' })
    A.actions.copy({ id = 'b2' })
    env.advance(2)
    T.eq(A.state().copied, { id = 'b2', seq = 2, status = 'copied' })
    for _, h in ipairs(env.timers) do
      if h.done then T.ok(not h.stopped) end
    end
    T.eq(#env.timers, 3) -- a1's wait (stopped), b2's wait, b2's clear
    T.ok(env.timers[1].stopped)
  end)

  T.test('copy of an unknown account fails', function()
    local A = setup(stored({ GITHUB }))
    T.eq({ A.actions.copy({ id = 'nope' }) }, { false, 'unknown_account' })
  end)

  T.test('rename and remove save and notify', function()
    local A, env = setup(stored({ GITHUB }))
    T.ok(A.rename('a1', 'GitHub (work)', 'me@work'))
    T.eq(decodeStored(env.keychain)[1].issuer, 'GitHub (work)')
    T.eq(A.list(), { { id = 'a1', issuer = 'GitHub (work)', name = 'me@work', period = 30 } })
    T.ok(A.remove('a1'))
    T.eq(decodeStored(env.keychain), {})
    T.eq(env.notified, 2)
    T.ok(not A.remove('a1'))
  end)

  T.test('stop clears a code still on the clipboard and forgets the secrets', function()
    local A, env = setup(stored({ GITHUB }))
    A.actions.copy({ id = 'a1' })
    A.stop()
    T.eq(env.clip, nil)
    T.eq(#A.state().accounts, 0)
  end)
end
