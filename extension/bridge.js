// Runs only on the local MY-BOT app. Relays an owner-triggered "reply to this lead" request
// to the extension. It accepts messages from this page only.
(function () {
  document.documentElement.setAttribute("data-mybot-extension", "assist-1");
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "mybot-app" || data.type !== "assist-reply") return;
    chrome.runtime.sendMessage(
      { type: "assist-reply", url: String(data.url || ""), text: String(data.text || ""), nonce: String(data.nonce || "") },
      (response) => {
        void chrome.runtime.lastError;
        window.postMessage({ source: "mybot-ext", type: "assist-ack", nonce: data.nonce, ok: Boolean(response && response.ok), error: response && response.error }, location.origin);
      },
    );
  });
})();
