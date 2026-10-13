local N = require('tabletpanel.netguard')

local ROUTE = [[
   route to: default
destination: default
       mask: default
    gateway: 192.168.1.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
]]

return function(T)
  T.test('parses the default gateway', function()
    T.eq(N.parseGateway(ROUTE), '192.168.1.1')
  end)
  T.test('no gateway line yields nil', function()
    T.eq(N.parseGateway('route: writing to routing socket: not in table'), nil)
  end)
  T.test('parses arp output and restores stripped leading zeros', function()
    T.eq(N.parseArpMac('? (192.168.1.1) at 0:1e:a:bb:cc:dd on en0 ifscope [ethernet]'), '00:1e:0a:bb:cc:dd')
  end)
  T.test('incomplete arp entry yields nil', function()
    T.eq(N.parseArpMac('? (192.168.1.1) at (incomplete) on en0 ifscope [ethernet]'), nil)
    T.eq(N.parseArpMac('192.168.1.1 (192.168.1.1) -- no entry'), nil)
  end)
  T.test('normalizes case and dash separators', function()
    T.eq(N.normalizeMac('A4-2B-B0-12-34-56'), 'a4:2b:b0:12:34:56')
  end)
  T.test('rejects malformed MACs', function()
    T.eq(N.normalizeMac('zz:2b:b0:12:34:56'), nil)
    T.eq(N.normalizeMac('a4:2b:b0:12:34'), nil)
    T.eq(N.normalizeMac(nil), nil)
  end)
  T.test('isHome matches across formats', function()
    T.eq(N.isHome('0:1e:a:bb:cc:dd', { 'ff:ff:ff:ff:ff:ff', '00:1E:0A:BB:CC:DD' }), true)
    T.eq(N.isHome('0:1e:a:bb:cc:de', { '00:1E:0A:BB:CC:DD' }), false)
    T.eq(N.isHome(nil, { '00:1E:0A:BB:CC:DD' }), false)
  end)
end
