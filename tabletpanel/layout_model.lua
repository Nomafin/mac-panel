-- Window layouts for the map page, tuned for a 32:9 screen. Pure.
local Layout = {}

-- Each preset: left edge and width as fractions of the screen; always full height.
local PRESETS = {
  ['left-third'] = { 0, 1 / 3 },
  ['middle-third'] = { 1 / 3, 1 / 3 },
  ['right-third'] = { 2 / 3, 1 / 3 },
  ['left-half'] = { 0, 1 / 2 },
  ['right-half'] = { 1 / 2, 1 / 2 },
  center = { 1 / 6, 2 / 3 },
  max = { 0, 1 },
}

local function round(x) return math.floor(x + 0.5) end

-- screen: the screen's usable frame {x, y, w, h}. Returns the window frame, or nil.
function Layout.frame(preset, screen)
  local p = PRESETS[preset]
  if not p then return nil end
  return { x = round(screen.x + screen.w * p[1]), y = screen.y, w = round(screen.w * p[2]), h = screen.h }
end

return Layout
