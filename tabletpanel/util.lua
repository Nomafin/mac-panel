-- Small pure helpers shared by the tabletpanel modules.
local util = {}

-- Structural equality for plain data tables (metatables are ignored).
function util.deepEqual(a, b)
  if a == b then return true end
  if type(a) ~= 'table' or type(b) ~= 'table' then return false end
  for k, v in pairs(a) do
    if not util.deepEqual(v, b[k]) then return false end
  end
  for k in pairs(b) do
    if a[k] == nil then return false end
  end
  return true
end

return util
