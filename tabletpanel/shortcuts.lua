-- Buttons for the Mac's front app: { label, modifiers, key } keyboard shortcuts per bundle id.
-- Up to six per app show above the status line on the tablet. Edit freely, then reload Hammerspoon.
return {
  ['com.microsoft.VSCode'] = {
    { 'Command palette', { 'cmd', 'shift' }, 'p' },
    { 'Go to file', { 'cmd' }, 'p' },
    { 'Terminal', { 'ctrl' }, '`' },
    { 'Sidebar', { 'cmd' }, 'b' },
    { 'Search', { 'cmd', 'shift' }, 'f' },
    { 'Save all', { 'cmd', 'alt' }, 's' },
  },
  ['com.microsoft.edgemac'] = {
    { 'New tab', { 'cmd' }, 't' },
    { 'Reopen tab', { 'cmd', 'shift' }, 't' },
    { 'Back', { 'cmd' }, '[' },
    { 'Forward', { 'cmd' }, ']' },
    { 'Reload', { 'cmd' }, 'r' },
    { 'Close tab', { 'cmd' }, 'w' },
  },
  ['com.google.Chrome'] = {
    { 'New tab', { 'cmd' }, 't' },
    { 'Reopen tab', { 'cmd', 'shift' }, 't' },
    { 'Back', { 'cmd' }, '[' },
    { 'Forward', { 'cmd' }, ']' },
    { 'Reload', { 'cmd' }, 'r' },
    { 'Close tab', { 'cmd' }, 'w' },
  },
  ['com.tinyspeck.slackmacgap'] = {
    { 'Jump to…', { 'cmd' }, 'k' },
    { 'Unreads', { 'cmd', 'shift' }, 'a' },
    { 'Threads', { 'cmd', 'shift' }, 't' },
    { 'Activity', { 'cmd', 'shift' }, 'm' },
  },
  ['com.microsoft.teams2'] = {
    { 'Mute', { 'cmd', 'shift' }, 'm' },
    { 'Camera', { 'cmd', 'shift' }, 'o' },
    { 'Raise hand', { 'cmd', 'shift' }, 'k' },
    { 'Share screen', { 'cmd', 'shift' }, 'e' },
    { 'Leave', { 'cmd', 'shift' }, 'h' },
  },
  ['com.apple.finder'] = {
    { 'New window', { 'cmd' }, 'n' },
    { 'Downloads', { 'cmd', 'alt' }, 'l' },
    { 'Desktop', { 'cmd', 'shift' }, 'd' },
    { 'Go to folder', { 'cmd', 'shift' }, 'g' },
    { 'Hidden files', { 'cmd', 'shift' }, '.' },
  },
  ['com.apple.mail'] = {
    { 'New message', { 'cmd' }, 'n' },
    { 'Reply', { 'cmd' }, 'r' },
    { 'Reply all', { 'cmd', 'shift' }, 'r' },
    { 'Archive', { 'cmd', 'ctrl' }, 'a' },
    { 'Get mail', { 'cmd', 'shift' }, 'n' },
  },
  ['com.microsoft.Outlook'] = {
    { 'New email', { 'cmd' }, 'n' },
    { 'Reply', { 'cmd' }, 'r' },
    { 'Reply all', { 'cmd', 'shift' }, 'r' },
    { 'Forward', { 'cmd' }, 'j' },
    { 'Mail', { 'cmd' }, '1' },
    { 'Calendar', { 'cmd' }, '2' },
  },
}
