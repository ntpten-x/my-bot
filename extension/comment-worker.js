// Runs in the MV3 worker only. Nothing is exposed to Facebook page messages.
(function (root) {
  let busy = false;
  async function run(deps) {
    if (busy) return; busy = true;
    let tabId, job, cfg, authorizationRequested = false, sendInvoked = false, reportAttempted = false;
    const request = async body => {
      const response = await deps.postJson(cfg, "/api/v1/extension/comments", body, { retries: 0, timeoutMs: 15000 });
      if (!response.ok) throw new Error("comment request rejected");
      return response.json();
    };
    const report = async (outcome, commentUrl) => {
      reportAttempted = true;
      const stored = await chrome.storage.local.get({ commentJournal: null });
      const pendingReport = { outcome, ...(commentUrl ? { commentUrl } : {}) };
      const journal = stored.commentJournal || { id: job.id, claimToken: job.claimToken, apiBase: deps.base(cfg), state: sendInvoked ? "sending" : authorizationRequested ? "authorizing" : "claimed", at: Date.now() };
      await chrome.storage.local.set({ commentJournal: { ...journal, pendingReport } });
      const result = await request({ action: "report", id: job.id, claimToken: job.claimToken, ...pendingReport });
      if (result.ok !== true) throw new Error("report not acknowledged");
      await chrome.storage.local.remove("commentJournal");
    };
    try {
      cfg = await deps.loadConfig();
      const local = await chrome.storage.local.get({ commentJournal: null });
      if (cfg.accountPaused || !String(cfg.token).startsWith("mbd_") || local.commentJournal) return;
      if (await root.MyBotFocus.blocked()) return;
      const fbUserId = await deps.currentFbUserId(); if (!fbUserId) return;
      job = (await request({ action: "claim", fbUserId })).job; if (!job) return;
      await chrome.storage.local.set({ commentJournal: { id: job.id, claimToken: job.claimToken, apiBase: deps.base(cfg), state: "claimed", at: Date.now() } });
      if (!await root.MyBotFocus.take(job.id)) { await report("not_sent"); return; }
      const tab = await chrome.tabs.create({ url: job.externalUrl, active: true }); tabId = tab.id;
      await deps.waitComplete(tabId);
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      const execute = async (kind, payload = {}) => {
        let timer;
        try {
          const result = await Promise.race([
            chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: root.MyBotBrowserComment.action, args: [kind, { ...job, ...payload }] }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("comment page did not respond")), 5000); }),
          ]);
          return result[0]?.result || { ok: false, outcome: "failed" };
        } finally { clearTimeout(timer); }
      };
      let prepared;
      for (let attempt = 0; attempt < 8; attempt++) {
        prepared = await execute("prepare");
        if (prepared.ok || prepared.outcome === "blocked") break;
        await deps.sleep(1000);
      }
      if (!prepared?.ok) { await report(prepared?.outcome === "blocked" ? "blocked" : "failed"); return; }
      job.baseline = prepared.baseline; job.profiles = prepared.profiles || [];
      const latest = await deps.loadConfig();
      if (latest.accountPaused || deps.base(latest) !== deps.base(cfg) || latest.token !== cfg.token) { await report("failed"); return; }
      // This phase cannot invoke send. Recovery can report definite non-delivery even if authorization is lost.
      const started = Date.now();
      await chrome.storage.local.set({ commentJournal: { id: job.id, claimToken: job.claimToken, apiBase: deps.base(cfg), state: "authorizing", at: started, job: { ...job, sentAt: started } } });
      authorizationRequested = true;
      const grant = (await request({ action: "authorize", id: job.id, claimToken: job.claimToken, fbUserId })).grant;
      if (!grant || Date.now() - started >= grant.ttlMs) { await report("not_sent"); return; }
      const finalConfig = await deps.loadConfig();
      if (finalConfig.accountPaused || finalConfig.token !== cfg.token || deps.base(finalConfig) !== deps.base(cfg)) { await report("not_sent"); return; }
      // Persist ambiguity BEFORE executing the click; after this point no automatic resend is allowed.
      await chrome.storage.local.set({ commentJournal: { id: job.id, claimToken: job.claimToken, apiBase: deps.base(cfg), state: "sending", at: started, job: { ...job, sentAt: started } } });
      sendInvoked = true;
      const sent = await execute("send", { permitUntil: started + Math.min(3000, grant.ttlMs) });
      if (!sent.ok) { await report(sent.outcome === "blocked" ? "blocked" : "uncertain"); return; }
      let observed;
      for (let attempt = 0; attempt < 30; attempt++) {
        await deps.sleep(1000); observed = await execute("observe");
        if (observed.ok || observed.outcome === "blocked") break;
      }
      if (!observed?.ok && observed?.outcome !== "blocked") observed = await execute("reconcile", { baseline: job.baseline, profiles: job.profiles, sentAt: started });
      await report(observed?.outcome || "uncertain", observed?.commentUrl);
    } catch {
      if (job && !reportAttempted) await report(sendInvoked ? "uncertain" : authorizationRequested ? "not_sent" : "failed").catch(() => undefined);
      await deps.rememberError("งานคอมเมนต์หยุดหรือรอรายงานผล ตรวจประวัติก่อนเริ่มใหม่").catch(() => undefined);
    } finally {
      // A failed report stays durable; the next recovery retries that report, never the send.
      if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
      if (job) await root.MyBotFocus.release(job.id).catch(() => undefined);
      busy = false;
    }
  }
  async function recover(deps) {
    if (busy) return;
    const stored = await chrome.storage.local.get({ commentJournal: null }); const journal = stored.commentJournal;
    if (!journal) return;
    const cfg = await deps.loadConfig(); if (deps.base(cfg) !== journal.apiBase) return;
    try {
      let pendingReport = journal.pendingReport;
      if (!pendingReport) {
        let observed = null;
        if (journal.state === "sending" && journal.job && Date.now() - journal.at < 10 * 60000) {
          const tabs = await chrome.tabs.query({ url: ["https://www.facebook.com/groups/*", "https://web.facebook.com/groups/*"] });
          const tab = tabs.find(tab => tab.url?.split("?")[0].replace(/\/$/, "") === journal.job.externalUrl.replace(/\/$/, ""));
          if (tab?.id !== undefined) {
            const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: root.MyBotBrowserComment.action, args: ["reconcile", journal.job] });
            observed = results[0]?.result;
          }
        }
        pendingReport = { outcome: observed?.ok ? "observed" : journal.state === "sending" ? "uncertain" : journal.state === "authorizing" ? "not_sent" : "failed", ...(observed?.commentUrl ? { commentUrl: observed.commentUrl } : {}) };
        await chrome.storage.local.set({ commentJournal: { ...journal, pendingReport } });
      }
      const response = await deps.postJson(cfg, "/api/v1/extension/comments", { action: "report", id: journal.id, claimToken: journal.claimToken, ...pendingReport }, { retries: 0, timeoutMs: 15000 });
      if (response.ok && (await response.json()).ok === true) await chrome.storage.local.remove("commentJournal");
    } catch { /* no retry of sending */ }
  }
  root.MyBotCommentWorker = { run, recover };
})(typeof globalThis !== "undefined" ? globalThis : this);
