// Runs in the MV3 worker only. Nothing is exposed to Facebook page messages.
(function (root) {
  let busy = false;
  let draining = false;
  async function pageAction(tabId, kind, payload, timeoutMs = 5000) {
    let timer;
    try {
      const result = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: root.MyBotBrowserComment.action, args: [kind, payload] }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("comment page did not respond")), timeoutMs); }),
      ]);
      return result[0]?.result || { ok: false, outcome: "failed" };
    } finally { clearTimeout(timer); }
  }
  async function ownedCommentTab(ref) {
    if (!ref || !Number.isInteger(ref.tabId)) return null;
    const tab = await chrome.tabs.get(ref.tabId).catch(() => null);
    if (!tab) return null;
    try {
      const actual = new URL(tab.pendingUrl || tab.url), expected = new URL(ref.url);
      const hosts = ["www.facebook.com", "web.facebook.com", "facebook.com", "m.facebook.com"];
      if (actual.href === "about:blank" || (actual.protocol === "https:" && hosts.includes(actual.hostname) && hosts.includes(expected.hostname) &&
        actual.pathname.replace(/\/$/, "") === expected.pathname.replace(/\/$/, ""))) return tab;
    } catch { /* Navigated elsewhere: ownership belongs to the owner now. */ }
    return null;
  }
  async function closeCommentTab(ref) {
    if (!ref) return;
    const tab = await ownedCommentTab(ref);
    if (tab) await chrome.tabs.remove(tab.id); // Keep the session reference if removal fails.
    const stored = await chrome.storage.session.get({ commentTab: null });
    if (stored.commentTab?.tabId === ref.tabId && stored.commentTab?.jobId === ref.jobId) await chrome.storage.session.set({ commentTab: null });
  }
  async function run(deps, options = {}) {
    if (busy) return; busy = true;
    // Finish page work before the lease expires; reserve time to persist/report the outcome.
    let workDeadline = Math.min(Date.now() + 90_000, (options.deadlineMs || Infinity) - 15_000);
    const remaining = () => {
      const ms = workDeadline - Date.now();
      if (ms <= 0) throw new Error("comment work budget exhausted");
      return ms;
    };
    let tabId, owned, job, cfg, authorizationRequested = false, sendInvoked = false, reportAttempted = false;
    const request = async body => {
      const response = await deps.postJson(cfg, "/api/v1/extension/comments", body, { retries: 0, timeoutMs: body.action === "report" ? 15000 : Math.min(15000, remaining()) });
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
      if ((await chrome.storage.session.get({ commentTab: null })).commentTab) return;
      if (await root.MyBotFocus.blocked()) return;
      const fbUserId = await deps.currentFbUserId(); if (!fbUserId) return;
      job = (await request({ action: "claim", fbUserId })).job; if (!job) return;
      const leaseEnd = Date.parse(job.claimUntil || "");
      if (Number.isFinite(leaseEnd)) workDeadline = Math.min(workDeadline, leaseEnd - 15_000);
      await chrome.storage.local.set({ commentJournal: { id: job.id, claimToken: job.claimToken, apiBase: deps.base(cfg), state: "claimed", at: Date.now() } });
      if (!await root.MyBotFocus.take(job.id)) { await report("not_sent"); return; }
      remaining();
      const tab = await chrome.tabs.create({ url: job.externalUrl, active: true }); tabId = tab.id;
      owned = { jobId: job.id, tabId, url: job.externalUrl };
      await chrome.storage.session.set({ commentTab: owned });
      await deps.waitComplete(tabId, Math.min(25000, remaining()));
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      const execute = (kind, payload = {}) => pageAction(tabId, kind, { ...job, ...payload }, Math.min(5000, remaining()));
      let prepared;
      for (let attempt = 0; attempt < 8; attempt++) {
        prepared = await execute("prepare");
        if (prepared.ok || prepared.outcome === "blocked") break;
        await deps.sleep(Math.min(1000, remaining()));
      }
      if (!prepared?.ok) { await report(prepared?.outcome === "blocked" ? "blocked" : "failed"); return; }
      job.baseline = prepared.baseline; job.profiles = prepared.profiles || [];
      const latest = await deps.loadConfig();
      if (latest.accountPaused || deps.base(latest) !== deps.base(cfg) || latest.token !== cfg.token) { await report("failed"); return; }
      if (remaining() < 15000) { await report("failed"); return; }
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
      for (let attempt = 0; attempt < 30 && Date.now() < workDeadline; attempt++) {
        await deps.sleep(Math.min(1000, remaining())); observed = await execute("observe");
        if (observed.ok || observed.outcome === "blocked") break;
      }
      if (!observed?.ok && observed?.outcome !== "blocked" && Date.now() < workDeadline) observed = await execute("reconcile", { baseline: job.baseline, profiles: job.profiles, sentAt: started });
      await report(observed?.outcome || "uncertain", observed?.commentUrl);
      return observed?.ok === true && observed?.outcome === "observed" && Boolean(observed?.commentUrl);
    } catch {
      if (job && !reportAttempted) await report(sendInvoked ? "uncertain" : authorizationRequested ? "not_sent" : "failed").catch(() => undefined);
      await deps.rememberError("งานคอมเมนต์หยุดหรือรอรายงานผล ตรวจประวัติก่อนเริ่มใหม่").catch(() => undefined);
    } finally {
      // A failed report stays durable; the next recovery retries that report, never the send.
      await closeCommentTab(owned).catch(() => undefined);
      if (job) await root.MyBotFocus.release(job.id).catch(() => undefined);
      busy = false;
    }
  }
  async function recover(deps) {
    if (busy) return;
    busy = true;
    let owned;
    try {
      owned = (await chrome.storage.session.get({ commentTab: null })).commentTab;
      const stored = await chrome.storage.local.get({ commentJournal: null }); const journal = stored.commentJournal;
      if (!journal) return;
      const cfg = await deps.loadConfig(); if (deps.base(cfg) !== journal.apiBase) return;
      let pendingReport = journal.pendingReport;
      if (!pendingReport) {
        let observed = null;
        if (journal.state === "sending" && journal.job && Date.now() - journal.at < 10 * 60000) {
          const tab = owned?.jobId === journal.id ? await ownedCommentTab(owned) : null;
          if (tab?.id !== undefined) {
            observed = await pageAction(tab.id, "reconcile", journal.job);
          }
        }
        pendingReport = { outcome: observed?.ok ? "observed" : journal.state === "sending" ? "uncertain" : journal.state === "authorizing" ? "not_sent" : "failed", ...(observed?.commentUrl ? { commentUrl: observed.commentUrl } : {}) };
        await chrome.storage.local.set({ commentJournal: { ...journal, pendingReport } });
      }
      const response = await deps.postJson(cfg, "/api/v1/extension/comments", { action: "report", id: journal.id, claimToken: journal.claimToken, ...pendingReport }, { retries: 0, timeoutMs: 15000 });
      if (response.ok && (await response.json()).ok === true) await chrome.storage.local.remove("commentJournal");
    } catch { /* no retry of sending */ }
    finally {
      await closeCommentTab(owned).catch(() => undefined);
      if (owned) await root.MyBotFocus.release(owned.jobId).catch(() => undefined);
      busy = false;
    }
  }
  async function drain(deps) {
    if (draining) return;
    draining = true;
    const deadlineMs = Date.now() + 90_000;
    try {
      await recover(deps);
      // One visible send at a time. Each claim/authorize still checks server quotas and consent.
      for (let count = 0; count < 3 && deadlineMs - Date.now() >= 45_000; count++) {
        if (!await run(deps, { deadlineMs })) break;
      }
    } finally { draining = false; }
  }
  root.MyBotCommentWorker = { run, recover, drain };
})(typeof globalThis !== "undefined" ? globalThis : this);
