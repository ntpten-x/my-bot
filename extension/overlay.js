// Floating MY-BOT helper shown on a Facebook post the owner opened from MY-BOT.
// It lets the owner edit the draft or switch templates, puts the text into the comment box,
// and records "ส่งแล้ว / ข้าม" in MY-BOT. The owner always presses Facebook's own send button:
// this file never clicks anything on the page, never fakes key presses and never calls Facebook APIs.
(function (root) {
  const WATCH_MS = 15 * 60 * 1000;
  const STYLE = `
    :host { all: initial; }
    .box { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: 340px; max-width: calc(100vw - 32px);
      background: #fffaf2; color: #1c1612; border: 1px solid #e3d5c3; border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.22);
      font: 13px/1.45 "Segoe UI", Tahoma, sans-serif; padding: 12px; box-sizing: border-box; }
    .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .title { font-weight: 700; margin-right: auto; }
    .muted { color: #6f6256; font-size: 12px; }
    select, textarea { width: 100%; box-sizing: border-box; margin-top: 6px; border: 1px solid #e3d5c3; border-radius: 8px; padding: 6px; font: inherit; background: #fff; color: inherit; }
    textarea { min-height: 84px; resize: vertical; }
    button { border: 0; border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer; background: #efe4d3; color: #1c1612; }
    button.primary { background: #c24e1d; color: #fff; }
    button.pine { background: #1e6a45; color: #fff; }
    button.ghost { background: transparent; padding: 2px 6px; }
    button:disabled { opacity: .5; cursor: default; }
    .actions { margin-top: 8px; }
    .status { margin-top: 6px; min-height: 1.2em; }
    .hint { outline: 2px solid #1e6a45; outline-offset: 2px; }
    .countdown { margin-top: 6px; padding: 6px 8px; border-radius: 8px; background: #e8f3ec; }
    [hidden] { display: none !important; }
  `;

  function defaultSend(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response || { ok: false, error: "ส่วนขยายไม่ตอบ ลองรีเฟรชหน้านี้" });
        });
      } catch {
        resolve({ ok: false, error: "ส่วนขยายถูกโหลดใหม่ รีเฟรชหน้านี้ก่อน" });
      }
    });
  }

  function defaultListen(handler) {
    try {
      chrome.runtime.onMessage.addListener(handler);
    } catch {
      // no extension context (tests)
    }
  }

  function clock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function mount(payload, deps) {
    const options = deps || {};
    const doc = options.doc || root.document;
    const view = doc.defaultView || root;
    const assist = options.assist || root.MyBotAssist;
    const send = options.send || defaultSend;
    const listen = options.listen || defaultListen;
    const now = options.now || Date.now;
    const data = payload || {};
    const prefs = data.prefs || {};
    const templates = Array.isArray(data.templates) ? data.templates.slice(0, 20) : [];
    const original = String(data.text || "").slice(0, assist.MAX_TEXT);
    const canFinish = Boolean(data.itemId || data.postId);

    const old = doc.querySelector("[data-mybot-overlay]");
    if (old) old.remove();
    const host = doc.createElement("div");
    host.setAttribute("data-mybot-overlay", "1");
    const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    // Typing in the overlay must not trigger Facebook's page-wide shortcuts. Listening only; nothing is dispatched.
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.stopPropagation());

    const style = doc.createElement("style");
    style.textContent = STYLE;
    const box = doc.createElement("div");
    box.className = "box";
    box.innerHTML = `
      <div class="row"><span class="title">MY-BOT ตอบลีด</span><button class="ghost" data-k="close" title="ปิด">✕</button></div>
      <div class="muted">แก้ข้อความได้ก่อนใส่ แล้วคุณกดส่งในช่องคอมเมนต์ของ Facebook เอง</div>
      <select data-k="template"></select>
      <textarea data-k="draft" maxlength="${assist.MAX_TEXT}"></textarea>
      <div class="row actions">
        <button class="primary" data-k="insert">ใส่ลงช่องคอมเมนต์</button>
        <button class="pine" data-k="sent">ส่งแล้ว</button>
        <button data-k="skip">ข้าม</button>
      </div>
      <div class="status" data-k="status" role="status"></div>
      <div class="countdown" data-k="countdown" hidden><span data-k="countdownText"></span> <button class="ghost" data-k="cancel">ยกเลิก</button></div>
      <div class="muted" data-k="shortcut">คีย์ลัด: Alt+Shift+S ส่งแล้ว · Alt+Shift+K ข้าม</div>
    `;
    shadow.appendChild(style);
    shadow.appendChild(box);
    (doc.body || doc.documentElement).appendChild(host);

    const $ = (key) => box.querySelector(`[data-k="${key}"]`);
    const select = $("template");
    const draft = $("draft");
    const insertBtn = $("insert");
    const sentBtn = $("sent");
    const skipBtn = $("skip");
    const status = $("status");
    const countdown = $("countdown");
    const countdownText = $("countdownText");

    const first = doc.createElement("option");
    first.value = "";
    first.textContent = templates.length ? "ข้อความที่เตรียมไว้" : "ข้อความที่เตรียมไว้ (ยังไม่มีข้อความสำเร็จรูป)";
    select.appendChild(first);
    for (const template of templates) {
      const option = doc.createElement("option");
      option.value = String(template.id);
      option.textContent = String(template.name || "ข้อความสำเร็จรูป").slice(0, 60);
      select.appendChild(option);
    }
    select.hidden = !templates.length;
    draft.value = original;
    sentBtn.hidden = !canFinish;
    skipBtn.hidden = !data.itemId;
    $("shortcut").hidden = !canFinish;

    const state = { inserted: false, insertedText: "", baseline: 0, finished: false, detected: false, busy: false, advanceAt: 0 };
    let observer = null;
    let watchTimer = null;
    let watchStop = null;
    let tick = null;

    function say(message) {
      status.textContent = message;
    }

    function stopWatch() {
      if (observer) observer.disconnect();
      observer = null;
      if (watchTimer) view.clearInterval(watchTimer);
      if (watchStop) view.clearTimeout(watchStop);
      watchTimer = null;
      watchStop = null;
    }

    function check() {
      if (state.finished || state.detected || !state.insertedText) return;
      if (!assist.looksSent(doc, state.insertedText, state.baseline)) return;
      state.detected = true;
      stopWatch();
      if (prefs.autoMarkSent && canFinish) {
        say("เห็นคอมเมนต์ของคุณบนหน้าแล้ว กำลังบันทึกว่าส่งแล้ว…");
        void finish("sent", true);
      } else {
        say("เห็นคอมเมนต์ของคุณบนหน้าแล้ว กด “ส่งแล้ว” เพื่อบันทึก");
        sentBtn.classList.add("hint");
      }
    }

    // Passive: only reads the page when it changes. Never clicks or types anything on Facebook.
    function startWatch() {
      stopWatch();
      if (!canFinish) return;
      if (typeof view.MutationObserver === "function" && doc.body) {
        let pending = false;
        observer = new view.MutationObserver(() => {
          if (pending) return;
          pending = true;
          view.setTimeout(() => {
            pending = false;
            check();
          }, 800);
        });
        observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
      }
      watchTimer = view.setInterval(check, 3000);
      watchStop = view.setTimeout(stopWatch, WATCH_MS);
    }

    async function insert() {
      if (state.finished || state.busy) return { ok: false };
      const text = draft.value.trim().slice(0, assist.MAX_TEXT);
      if (!text) {
        say("ข้อความว่าง");
        return { ok: false };
      }
      state.busy = true;
      insertBtn.disabled = true;
      say("กำลังหาช่องคอมเมนต์…");
      state.baseline = assist.countPosted(doc, text);
      const result = await assist.runAssist(text, { doc, timeoutMs: options.timeoutMs, intervalMs: options.intervalMs });
      state.busy = false;
      insertBtn.disabled = false;
      if (result && result.ok) {
        state.inserted = true;
        state.insertedText = text;
        state.detected = false;
        insertBtn.textContent = "ใส่ใหม่ (แทนข้อความเดิม)";
        say(canFinish ? "ใส่ข้อความแล้ว ตรวจแล้วกดส่งใน Facebook เอง จากนั้นกด “ส่งแล้ว”" : "ใส่ข้อความแล้ว ตรวจแล้วกดส่งใน Facebook เอง");
        startWatch();
      } else {
        say("หาช่องคอมเมนต์ไม่เจอ คัดลอกข้อความไว้แล้ว วางแล้วกดส่งเอง");
      }
      return result || { ok: false };
    }

    function showCountdown(at) {
      state.advanceAt = at;
      countdown.hidden = false;
      if (tick) view.clearInterval(tick);
      const render = () => {
        const left = state.advanceAt - now();
        countdownText.textContent = left > 0 ? `จะเปิดลีดถัดไปใน ${clock(left)} นาที` : "กำลังเปิดลีดถัดไป…";
      };
      render();
      tick = view.setInterval(render, 1000);
    }

    function hideCountdown(message) {
      if (tick) view.clearInterval(tick);
      tick = null;
      state.advanceAt = 0;
      countdown.hidden = true;
      if (message) say(message);
    }

    function applyAdvance(advance) {
      if (advance && advance.at) showCountdown(Number(advance.at));
      else if (advance && advance.reason) hideCountdown(`${status.textContent} · ${advance.reason}`);
    }

    async function finish(action, detected) {
      if (state.finished || state.busy || !canFinish) return { ok: false };
      if (action === "skip" && !data.itemId) return { ok: false };
      state.busy = true;
      sentBtn.disabled = true;
      skipBtn.disabled = true;
      const response = await send({ type: "assist-finish", action, text: draft.value.trim().slice(0, assist.MAX_TEXT), detected: Boolean(detected) });
      state.busy = false;
      if (!response || !response.ok) {
        sentBtn.disabled = false;
        skipBtn.disabled = false;
        say((response && response.error) || "บันทึกไม่สำเร็จ");
        return response || { ok: false };
      }
      state.finished = true;
      stopWatch();
      insertBtn.disabled = true;
      draft.disabled = true;
      select.disabled = true;
      sentBtn.classList.remove("hint");
      say(action === "sent" ? "บันทึกว่าตอบแล้ว" : "ข้ามลีดนี้แล้ว");
      applyAdvance(response.advance);
      return response;
    }

    async function cancelAdvance() {
      await send({ type: "assist-advance-cancel" });
      hideCountdown("ยกเลิกการเปิดลีดถัดไปอัตโนมัติแล้ว เปิดต่อได้จากหน้า MY-BOT");
    }

    function destroy() {
      stopWatch();
      if (tick) view.clearInterval(tick);
      host.remove();
    }

    select.addEventListener("change", () => {
      const picked = templates.find((template) => String(template.id) === select.value);
      draft.value = picked ? String(picked.text || "").slice(0, assist.MAX_TEXT) : original;
    });
    insertBtn.addEventListener("click", () => void insert());
    sentBtn.addEventListener("click", () => void finish("sent", state.detected));
    skipBtn.addEventListener("click", () => void finish("skip", false));
    $("cancel").addEventListener("click", () => void cancelAdvance());
    $("close").addEventListener("click", destroy);

    listen((message, _sender, sendResponse) => {
      if (!message || !host.isConnected) return;
      if (message.type === "command-finish" && (message.action === "sent" || message.action === "skip")) {
        if (typeof sendResponse === "function") sendResponse({ handled: canFinish && !state.finished });
        void finish(message.action, state.detected);
      } else if (message.type === "advance-status") {
        if (message.at) showCountdown(Number(message.at));
        else hideCountdown(message.reason || "");
      }
    });

    if (prefs.autoInsert) void insert();
    else say("ตรวจหรือแก้ข้อความ แล้วกด “ใส่ลงช่องคอมเมนต์”");

    return { host, state, insert, finish, destroy, check, elements: { select, draft, insertBtn, sentBtn, skipBtn, status, countdown, countdownText } };
  }

  const api = { mount };
  root.MyBotOverlay = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
