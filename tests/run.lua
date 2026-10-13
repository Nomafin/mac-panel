-- Minimal test runner for the pure Lua modules.
-- Usage (from repo root): lua tests/run.lua [filename-filter]
package.path = './?.lua;' .. package.path
local util = require('tabletpanel.util')

local T = { passed = 0, failed = 0 }
local current = ''

local function show(v)
  if type(v) == 'string' then return string.format('%q', v) end
  if type(v) == 'table' then
    local ok, json = pcall(require, 'tabletpanel.json')
    if ok then
      local okEnc, s = pcall(json.encode, v)
      if okEnc then return s end
    end
  end
  return tostring(v)
end

function T.eq(actual, expected, label)
  if not util.deepEqual(actual, expected) then
    error(string.format('%sexpected %s, got %s', label and (label .. ': ') or '', show(expected), show(actual)), 2)
  end
end

function T.ok(value, label)
  if not value then error(label or 'expected a truthy value', 2) end
end

function T.raises(fn, pattern)
  local ok, err = pcall(fn)
  if ok then error('expected an error', 2) end
  if pattern and not tostring(err):find(pattern, 1, true) then
    error('error "' .. tostring(err) .. '" does not contain "' .. pattern .. '"', 2)
  end
end

function T.test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    T.passed = T.passed + 1
  else
    T.failed = T.failed + 1
    print('FAIL ' .. current .. ' > ' .. name .. '\n     ' .. tostring(err))
  end
end

local filter = arg[1]
local listing = io.popen('ls tests/test_*.lua')
for file in listing:lines() do
  if not filter or file:find(filter, 1, true) then
    current = file:match('test_(.-)%.lua$')
    dofile(file)(T)
  end
end
listing:close()

print(string.format('%d passed, %d failed', T.passed, T.failed))
os.exit(T.failed == 0 and 0 or 1)
