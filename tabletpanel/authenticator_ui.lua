-- The authenticator's Mac-side screens: a menu bar item, the QR scanner window and the account
-- manager. Importing, renaming and removing only happen here, never from the tablet.
local json = require('tabletpanel.json')

local UI = {}

local DIR = debug.getinfo(1, 'S').source:match('^@(.*/)')
local WIDTH, HEIGHT = 560, 520

local mod, menu, scanner

local function readFile(path)
  local f = assert(io.open(path, 'rb'))
  local body = f:read('a')
  f:close()
  return body
end

local function label(account)
  if account.issuer == '' then return account.name end
  if account.name == '' then return account.issuer end
  return account.issuer .. ' (' .. account.name .. ')'
end

local function scannerHtml()
  local html = readFile(DIR .. 'web/scan.html')
  local jsqr = readFile(DIR .. 'web/vendor/jsQR.js')
  local scan = readFile(DIR .. 'web/js/scan.js')
  html = html:gsub('/%*JSQR%*/', function() return jsqr end, 1)
  return (html:gsub('/%*SCAN%*/', function() return scan end, 1))
end

-- The scanner's webview while it's open (for checking it from the Hammerspoon console).
function UI.scannerView() return scanner end

function UI.closeScanner()
  if not scanner then return end
  local s = scanner
  scanner = nil
  s:delete()
end

function UI.openScanner()
  if scanner then scanner:show():bringToFront(true); return end
  local channel = hs.webview.usercontent.new('scan')
  channel:setCallback(function(msg)
    local body = msg.body
    if type(body) ~= 'table' or not scanner then return end
    if body.type == 'text' and type(body.text) == 'string' then
      local ok, result = pcall(mod.importText, body.text)
      if not ok then
        hs.printf('tabletpanel: authenticator: import failed: %s', tostring(result))
        result = { ok = false, error = 'internal' }
      end
      scanner:evaluateJavaScript('window.scanResult(' .. json.encode(result) .. ')')
    elseif body.type == 'close' then
      hs.timer.doAfter(0, UI.closeScanner) -- not from inside the webview's own callback
    end
  end)
  local screen = (hs.mouse.getCurrentScreen() or hs.screen.mainScreen()):frame()
  local frame = { x = screen.x + (screen.w - WIDTH) / 2, y = screen.y + (screen.h - HEIGHT) / 2, w = WIDTH, h = HEIGHT }
  -- localhost counts as a secure page, which the camera requires; nothing is loaded from it.
  scanner = hs.webview.new(frame, {}, channel)
    :windowTitle('Scan Authenticator QR')
    :windowStyle({ 'titled', 'closable' })
    :closeOnEscape(true)
    :deleteOnClose(true)
    :windowCallback(function(action) if action == 'closing' then scanner = nil end end)
    :html(scannerHtml(), 'http://localhost/')
    :show()
    :bringToFront(true)
  hs.focus()
end

local function shellQuote(s) return "'" .. s:gsub("'", "'\\''") .. "'" end

-- The QR codes in the clipboard's image, read by macOS's Vision framework (qr_decode.js). The
-- image never goes to a file; the codes come back through a pipe.
local function clipboardCodes()
  local p = io.popen('/usr/bin/osascript -l JavaScript ' .. shellQuote(DIR .. 'qr_decode.js') .. ' 2>/dev/null')
  local out = p:read('a')
  p:close()
  local ok, codes = pcall(json.decode, out)
  if not ok or type(codes) ~= 'table' then return nil, 'decode_failed' end
  if codes.error then return nil, codes.error end
  return codes
end

-- A screenshot of Google Authenticator's export screen (or of a website's 2FA QR code), copied to
-- the Mac's clipboard. The clipboard is cleared afterwards: the screenshot holds the secrets.
function UI.importFromClipboard()
  local codes, err = clipboardCodes()
  local message
  if not codes then
    message = err == 'no_image' and 'Copy a screenshot of the QR code to the clipboard first.'
      or "The clipboard's image couldn't be read."
  else
    local total = mod.importTexts(codes)
    message = mod.importSummary(total) .. '.'
    if total.imported + total.duplicates + total.skipped > 0 then
      hs.pasteboard.clearContents()
      message = message .. '\n\nThe screenshot is off the clipboard now. Delete it from your phone and Photos too: it holds the secrets.'
    end
  end
  hs.focus()
  hs.dialog.blockAlert('Import from clipboard', message)
end

local function renameAccount(account)
  hs.focus()
  local button, issuer = hs.dialog.textPrompt('Rename account', 'Service (for example GitHub):', account.issuer, 'Next', 'Cancel')
  if button ~= 'Next' then return end
  local button2, name = hs.dialog.textPrompt('Rename account', 'Account name:', account.name, 'Save', 'Cancel')
  if button2 ~= 'Save' then return end
  if not mod.rename(account.id, issuer, name) then hs.alert.show("Couldn't save the change to the Keychain") end
end

local function removeAccount(account)
  hs.focus()
  local button = hs.dialog.blockAlert('Remove ' .. label(account) .. '?',
    "Its codes won't be on the tablet any more. Google Authenticator on your phone isn't affected.",
    'Remove', 'Cancel', 'warning')
  if button == 'Remove' and not mod.remove(account.id) then hs.alert.show("Couldn't remove it from the Keychain") end
end

local function accountActions(account)
  local chooser = hs.chooser.new(function(choice)
    if not choice then return end
    hs.timer.doAfter(0.1, function()
      if choice.action == 'rename' then renameAccount(account) else removeAccount(account) end
    end)
  end)
  chooser:placeholderText(label(account))
    :choices({ { text = 'Rename…', action = 'rename' }, { text = 'Remove…', action = 'remove' } })
    :show()
end

function UI.openManager()
  local byId, choices = {}, {}
  for _, a in ipairs(mod.list()) do
    byId[a.id] = a
    choices[#choices + 1] = { text = a.issuer ~= '' and a.issuer or a.name, subText = a.issuer ~= '' and a.name or nil, id = a.id }
  end
  table.sort(choices, function(x, y) return x.text:lower() < y.text:lower() end)
  local chooser = hs.chooser.new(function(choice)
    if choice then hs.timer.doAfter(0.1, function() accountActions(byId[choice.id]) end) end
  end)
  chooser:placeholderText('Choose an account to rename or remove'):choices(choices):show()
end

function UI.start(authenticator)
  mod = authenticator
  menu = hs.menubar.new()
  local icon = hs.image.imageFromName('NSLockLockedTemplate')
  if icon then menu:setIcon(icon) else menu:setTitle('2FA') end
  menu:setTooltip('Mac Panel authenticator')
  menu:setMenu(function()
    local n = #mod.list()
    return {
      { title = 'Import QR from clipboard', fn = function() hs.timer.doAfter(0.1, UI.importFromClipboard) end },
      { title = 'Scan QR with camera…', fn = UI.openScanner },
      { title = 'Manage accounts…', fn = UI.openManager, disabled = n == 0 },
      { title = '-' },
      { title = n == 1 and '1 account' or (n .. ' accounts'), disabled = true },
    }
  end)
end

function UI.stop()
  UI.closeScanner()
  if menu then menu:delete(); menu = nil end
end

return UI
