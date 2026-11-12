// Offline verification only: execute existing MV3 queue/recovery code in isolated mocks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = new URL('../extension/', import.meta.url);
const source = name => readFileSync(new URL(name, root), 'utf8');
const instant = Date.parse('2026-11-12T00:00:00Z');
class Clock extends Date { static now() { return instant; } }
function storage(stored) {
  return {
    get: async defaults => ({ ...defaults, ...structuredClone(stored) }),
    set: async patch => Object.assign(stored, structuredClone(patch)),
    remove: async key => { delete stored[key]; },
  };
}
function feedWorker(stored, transport) {
  const context = vm.createContext({ Date: Clock, Set, Map, crypto: webcrypto,
    postJson: transport, RETRY_STATUS: new Set([408, 429, 502, 503, 504]),
    base: cfg => cfg.apiBase, countSent: async () => {}, rememberError: async () => {},
    chrome: { storage: { local: storage(stored) }, alarms: { create: async () => {} } },
  });
  // Same isolated source boundaries used by tests/extension/outbox.test.ts.
  const background = source('background.js');
  const start = background.indexOf('const OUTBOX_MAX =');
  const end = background.indexOf('async function countSent');
  assert(start >= 0 && end > start, 'queue harness boundaries changed');
  vm.runInContext(background.slice(start, end), context);
  return {
    queue: item => vm.runInContext('queueOutbox', context)(item),
    flush: () => vm.runInContext('flushOutbox', context)({ apiBase: 'https://owner.example', token: 'mbd_synthetic' }),
  };
}
function commentWorker(stored, transport, effects) {
  const forbidden = kind => async () => { effects[kind]++; throw new Error('Unexpected browser operation'); };
  const context = vm.createContext({ Date: Clock, URL, setTimeout, clearTimeout, AbortController,
    chrome: { storage: { local: storage(stored), session: storage({}) },
      tabs: { create: forbidden('tabsCreated') }, scripting: { executeScript: forbidden('pageActions') } },
    MyBotBrowserComment: { action: () => {} },
  });
  for (const name of ['focus.js', 'tab-lifecycle.js', 'comment-worker.js']) vm.runInContext(source(name), context);
  const deps = { loadConfig: async () => ({ apiBase: 'https://owner.example', token: 'mbd_synthetic' }),
    base: cfg => cfg.apiBase, postJson: transport, rememberError: async () => {} };
  return { run: () => context.MyBotCommentWorker.run(deps), recover: () => context.MyBotCommentWorker.recover(deps) };
}
const pendingPosts = stored => [...stored.outbox ?? [], ...stored.captureJournal ?? []].flatMap(row => row.posts ?? []);

export async function verifyAutomationRecovery() {
  const local = { outbox: [], captureJournal: [] };
  let mode = 'outage';
  const transport = async (_cfg, _url, body) => ({ status: mode === 'outage' ? 503 : 200, ok: mode !== 'outage',
    json: async () => mode === 'ack' ? { batchId: body.batchId, receipts: body.posts.map(post => ({ itemId: post.itemId, outcome: 'accepted' })) } : {},
  });
  let feed = feedWorker(local, transport);
  const posts = [1, 2].map(id => ({ url: `https://www.facebook.com/groups/123/posts/${id}`, text: 'SYNTHETIC', observedAt: instant - 1000 }));
  await feed.queue({ sourceUrl: 'https://www.facebook.com/groups/123', apiBase: 'https://owner.example', posts });
  const queuedPosts = pendingPosts(local).length;
  assert.equal(queuedPosts, 2);
  await feed.flush();
  const afterOutage = pendingPosts(local).length;
  assert.equal(afterOutage, 2);
  // New context discards in-memory locks/state and retains only durable local storage.
  feed = feedWorker(local, transport);
  const afterRestart = pendingPosts(local).length;
  assert.equal(afterRestart, 2);
  mode = 'no-receipts';
  await feed.flush();
  const afterUnacknowledged = pendingPosts(local).length;
  assert.equal(afterUnacknowledged, 2);
  const originalObservedAtPreserved = pendingPosts(local).every(post => post.observedAt === instant - 1000);
  assert(originalObservedAtPreserved);
  mode = 'ack';
  await feed.flush();
  const afterAcknowledged = pendingPosts(local).length;
  assert.equal(afterAcknowledged, 0);

  const journal = { commentJournal: { id: 'synthetic-job', claimToken: 'synthetic-claim', apiBase: 'https://owner.example', state: 'sending', at: instant } };
  const effects = { claims: 0, authorizations: 0, pageActions: 0, tabsCreated: 0 };
  const reportOutcomes = [];
  let available = false;
  const commentsTransport = async (_cfg, _url, body) => {
    if (body.action === 'claim') effects.claims++;
    if (body.action === 'authorize') effects.authorizations++;
    assert.equal(body.action, 'report', 'recovery must only report');
    reportOutcomes.push(body.outcome);
    if (!available) throw new Error('Synthetic lost report');
    return { ok: true, json: async () => ({ ok: true }) };
  };
  let comments = commentWorker(journal, commentsTransport, effects);
  await comments.run(); // Journal blocks new claims before recovery.
  await comments.recover();
  const pendingAfterOutage = journal.commentJournal?.pendingReport?.outcome === 'uncertain';
  assert(pendingAfterOutage);
  comments = commentWorker(journal, commentsTransport, effects);
  const pendingAfterRestart = journal.commentJournal?.pendingReport?.outcome === 'uncertain';
  assert(pendingAfterRestart);
  await comments.run();
  available = true;
  await comments.recover();
  await comments.recover(); // Acknowledged report must not be replayed.
  const clearedAfterAcknowledged = !journal.commentJournal;
  assert(clearedAfterAcknowledged);
  assert.deepEqual(reportOutcomes, ['uncertain', 'uncertain']);
  assert.deepEqual(effects, { claims: 0, authorizations: 0, pageActions: 0, tabsCreated: 0 });
  return { scope: 'synthetic_offline_only',
    feed: { queuedPosts, afterOutage, afterRestart, afterUnacknowledged, afterAcknowledged, originalObservedAtPreserved },
    comments: { pendingAfterOutage, pendingAfterRestart, reportOutcomes, ...effects, clearedAfterAcknowledged },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 2) { console.error('Usage: node scripts/verify-automation-recovery.mjs'); process.exitCode = 1; }
  else verifyAutomationRecovery().then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
    console.error('Synthetic recovery verification failed; run the focused recovery tests.'); process.exitCode = 1;
  });
}
