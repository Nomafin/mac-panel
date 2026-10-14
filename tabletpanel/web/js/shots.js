// Window screenshots, shared by the map and the window sheet. Each capture briefly blocks
// Hammerspoon, so they are taken one at a time, only when asked for, and kept as object URLs
// that redraws reuse instead of fetching again. A new screenshot only replaces the old one once
// it has decoded, so a refresh never shows an empty window.

// deps: load(id) -> Promise<url|null>, decode(url) -> Promise, revoke(url)
export function createShots({ load, decode, revoke }) {
  const urls = new Map(); // window id -> URL of its latest screenshot
  let busy = false;

  async function refresh(ids, onFresh) {
    if (busy) return;
    busy = true;
    try {
      for (const id of ids) {
        let url = null;
        try { url = await load(id); } catch (_) { /* no capture this time */ }
        if (!url) continue; // no Screen Recording permission, or the window can't be captured
        try {
          await decode(url);
        } catch (_) {
          revoke(url);
          continue;
        }
        const old = urls.get(id);
        urls.set(id, url);
        if (onFresh) onFresh(id, url);
        if (old) revoke(old);
      }
    } finally {
      busy = false;
    }
  }

  function prune(keepIds) {
    for (const [id, url] of urls) {
      if (!keepIds.includes(id)) {
        revoke(url);
        urls.delete(id);
      }
    }
  }

  return { refresh, prune, url: (id) => urls.get(id) };
}

export function allWindowIds(store) {
  const apps = (store.windows && store.windows.apps) || [];
  return apps.flatMap((a) => a.windows.map((w) => w.id));
}

// The real thing: screenshots from the Mac's /thumb/<id>.jpg (none in mock mode).
export function browserShots(mock) {
  return createShots({
    load: async (id) => {
      if (mock) return null;
      const res = await fetch(`/thumb/${id}.jpg?t=${Date.now()}`, { cache: 'no-store' });
      return res.ok ? URL.createObjectURL(await res.blob()) : null;
    },
    decode: (url) => {
      const img = new Image();
      img.src = url;
      return img.decode();
    },
    revoke: (url) => URL.revokeObjectURL(url),
  });
}
