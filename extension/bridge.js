// Runs only on the local MY-BOT app. Relays owner-triggered requests ("reply to this lead",
// "open the next queued lead when the gap allows") to the extension. It accepts messages from this page only.
(function () {
  document.documentElement.setAttribute("data-mybot-extension", "assist-2");
  const RELAYED = new Set(["assist-reply", "queue-advance", "queue-advance-cancel"]);
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "mybot-app" || !RELAYED.has(data.type)) return;
    const message =
      data.type === "assist-reply"
        ? {
            type: "assist-reply",
            url: String(data.url || ""),
            text: String(data.text || ""),
            nonce: String(data.nonce || ""),
            itemId: String(data.itemId || ""),
            postId: String(data.postId || ""),
            templates: Array.isArray(data.templates) ? data.templates.slice(0, 20) : [],
            prefs: data.prefs && typeof data.prefs === "object" ? data.prefs : {},
          }
        : { type: data.type };
    chrome.runtime.sendMessage(message, (response) => {
      void chrome.runtime.lastError;
      window.postMessage(
        {
          source: "mybot-ext",
          type: data.type === "assist-reply" ? "assist-ack" : `${data.type}-ack`,
          nonce: data.nonce,
          ok: Boolean(response && response.ok),
          error: response && response.error,
          at: response && response.at,
          reason: response && response.reason,
        },
        location.origin,
      );
    });
  });
})();
