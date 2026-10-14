// The tablet's hardware keys, which the Android app passes in as `tablet-key` events.

// What a hardware key does. Volume keys never wake the screen: the cover can hold them down.
export function keyAction(key, { layerOpen, asleep, micInUse, page = 0 }) {
  if (asleep) return key === 'back' || key === 'home' || key === 'recents' ? 'peek' : null;
  if (key === 'back' && layerOpen) return 'closeLayer';
  if (key === 'back' && page !== 0) return 'panel';
  if (key === 'recents' && micInUse) return 'toggleMic'; // a physical mute key during calls
  return null;
}

export function initKeys(ctx) {
  window.addEventListener('tablet-key', (e) => {
    const action = keyAction(e.detail && e.detail.key, {
      layerOpen: ctx.sheet.isOpen(),
      asleep: ctx.sleep.isAsleep(),
      micInUse: !!(ctx.store.mic && ctx.store.mic.inUse),
      page: ctx.pages.current(),
    });
    if (action === 'closeLayer') ctx.sheet.close();
    else if (action === 'peek') ctx.sleep.peek();
    else if (action === 'toggleMic') ctx.mic.toggle();
    else if (action === 'panel') ctx.pages.goTo(0);
  });

  // Dev aid: in mock mode the "d" key toggles the Mac's awake state.
  if (ctx.MOCK) {
    document.addEventListener('keydown', (e) => {
      const ws = ctx.connection.socket();
      if (e.key === 'd' && ws && ws.toggleDisplay) ws.toggleDisplay();
    });
  }
}
