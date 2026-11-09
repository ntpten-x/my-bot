// Explicitly enabled browser delivery. Ordinary visible DOM only; no private APIs or evasion.
(function (root) {
  async function action(kind, payload, environment) {
    const doc = environment?.document || document;
    const loc = environment?.location || location;
    const now = environment?.now || Date.now;
    const view = doc.defaultView || globalThis;
    const memory = environment?.memory || globalThis;
    const visible = el => el && (environment?.visible ? environment.visible(el) : el.getClientRects().length > 0);
    const labelOf = el => [el.getAttribute("aria-label"), el.getAttribute("aria-placeholder"), el.getAttribute("placeholder")].filter(Boolean).join(" ");
    const normalize = text => String(text || "").replace(/\s+/g, " ").trim();
    const postParts = url => {
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" || !["www.facebook.com", "facebook.com", "web.facebook.com", "m.facebook.com"].includes(u.hostname)) return null;
        const m = u.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/(?:posts|permalink)\/(\d+)\/?$/);
        return m ? { group: m[1].toLowerCase(), id: m[2] } : null;
      } catch { return null; }
    };
    const postId = url => { const parts = postParts(url); return parts ? parts.group + ":" + parts.id : ""; };
    const samePost = (left, right) => {
      const a = postParts(left), b = postParts(right);
      if (!a || !b || a.id !== b.id) return false;
      const allowed = new Set([b.group, ...(payload.groupAliases || [])].map(value => String(value || "").toLowerCase()).filter(Boolean));
      return allowed.has(a.group);
    };
    const blocked = () => /\/(?:checkpoint|login|challenge)(?:\/|\?|$)/i.test(loc.href)
      || Boolean(doc.querySelector('iframe[src*="captcha"], [data-testid*="captcha"], form[action*="checkpoint"]'))
      || /temporarily blocked|ถูกบล็อกชั่วคราว|ยืนยันว่าคุณเป็นมนุษย์|confirm you.re human/i.test(doc.body?.innerText || doc.body?.textContent || "");
    const account = () => (doc.cookie.match(/(?:^|;\s*)c_user=(\d+)/) || [])[1] || "";
    const matchesPage = () => samePost(loc.href, payload.externalUrl) && account() === payload.fbUserId;
    const commentIdOf = href => {
      try {
        const u = new URL(href, loc.href);
        const fromQuery = u.searchParams.get("comment_id") || u.searchParams.get("reply_comment_id");
        if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
        const fromHash = (u.hash || "").match(/(?:comment_id|reply_comment_id)=(\d+)/);
        return fromHash ? fromHash[1] : "";
      } catch { return ""; }
    };
    const links = container => Array.from(container.querySelectorAll("a[href]")).map(a => {
      try {
        const href = a.getAttribute("href") || "";
        if (!/comment_id=|reply_comment_id=/.test(href)) return "";
        const u = new URL(href, loc.href);
        if (!commentIdOf(u.href) || !samePost(u.href, payload.externalUrl)) return "";
        return u.href;
      } catch { return ""; }
    }).filter(Boolean);
    const authorMatches = (node, profiles) => Array.from(node.querySelectorAll("a[href]")).some(author => {
      try {
        const u = new URL(author.getAttribute("href"), loc.href);
        if (!["www.facebook.com", "facebook.com", "web.facebook.com", "m.facebook.com"].includes(u.hostname)) return false;
        const path = u.pathname.replace(/\/$/, "") || "/";
        const allowed = (profiles || []).map(profile => String(profile || "").replace(/\/$/, "")).filter(Boolean);
        if (path === "/" + payload.fbUserId) return true;
        if (path === "/profile.php" && u.searchParams.get("id") === payload.fbUserId) return true;
        if (path === "/user/" + payload.fbUserId || path.startsWith("/user/" + payload.fbUserId + "/")) return true;
        return allowed.includes(path);
      } catch { return false; }
    });
    if (blocked()) return { ok: false, outcome: "blocked" };
    if (!matchesPage() || !payload.id || !payload.message || payload.message.length > 2000) {
      return { ok: false, outcome: "failed", reason: !matchesPage() ? "target_mismatch" : "invalid_payload" };
    }

    if (kind === "prepare") {
      // Nested dialogs represent one surface when they share the same composer.
      const dialogBoxes = Array.from(doc.querySelectorAll('[role="dialog"] [contenteditable="true"][role="textbox"], [role="dialog"] textarea'))
        .filter(el => visible(el) && /comment|แสดงความคิดเห็น|เขียนความคิดเห็น/i.test(labelOf(el)) && !/reply|ตอบกลับ|message|ข้อความ|search|ค้นหา/i.test(labelOf(el)));
      const dialogs = dialogBoxes.length === 1 ? [dialogBoxes[0].closest('[role="dialog"]')] : [];
      if (dialogBoxes.length > 1) return { ok: false, outcome: "failed", reason: "ambiguous_composer" };
      const articles = Array.from(doc.querySelectorAll('[role="main"] [role="article"], main [role="article"]')).filter(article =>
        !article.parentElement?.closest('[role="article"]') && Array.from(article.querySelectorAll("a[href]")).some(a => {
          try { return samePost(new URL(a.getAttribute("href"), loc.href).href, payload.externalUrl); } catch { return false; }
        }));
      if (!dialogs.length && articles.length === 0) {
        const loading = Boolean(doc.querySelector('[role="main"] [role="progressbar"], main [aria-busy="true"], [data-visualcompletion="loading-state"]'));
        return { ok: false, outcome: "failed", reason: loading ? "loading_retryable" : "unsupported_dom" };
      }
      if (!dialogs.length && articles.length !== 1) return { ok: false, outcome: "failed", reason: "ambiguous_composer" };
      const article = dialogs[0] || articles[0];
      const boxes = Array.from(article.querySelectorAll('[contenteditable="true"][role="textbox"],textarea')).filter(el => {
        const label = [el.getAttribute("aria-label"), el.getAttribute("aria-placeholder"), el.getAttribute("placeholder")].join(" ").toLowerCase();
        return visible(el) && /comment|แสดงความคิดเห็น|เขียนความคิดเห็น/.test(label) && !/reply|ตอบกลับ|message|ข้อความ|search|ค้นหา/.test(label);
      });
      if (boxes.length === 0) {
        const loading = Boolean(article.querySelector('[role="progressbar"], [aria-busy="true"], [data-visualcompletion="loading-state"]'));
        return { ok: false, outcome: "failed", reason: loading ? "loading_retryable" : "unsupported_dom" };
      }
      if (boxes.length !== 1) return { ok: false, outcome: "failed", reason: "ambiguous_composer" };
      const box = boxes[0];
      // Facebook often nests the composer without a real <form>; fall back to the article/dialog surface.
      const form = box.closest('form,[role="form"]') || (article.contains(box) ? article : null);
      if (!form || (!article.contains(form) && form !== article)) return { ok: false, outcome: "failed", reason: "unsupported_dom" };
      const prior = memory.__mybotCommentSession;
      const ownDraft = prior && prior.id === payload.id && prior.box === box && !prior.clicked && prior.message === payload.message && normalize(box.value ?? box.textContent) === normalize(payload.message);
      if (normalize(box.value ?? box.textContent) && !ownDraft) return { ok: false, outcome: "failed", reason: "owner_draft" };
      memory.__mybotCommentSession = { id: payload.id, box, article, before: prior?.id === payload.id ? prior.before : links(article), message: payload.message, at: now(), clicked: false };
      if (!environment && !doc.hasFocus()) return { ok: false, outcome: "failed", reason: "editor_requires_focused_tab" };
      box.focus();
      if (!ownDraft && box.tagName === "TEXTAREA") {
        const setter = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(box, payload.message); box.dispatchEvent(new view.Event("input", { bubbles: true }));
      } else if (!ownDraft && typeof doc.execCommand === "function") {
        // A background tab can retain a selection outside the focused Lexical editor.
        // Set the caret explicitly; never selectAll across the Facebook document.
        const selection = doc.getSelection();
        if (!selection) return { ok: false, outcome: "failed", reason: "selection_unavailable" };
        const range = doc.createRange();
        range.selectNodeContents(box); range.collapse(false);
        selection.removeAllRanges(); selection.addRange(range);
        try { doc.execCommand("insertText", false, payload.message); }
        catch { return { ok: false, outcome: "failed", reason: "editor_insert_failed" }; }
      }
      // Let the controlled editor commit its input before inspecting the submit control.
      if (!environment) await new Promise(resolve => setTimeout(resolve, 250));
      if (normalize(box.value ?? box.textContent) !== normalize(payload.message)) return { ok: false, outcome: "failed", reason: "editor_text_not_accepted" };
      const buttons = Array.from(form.querySelectorAll('button,[role="button"]')).filter(el => {
        const label = normalize(el.getAttribute("aria-label") || el.textContent).toLowerCase();
        return visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true" && /^(post a comment|post comment|comment|send|ส่ง|ส่งความคิดเห็น|โพสต์ความคิดเห็น|แสดงความคิดเห็น)$/.test(label);
      });
      if (buttons.length === 0) return { ok: false, outcome: "failed", reason: "submit_not_ready" };
      if (buttons.length !== 1) return { ok: false, outcome: "failed", reason: "submit_not_unique_or_ready" };
      memory.__mybotCommentSession = { id: payload.id, box, button: buttons[0], article, before: memory.__mybotCommentSession.before, message: payload.message, at: now(), clicked: false };
      const profiles = Array.from(doc.querySelectorAll('[role="banner"] a[href][aria-label],header a[href][aria-label]')).filter(a => visible(a) && /^(your profile|โปรไฟล์ของคุณ)$/i.test(a.getAttribute("aria-label") || "")).map(a => new URL(a.getAttribute("href"), loc.href).pathname.replace(/\/$/, ""));
      return { ok: true, baseline: memory.__mybotCommentSession.before.length <= 500 ? memory.__mybotCommentSession.before : null, profiles };
    }
    if (kind === "reconcile") {
      // Read only: no composer, focus, input or submit operations on this path.
      if (!Array.isArray(payload.baseline) || payload.baseline.length > 500 || !payload.sentAt || now() - payload.sentAt > 10 * 60_000) return { ok: false, outcome: "uncertain" };
      const surfaces = Array.from(doc.querySelectorAll('[role="main"],main,[role="dialog"]')).filter(el => Array.from(el.querySelectorAll("a[href]")).some(a => {
        try { return samePost(new URL(a.getAttribute("href"), loc.href).href, payload.externalUrl); } catch { return false; }
      }));
      const article = surfaces[0]; if (!article) return { ok: false, outcome: "uncertain" };
      memory.__mybotCommentSession = { id: payload.id, message: payload.message, article, before: payload.baseline, profiles: payload.profiles || [], clicked: true };
      kind = "observe";
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
      const profiles = session.profiles || payload.profiles || [];
      const needle = normalize(payload.message);
      for (const url of links(session.article)) {
        if ((session.before || []).includes(url)) continue;
        const anchor = Array.from(session.article.querySelectorAll("a[href]")).find(a => {
          try { return new URL(a.getAttribute("href"), loc.href).href === url; } catch { return false; }
        });
        const comment = anchor?.closest('[role="article"],[data-commentid],li,div');
        if (comment && comment !== session.article && normalize(comment.textContent).includes(needle) && authorMatches(comment, profiles)) {
          return { ok: true, outcome: "observed", commentUrl: url };
        }
      }
      // Facebook sometimes renders a fresh comment node with data-commentid before the permalink appears.
      for (const node of Array.from(session.article.querySelectorAll("[data-commentid], [aria-label*='Comment'], [aria-label*='ความคิดเห็น']"))) {
        if (node === session.article || !normalize(node.textContent).includes(needle) || !authorMatches(node, profiles)) continue;
        const id = node.getAttribute("data-commentid") || "";
        if (!/^\d+$/.test(id)) continue;
        try {
          const base = new URL(payload.externalUrl);
          base.searchParams.set("comment_id", id);
          const commentUrl = base.href;
          if ((session.before || []).includes(commentUrl)) continue;
          return { ok: true, outcome: "observed", commentUrl };
        } catch { /* keep scanning */ }
      }
      return { ok: false, outcome: "uncertain" };
    }
    return { ok: false, outcome: "failed" };
  }
  root.MyBotBrowserComment = { action };
  if (typeof module !== "undefined") module.exports = { action };
})(typeof globalThis !== "undefined" ? globalThis : this);
