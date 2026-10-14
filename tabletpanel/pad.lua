-- The tablet's sketch pad: puts a drawing on the Mac's clipboard as an image.
local P = { name = 'pad', actions = {} }

function P.start() end
function P.stop() end
function P.state() return {} end

-- args: { png = base64 PNG data }
function P.actions.copy(args)
  if type(args.png) ~= 'string' or #args.png == 0 then return false, 'no_image' end
  local img = hs.image.imageFromURL('data:image/png;base64,' .. args.png)
  if not img then return false, 'bad_image' end
  hs.pasteboard.writeObjects(img)
  return true
end

return P
