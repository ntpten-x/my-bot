// Read-only: tells MY-BOT whether this browser is logged in to Facebook and as which account.
// It reads the c_user cookie value (the numeric account id) that facebook.com exposes to its own pages,
// and a best-effort display name from links already on the page. It never clicks, types, sends,
// or calls any Facebook API.
(function (root) {
  function cookieValue(cookieText, name) {
    const parts = String(cookieText || "").split(/;\s*/);
    for (const part of parts) {
      const index = part.indexOf("=");
      if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
    }
    return "";
  }

  function cleanName(value) {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 60) return "";
    if (/^(facebook|home|หน้าหลัก|โปรไฟล์|profile|your profile|โปรไฟล์ของคุณ)$/i.test(name)) return "";
    return name;
  }

  // Links to the logged-in account's own profile (left menu, composer, account menu).
  function findName(doc, id) {
    if (!doc || !id || typeof doc.querySelectorAll !== "function") return "";
    const links = doc.querySelectorAll(`a[href*="${id}"]`);
    for (const link of Array.from(links || [])) {
      const href = String((link.getAttribute && link.getAttribute("href")) || "");
      if (!new RegExp(`(profile\\.php\\?id=${id}(&|$))|(/${id}/?($|\\?))`).test(href)) continue;
      const label = cleanName(link.getAttribute && link.getAttribute("aria-label"));
      if (label) return label;
      const text = cleanName(link.textContent);
      if (text) return text;
    }
    return "";
  }

  function readFacebookIdentity(doc) {
    const id = cookieValue(doc && doc.cookie, "c_user");
    if (!/^\d{5,20}$/.test(id)) return { loggedIn: false, id: "", name: "" };
    return { loggedIn: true, id, name: findName(doc, id) };
  }

  const api = { cookieValue, readFacebookIdentity, findName };
  root.MyBotIdentity = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // Content-script mode: report once after load and once more when the page has rendered its menus.
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage && typeof document !== "undefined") {
    const report = () => {
      try {
        const identity = readFacebookIdentity(document);
        chrome.runtime.sendMessage({ type: "fb-identity", identity, url: location.origin }, () => void chrome.runtime.lastError);
      } catch {
        // extension reloaded — ignore
      }
    };
    setTimeout(report, 1500);
    setTimeout(report, 8000);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
