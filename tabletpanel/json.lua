-- Minimal deterministic JSON for tabletpanel (pure Lua, no hs.* dependency).
-- Object keys are sorted; mark empty arrays with json.array().
local json = {}

local ARRAY_MT = { __name = 'json.array' }

function json.array(t)
  return setmetatable(t or {}, ARRAY_MT)
end

local ESCAPES = {
  ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
  ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function encodeString(s)
  local escaped = s:gsub('[%c"\\]', function(c)
    return ESCAPES[c] or string.format('\\u%04x', c:byte())
  end)
  return '"' .. escaped .. '"'
end

local function isArray(t)
  if getmetatable(t) == ARRAY_MT then return true end
  local n = #t
  if n == 0 then return false end
  local count = 0
  for _ in pairs(t) do count = count + 1 end
  return count == n
end

local function encodeValue(v, out)
  local tv = type(v)
  if v == nil then
    out[#out + 1] = 'null'
  elseif tv == 'boolean' then
    out[#out + 1] = tostring(v)
  elseif tv == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then error('json: cannot encode ' .. tostring(v), 0) end
    if math.type(v) == 'integer' or (v == math.floor(v) and math.abs(v) < 2 ^ 53) then
      out[#out + 1] = string.format('%d', v)
    else
      out[#out + 1] = string.format('%.14g', v)
    end
  elseif tv == 'string' then
    out[#out + 1] = encodeString(v)
  elseif tv == 'table' then
    if isArray(v) then
      out[#out + 1] = '['
      for i = 1, #v do
        if i > 1 then out[#out + 1] = ',' end
        encodeValue(v[i], out)
      end
      out[#out + 1] = ']'
    else
      local keys = {}
      for k in pairs(v) do
        if type(k) ~= 'string' then error('json: object keys must be strings', 0) end
        keys[#keys + 1] = k
      end
      table.sort(keys)
      out[#out + 1] = '{'
      for i, k in ipairs(keys) do
        if i > 1 then out[#out + 1] = ',' end
        out[#out + 1] = encodeString(k)
        out[#out + 1] = ':'
        encodeValue(v[k], out)
      end
      out[#out + 1] = '}'
    end
  else
    error('json: cannot encode type ' .. tv, 0)
  end
end

function json.encode(v)
  local out = {}
  encodeValue(v, out)
  return table.concat(out)
end

local function fail(pos, msg)
  error(string.format('json: %s at position %d', msg, pos), 0)
end

local function skip(str, pos)
  return str:find('[^ \t\r\n]', pos) or #str + 1
end

local SIMPLE_ESCAPES = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }

local function parseString(str, pos) -- pos is at the opening quote
  local buf = {}
  local i = pos + 1
  while true do
    local j = str:find('["\\]', i)
    if not j then fail(i, 'unterminated string') end
    buf[#buf + 1] = str:sub(i, j - 1)
    if str:sub(j, j) == '"' then return table.concat(buf), j + 1 end
    local e = str:sub(j + 1, j + 1)
    if SIMPLE_ESCAPES[e] then
      buf[#buf + 1] = SIMPLE_ESCAPES[e]
      i = j + 2
    elseif e == 'u' then
      local hex = str:sub(j + 2, j + 5)
      if not hex:match('^%x%x%x%x$') then fail(j, 'bad unicode escape') end
      local cp = tonumber(hex, 16)
      i = j + 6
      if cp >= 0xD800 and cp <= 0xDBFF and str:sub(i, i + 1) == '\\u' then
        local lo = tonumber(str:sub(i + 2, i + 5), 16)
        if lo and lo >= 0xDC00 and lo <= 0xDFFF then
          cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00)
          i = i + 6
        end
      end
      buf[#buf + 1] = utf8.char(cp)
    else
      fail(j, 'bad escape')
    end
  end
end

local parseValue

local function parseObject(str, pos)
  local obj = {}
  pos = skip(str, pos + 1)
  if str:sub(pos, pos) == '}' then return obj, pos + 1 end
  while true do
    if str:sub(pos, pos) ~= '"' then fail(pos, 'expected string key') end
    local key
    key, pos = parseString(str, pos)
    pos = skip(str, pos)
    if str:sub(pos, pos) ~= ':' then fail(pos, "expected ':'") end
    obj[key], pos = parseValue(str, pos + 1)
    pos = skip(str, pos)
    local c = str:sub(pos, pos)
    if c == '}' then return obj, pos + 1 end
    if c ~= ',' then fail(pos, "expected ',' or '}'") end
    pos = skip(str, pos + 1)
  end
end

local function parseArray(str, pos)
  local arr = json.array({})
  local n = 0
  pos = skip(str, pos + 1)
  if str:sub(pos, pos) == ']' then return arr, pos + 1 end
  while true do
    n = n + 1
    arr[n], pos = parseValue(str, pos)
    pos = skip(str, pos)
    local c = str:sub(pos, pos)
    if c == ']' then return arr, pos + 1 end
    if c ~= ',' then fail(pos, "expected ',' or ']'") end
    pos = pos + 1
  end
end

parseValue = function(str, pos)
  pos = skip(str, pos)
  local c = str:sub(pos, pos)
  if c == '{' then return parseObject(str, pos) end
  if c == '[' then return parseArray(str, pos) end
  if c == '"' then return parseString(str, pos) end
  if str:sub(pos, pos + 3) == 'true' then return true, pos + 4 end
  if str:sub(pos, pos + 4) == 'false' then return false, pos + 5 end
  if str:sub(pos, pos + 3) == 'null' then return nil, pos + 4 end
  local s, e = str:find('^-?%d+%.?%d*[eE]?[+-]?%d*', pos)
  if not s then fail(pos, 'unexpected input') end
  local n = tonumber(str:sub(s, e))
  if not n then fail(pos, 'bad number') end
  return n, e + 1
end

function json.decode(str)
  if type(str) ~= 'string' then error('json: expected a string', 0) end
  local value, pos = parseValue(str, 1)
  pos = skip(str, pos)
  if pos <= #str then fail(pos, 'trailing characters') end
  return value
end

return json
