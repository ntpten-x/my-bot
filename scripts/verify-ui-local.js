async (page) => {
  const origin = 'http://127.0.0.1:8002';
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let retries = 0;
  const queue = {
    counts: { pending: 5, running: 0, done: 1, failed: 1, skipped: 0 }, oldestPendingMs: 180000,
    processingMs: { count: 1, p50: 9900, p95: 9900 }, queueWaitMs: { count: 1, p50: 1000, p95: 1000 },
    recentSample: 7, retriedJobs: 5, terminalSuccessRate: 0.5, requests: {},
    errors: [{ id: 'fixture-job', status: 'failed', attempts: 10, lastError: 'ollama: HTTP 503', nextAttemptAt: new Date().toISOString() }],
  };
  await page.context().addCookies([{ name: 'mybot_session', value: 'isolated-ui-fixture', url: origin }]);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === '/api/stats') body = { postsToday: 6, unread: 6, buyers: 2, pipeline: 0, enabledSources: 1, errorSources: 0, byCategory: [], recent: [], logs: [], extension: { lastSeen: null, stale: false, sources: [] }, aiQueue: queue };
    else if (url.pathname === '/api/ai-queue') { retries++; body = { queued: 5 }; }
    else if (url.pathname === '/api/notifications') body = { unread: 0, notifications: [] };
    else if (url.pathname === '/api/meta') body = { categories: [], sources: [], keywords: [], provinces: [] };
    else if (url.pathname === '/api/settings') body = { settings: { notifySound: false } };
    else if (url.pathname === '/api/posts') body = { posts: [], total: 1000, searchScope: 'ผลรวมเฉพาะชุดที่ค้น: ล่าสุดไม่เกิน 1000 รายการตามตัวกรอง' };
    else if (url.pathname === '/api/v1/stream') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/dashboard`);
  await page.getByRole('heading', { name: 'คิวจัดหมวด AI' }).waitFor();
  await page.getByRole('button', { name: 'ลอง AI ใหม่สำหรับงานที่ยังไม่สำเร็จ' }).click();
  await page.getByRole('status').filter({ hasText: 'ส่ง 5 โพสต์' }).waitFor();
  if (retries !== 1) throw new Error('Retry button did not send exactly one request');
  await page.screenshot({ path: 'data/ui-dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'data/ui-dashboard-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('Dashboard overflows mobile viewport');
  await page.goto(`${origin}/feed`);
  await page.getByRole('status').filter({ hasText: '1000 รายการ' }).waitFor();
  await page.screenshot({ path: 'data/ui-feed-mobile.png', fullPage: true });
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { dashboard: 'passed', retryButton: 'passed', searchScope: 'passed', mobileOverflow: false, pageErrors: errors.length, fixtureOnly: true };
}
