// Session ownership only. Never discover ownership by scanning Facebook URLs.
(function (root) {
  async function bounded(work, ms = 5000) {
    if (ms <= 0) throw new Error("tab operation budget exhausted");
    let timer;
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("tab operation timed out")), ms);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function lookup(tabId, options = {}) {
    if (!Number.isInteger(tabId)) return { state: "retry" };
    try {
      const tab = await bounded(() => chrome.tabs.get(tabId), Math.min(5000, (options.deadlineMs ?? Infinity) - Date.now()));
      return tab ? { state: "found", tab } : { state: "gone" };
    } catch {
      // A failed get is NOT proof of absence. Query only on failure and never
      // use that query to adopt unknown tabs or close a tab by URL.
      try {
        const tabs = await bounded(() => chrome.tabs.query({}), Math.min(5000, (options.deadlineMs ?? Infinity) - Date.now()));
        return tabs.some(tab => tab.id === tabId) ? { state: "retry" } : { state: "gone" };
      } catch { return { state: "retry" }; }
    }
  }
  function samePostUrl(actual, expected) {
    try {
      const key = value => {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.port ||
          !["www.facebook.com", "web.facebook.com", "m.facebook.com", "facebook.com"].includes(url.hostname)) return "";
        const match = url.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/(?:posts|permalink)\/(\d+)\/?$/);
        return match ? `${match[1].toLowerCase()}:${match[2]}` : "";
      };
      return Boolean(key(actual) && key(actual) === key(expected));
    } catch { return false; }
  }
  async function inspect(ref, matches, options = {}) {
    if (!ref || !Number.isInteger(ref.tabId)) return { state: "retry" };
    const result = await lookup(ref.tabId, options);
    if (result.state !== "found") return result;
    const tab = result.tab, actual = tab.pendingUrl || tab.url;
    if (!actual || !(ref.continuation?.url || ref.url)) return { state: "retry" };
    if (Number.isInteger(ref.windowId) && Number.isInteger(tab.windowId) && ref.windowId !== tab.windowId) return { state: "released" };
    if (actual === "about:blank" || matches(actual, ref.continuation?.url || ref.url)) return { state: "owned", tab };
    return { state: "released" };
  }
  async function close(ref, matches, options = {}) {
    const result = await inspect(ref, matches, options);
    if (result.state !== "owned") return result.state;
    try {
      const remaining = Math.min(5000, (options.deadlineMs ?? Infinity) - Date.now());
      if (ref.previousUrl) await bounded(() => chrome.tabs.update(ref.tabId, { url: ref.previousUrl, active: false }), remaining);
      else if (ref.ephemeral !== false) await bounded(() => chrome.tabs.remove(ref.tabId), remaining);
      else return "released";
      return "closed";
    } catch { return "retry"; }
  }
  const due = ref => !ref?.closeAfter || ref.closeAfter <= Date.now();
  function retry(ref) {
    const attempts = Math.min(1000, (ref.closeAttempts || 0) + 1);
    return { ...ref, closing: true, closeAttempts: attempts,
      closeAfter: Date.now() + [30000, 60000, 120000, 300000][Math.min(attempts - 1, 3)] };
  }
  let tail = Promise.resolve();
  function note(result) {
    if (!["closed", "released"].includes(result)) return Promise.resolve();
    const work = tail.then(async () => {
      const { tabCleanup = {} } = await chrome.storage.session.get({ tabCleanup: {} });
      await chrome.storage.session.set({ tabCleanup: { ...tabCleanup,
        [result]: Math.min(1000000, (tabCleanup[result] || 0) + 1), at: Date.now() } });
    });
    tail = work.catch(() => undefined);
    return tail;
  }
  function summary(readers, active, commentTab, commentActive, stats = {}, container) {
    const value = { activeReaders: 0, activeComments: commentTab && commentActive ? 1 : 0,
      parkedReaders: 0, closing: commentTab && !commentActive ? 1 : 0, idleReaders: 0,
      released: stats.released || 0, retryAt: commentTab?.closeAfter || 0 };
    for (const reader of Object.values(readers || {})) {
      if (active.has(reader.tabId)) value.activeReaders++;
      else if (reader.closing) value.closing++;
      else if (reader.continuation) value.parkedReaders++;
      else value.idleReaders++;
      if (reader.closeAfter) value.retryAt = value.retryAt ? Math.min(value.retryAt, reader.closeAfter) : reader.closeAfter;
    }
    for (const ref of Array.isArray(container) ? container : [container]) {
      if (!ref?.closing) continue;
      value.closing++;
      if (ref.closeAfter) value.retryAt = value.retryAt ? Math.min(value.retryAt, ref.closeAfter) : ref.closeAfter;
    }
    return value;
  }
  root.MyBotTabs = { bounded, lookup, inspect, close, samePostUrl, due, retry, note, summary };
})(typeof globalThis !== "undefined" ? globalThis : this);
