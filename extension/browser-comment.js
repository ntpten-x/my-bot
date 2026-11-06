// Explicitly enabled browser delivery. Ordinary visible DOM only; no private APIs or evasion.
(function (root) {
  async function action(kind, payload, environment) {
    const doc = environment?.document || document;
    const loc = environment?.location || location;
    const now = environment?.now || Date.now;
    const view = doc.defaultView || globalThis;
    const memory = environment?.memory || globalThis;
    const visible = el => el && (environment?.visible ? environment.visible(el) : el.getClientRects().length > 0);
    const normalize = text => String(text || "").replace(/\s+/g, " ").trim();
    const postId = url => {
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" || !["www.facebook.com", "facebook.com", "web.facebook.com", "m.facebook.com"].includes(u.hostname)) return "";
        const m = u.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/(?:posts|permalink)\/(\d+)\/?$/);
        return m ? m[1] + ":" + m[2] : "";
      } catch { return ""; }
    };
    const blocked = () => /\/(?:checkpoint|login|challenge)(?:\/|\?|$)/i.test(loc.href)
      || Boolean(doc.querySelector('iframe[src*="captcha"], [data-testid*="captcha"], form[action*="checkpoint"]'))
      || /temporarily blocked|ถูกบล็อกชั่วคราว|ยืนยันว่าคุณเป็นมนุษย์|confirm you.re human/i.test(doc.body?.innerText || doc.body?.textContent || "");
    const account = () => (doc.cookie.match(/(?:^|;\s*)c_user=(\d+)/) || [])[1] || "";
    const matchesPage = () => postId(loc.href) && postId(loc.href) === postId(payload.externalUrl) && account() === payload.fbUserId;
    const links = container => Array.from(container.querySelectorAll('a[href*="comment_id="]')).map(a => {
      try { const u = new URL(a.getAttribute("href"), loc.href); return postId(u.href) === postId(payload.externalUrl) ? u.href : ""; } catch { return ""; }
    }).filter(Boolean);
    if (blocked()) return { ok: false, outcome: "blocked" };
    if (!matchesPage() || !payload.id || !payload.message || payload.message.length > 2000) return { ok: false, outcome: "failed" };

    if (kind === "prepare") {
      const articles = Array.from(doc.querySelectorAll('[role="main"] [role="article"], main [role="article"]')).filter(article =>
        !article.parentElement?.closest('[role="article"]') && Array.from(article.querySelectorAll("a[href]")).some(a => {
          try { return postId(new URL(a.getAttribute("href"), loc.href).href) === postId(payload.externalUrl); } catch { return false; }
        }));
      if (articles.length !== 1) return { ok: false, outcome: "failed" };
      const article = articles[0];
      const boxes = Array.from(article.querySelectorAll('[contenteditable="true"][role="textbox"],textarea')).filter(el => {
        const label = [el.getAttribute("aria-label"), el.getAttribute("aria-placeholder"), el.getAttribute("placeholder")].join(" ").toLowerCase();
        return visible(el) && /comment|แสดงความคิดเห็น/.test(label) && !/reply|ตอบกลับ|message|ข้อความ|search|ค้นหา/.test(label);
      });
      if (boxes.length !== 1) return { ok: false, outcome: "failed" };
      const box = boxes[0], form = box.closest('form,[role="form"]');
      if (!form || !article.contains(form)) return { ok: false, outcome: "failed" };
      if (normalize(box.value ?? box.textContent)) return { ok: false, outcome: "failed" };
      box.focus();
      if (box.tagName === "TEXTAREA") {
        const setter = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(box, payload.message); box.dispatchEvent(new view.Event("input", { bubbles: true }));
      } else if (typeof doc.execCommand === "function") doc.execCommand("insertText", false, payload.message);
      if (normalize(box.value ?? box.textContent) !== normalize(payload.message)) return { ok: false, outcome: "failed" };
      const buttons = Array.from(form.querySelectorAll('button,[role="button"]')).filter(el => {
        const label = normalize(el.getAttribute("aria-label") || el.textContent).toLowerCase();
        return visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true" && /^(post a comment|post comment|comment|send|ส่ง|ส่งความคิดเห็น|แสดงความคิดเห็น)$/.test(label);
      });
      if (buttons.length !== 1) return { ok: false, outcome: "failed" };
      memory.__mybotCommentSession = { id: payload.id, box, button: buttons[0], article, before: links(article), message: payload.message, at: now(), clicked: false };
      return { ok: true };
    }
    const session = memory.__mybotCommentSession;
    if (!session || session.id !== payload.id || session.message !== payload.message || !session.article.isConnected) return { ok: false, outcome: "uncertain" };
    if (kind === "send") {
      if (session.clicked || now() - session.at > 120000 || !payload.permitUntil || now() >= payload.permitUntil || payload.permitUntil - now() > 3000
        || !session.box.isConnected || !visible(session.button) || session.button.disabled || session.button.getAttribute("aria-disabled") === "true"
        || normalize(session.box.value ?? session.box.textContent) !== normalize(payload.message)) return { ok: false, outcome: "uncertain" };
      session.clicked = true; // Set BEFORE click; never retry the button even if click throws.
      try { session.button.click(); return { ok: true }; } catch { return { ok: false, outcome: "uncertain" }; }
    }
    if (kind === "observe") {
      if (!session.clicked) return { ok: false, outcome: "uncertain" };
      for (const url of links(session.article)) {
        if (session.before.includes(url)) continue;
        const anchor = Array.from(session.article.querySelectorAll("a[href]")).find(a => {
          try { return new URL(a.getAttribute("href"), loc.href).href === url; } catch { return false; }
        });
        const comment = anchor?.closest('[role="article"],[data-commentid]');
        if (comment && comment !== session.article && normalize(comment.textContent).includes(normalize(payload.message))
          && Array.from(comment.querySelectorAll("a[href]")).some(author => {
            try { const u = new URL(author.getAttribute("href"), loc.href); return ["www.facebook.com", "facebook.com", "web.facebook.com", "m.facebook.com"].includes(u.hostname) && (u.pathname.replace(/\/$/, "") === "/" + payload.fbUserId || (u.pathname === "/profile.php" && u.searchParams.get("id") === payload.fbUserId)); } catch { return false; }
          })) return { ok: true, outcome: "observed", commentUrl: url };
      }
      return { ok: false, outcome: "uncertain" };
    }
    return { ok: false, outcome: "failed" };
  }
  root.MyBotBrowserComment = { action };
  if (typeof module !== "undefined") module.exports = { action };
})(typeof globalThis !== "undefined" ? globalThis : this);
