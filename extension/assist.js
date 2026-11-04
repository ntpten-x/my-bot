// Assisted reply: types the owner's chosen draft into a Facebook comment box.
// It only runs when the owner pressed "ตอบลีดนี้" in MY-BOT for this exact post.
// It never presses Enter, never clicks any button, never sends messages and never calls Facebook APIs.
(function (root) {
  const COMMENT_HINTS = ["comment", "ความคิดเห็น", "แสดงความคิดเห็น", "ตอบกลับ", "reply", "answer"];
  const AVOID_HINTS = ["message", "messenger", "ข้อความถึง", "ส่งข้อความ", "แชท", "chat", "search", "ค้นหา", "สร้างโพสต์", "create a post", "write something"];
  const MAX_TEXT = 2000;

  function isFacebookUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && /(^|\.)facebook\.com$/.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  // Stable id for a post URL so redirects like /posts/ID -> /permalink/ID still match.
  function postKey(url) {
    if (!isFacebookUrl(url)) return "";
    const parsed = new URL(url);
    for (const name of ["story_fbid", "multi_permalinks", "fbid"]) {
      const value = parsed.searchParams.get(name);
      if (value) return value.split(",")[0];
    }
    const match = parsed.pathname.match(/\/(?:posts|permalink|videos)\/([\w.-]+)/i);
    return match ? match[1] : "";
  }

  function labelOf(el) {
    return [el.getAttribute && el.getAttribute("aria-label"), el.getAttribute && el.getAttribute("aria-placeholder"), el.getAttribute && el.getAttribute("placeholder")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function scoreBox(el) {
    const label = labelOf(el);
    if (AVOID_HINTS.some((hint) => label.includes(hint))) return -1;
    if (COMMENT_HINTS.some((hint) => label.includes(hint))) return 2;
    return 0;
  }

  function visible(el) {
    if (typeof el.getClientRects !== "function") return true;
    return el.getClientRects().length > 0;
  }

  function findCommentBox(doc) {
    const nodes = Array.from(doc.querySelectorAll('[contenteditable="true"][role="textbox"], textarea'));
    let best = null;
    let bestScore = 0;
    for (const el of nodes) {
      if (!visible(el)) continue;
      const score = scoreBox(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function currentText(el) {
    return String(el.value !== undefined && el.tagName === "TEXTAREA" ? el.value : el.textContent || "");
  }

  function hasText(el, text) {
    const probe = text.replace(/\s+/g, " ").trim().slice(0, 24);
    return currentText(el).replace(/\s+/g, " ").includes(probe);
  }

  // Puts text in the box like a paste would. No key events, so nothing can submit.
  function insertReply(doc, el, text) {
    const value = String(text || "").slice(0, MAX_TEXT);
    if (!el || !value) return false;
    if (typeof el.focus === "function") el.focus();
    if (el.tagName === "TEXTAREA") {
      el.value = value;
      el.dispatchEvent(new (doc.defaultView || root).Event("input", { bubbles: true }));
      return hasText(el, value);
    }
    if (typeof doc.execCommand === "function") {
      try {
        // Replace what is already in the box (re-insert after editing) instead of appending.
        if (currentText(el).trim()) doc.execCommand("selectAll", false);
        doc.execCommand("insertText", false, value);
      } catch {
        // fall through
      }
    }
    if (hasText(el, value)) return true;
    const View = doc.defaultView || root;
    if (typeof View.InputEvent === "function") {
      el.dispatchEvent(new View.InputEvent("beforeinput", { inputType: "insertText", data: value, bubbles: true, cancelable: true }));
    }
    return hasText(el, value);
  }

  function toast(doc, message, ok) {
    const box = doc.createElement("div");
    box.textContent = message;
    box.setAttribute("data-mybot-toast", ok ? "ok" : "fallback");
    box.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 16px;border-radius:12px;font:14px sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);background:" +
      (ok ? "#1e6a45" : "#b45309");
    (doc.body || doc.documentElement).appendChild(box);
    setTimeout(() => box.remove(), 7000);
  }

  async function copyFallback(doc, text) {
    try {
      const nav = (doc.defaultView || root).navigator;
      if (nav && nav.clipboard) await nav.clipboard.writeText(text);
    } catch {
      // MY-BOT already copied it before opening this tab.
    }
  }

  async function runAssist(text, options) {
    const doc = (options && options.doc) || root.document;
    const timeoutMs = (options && options.timeoutMs) || 15000;
    const intervalMs = (options && options.intervalMs) || 500;
    const value = String(text || "").slice(0, MAX_TEXT);
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const box = findCommentBox(doc);
      if (box && insertReply(doc, box, value)) {
        toast(doc, "MY-BOT ใส่ข้อความแล้ว — ตรวจแล้วกดส่งเอง", true);
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    await copyFallback(doc, value);
    toast(doc, "หาช่องคอมเมนต์ไม่เจอ — คัดลอกข้อความไว้แล้ว วางแล้วกดส่งเอง", false);
    return { ok: false };
  }

  // ---- Passive "did the owner send it?" check. Reads the page only; never touches Facebook's UI. ----
  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function probeOf(text) {
    return normalize(text).slice(0, 40);
  }

  // Counts rendered (non-editable) page elements that show the reply text, e.g. the owner's new comment.
  function countPosted(doc, text) {
    const probe = probeOf(text);
    if (probe.length < 6) return 0;
    let count = 0;
    for (const el of Array.from(doc.querySelectorAll('[role="article"], [dir="auto"]'))) {
      if (el.closest && el.closest('[contenteditable="true"], textarea, [data-mybot-overlay]')) continue;
      if (el.isContentEditable) continue;
      if (normalize(el.textContent).includes(probe)) count += 1;
    }
    return count;
  }

  // The reply looks sent when it now shows up outside the comment box (more than before inserting)
  // and the comment box no longer holds it (Facebook clears the box after the owner presses send).
  function looksSent(doc, text, baseline) {
    if (countPosted(doc, text) <= (baseline || 0)) return false;
    const probe = probeOf(text);
    const box = findCommentBox(doc);
    if (box && normalize(currentText(box)).includes(probe)) return false;
    return true;
  }

  const api = { isFacebookUrl, postKey, findCommentBox, insertReply, runAssist, countPosted, looksSent, normalize, MAX_TEXT };
  root.MyBotAssist = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
