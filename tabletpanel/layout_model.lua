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

local MIN_SIZE = 50

local function finite(n) return type(n) == 'number' and n == n and n ~= math.huge and n ~= -math.huge end

local function overlap(f, s)
  local w = math.min(f.x + f.w, s.x + s.w) - math.max(f.x, s.x)
  local h = math.min(f.y + f.h, s.y + s.h) - math.max(f.y, s.y)
  return (w > 0 and h > 0) and w * h or 0
end

local function centreDistance(f, s)
  local dx = (f.x + f.w / 2) - (s.x + s.w / 2)
  local dy = (f.y + f.h / 2) - (s.y + s.h / 2)
  return dx * dx + dy * dy
end

-- Keeps a requested window frame on a screen, so a drag on the map (or a stray request) can't
-- strand a window where no screen shows it: the frame moves onto the screen it overlaps most
-- (or the nearest one) and shrinks to fit. screens: { {frame = {x, y, w, h}} }.
-- Returns nil for frames that are too small or not finite numbers.
function Layout.clamp(frame, screens)
  local x, y, w, h = frame.x, frame.y, frame.w, frame.h
  if not (finite(x) and finite(y) and finite(w) and finite(h)) or w < MIN_SIZE or h < MIN_SIZE then return nil end
  local f = { x = x, y = y, w = w, h = h }
  local best, bestOverlap, bestDistance
  for _, screen in ipairs(screens) do
    local s = screen.frame
    local o, d = overlap(f, s), centreDistance(f, s)
    if not best or o > bestOverlap or (o == bestOverlap and d < bestDistance) then
      best, bestOverlap, bestDistance = s, o, d
    end
  end
  if not best then return nil end
  w, h = math.min(w, best.w), math.min(h, best.h)
  return {
    x = math.max(best.x, math.min(x, best.x + best.w - w)),
    y = math.max(best.y, math.min(y, best.y + best.h - h)),
    w = w, h = h,
  }
end

return Layout
