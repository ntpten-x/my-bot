// Shared by reader and comment delivery in the MV3 worker. No Facebook/page API.
(function (root) {
  const KEY = 'commentFocusLease';
  let tail = Promise.resolve();
  function withLock(work) {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  }
  async function blocked() {
    const stored = await chrome.storage.session.get({ [KEY]: null });
    return Boolean(stored[KEY] && stored[KEY].until > Date.now());
  }
  async function take(owner) {
    return withLock(async () => {
      const stored = await chrome.storage.session.get({ [KEY]: null });
      const lease = stored[KEY];
      if (lease && lease.owner !== owner && lease.until > Date.now()) return false;
      await chrome.storage.session.set({ [KEY]: { owner, until: Date.now() + 180000 } });
      return true;
    });
  }
  async function release(owner) {
    return withLock(async () => {
      const stored = await chrome.storage.session.get({ [KEY]: null });
      if (stored[KEY]?.owner === owner) await chrome.storage.session.set({ [KEY]: null });
    });
  }
  root.MyBotFocus = { withLock, blocked, take, release };
})(typeof globalThis !== 'undefined' ? globalThis : this);
