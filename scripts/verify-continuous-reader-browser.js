async (page) => {
  // SYNTHETIC DOM only. No real Facebook navigation, identity, tokens or API calls.
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><head><title>MY-BOT synthetic reader</title></head><body><main id="feed" style="height:6000px"></main></body></html>');
  await page.addScriptTag({ path: 'extension/scrape.js' });
  await page.addScriptTag({ path: 'extension/selectors.js' });
  await page.addScriptTag({ path: 'extension/parser.js' });
  await page.addScriptTag({ path: 'extension/background.js', type: 'text/plain' });
  const result = await page.evaluate(async () => {
    const source = document.querySelector('script[type="text/plain"]').textContent;
    const helpers = source.slice(source.indexOf('async function waitForGrowth('), source.indexOf('/** Activate only'));
    const pageReader = source.slice(source.indexOf('async function executeReaderScript('), source.indexOf('async function scrapeSettingsFor('));
    const root = globalThis;
    // The executeScript transport runs the actual injected functions on this isolated document.
    root.chrome = { scripting: { executeScript: async ({func, args}) => [{ result: await func(...(args || [])) }] } };
    const api = new Function(`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
${helpers}
${pageReader}
return {waitForGrowth,readPage,scrollOneScreen};
`)();
    const render = ids => {
      document.querySelector('#feed').innerHTML = ids.map(id => `<article role="article"><a href="https://www.facebook.com/groups/12345/posts/${id}/">2 hours ago</a><div data-ad-preview="message">SYNTHETIC ตามหาช่างซ่อมแอร์ เบอร์ตัวอย่าง ${id}</div></article>`).join('');
    };
    render([101,102,103]);
    const first = await api.readPage(1, 'group');
    const keys = first.posts.map(post => root.MyBotScrape.postKey(post.url));
    if (keys.length !== 3) throw Error(`Parser expected 3 posts, got ${keys.length}`);
    const height = document.scrollingElement.scrollHeight;
    // Replace cards without increasing their count or document height (virtualized feed).
    render([104,105,106]);
    const start = performance.now();
    const growth = await api.waitForGrowth(1, 'group', 3, 2200, keys);
    const ms = Math.round(performance.now() - start);
    const second = await api.readPage(1, 'group');
    const scrolled = await api.scrollOneScreen(1);
    if (!growth.grew || ms >= 2000) throw Error('Virtualized growth was not recognized before timeout');
    if (height !== document.scrollingElement.scrollHeight || growth.count !== 3) throw Error('Fixture unexpectedly grew');
    if (scrolled.moved <= 0) throw Error('Real Chrome scroll did not advance');
    const run = root.MyBotScrape.createRun({maxPosts:2, knownStreak:Infinity});
    root.MyBotScrape.addStep(run, first.posts);
    root.MyBotScrape.resumeRun(run);
    root.MyBotScrape.addStep(run, second.posts);
    if (run.newCount !== 6) throw Error('Snapshot batching dropped posts');
    document.body.innerHTML='<header><div role="progressbar" style="height:20px;width:20px">outside feed</div></header><main role="main"><div role="feed"><div id="nested" style="height:300px;overflow-y:auto"><article role="article" style="height:3000px">SYNTHETIC<div role="progressbar" style="height:20px;width:20px">media inside post</div></article></div></div></main>';
    document.scrollingElement.scrollTop=0;
    const falseLoaderDetected=root.MyBotScrape.feedStatus(document,'group').loading;
    const nestedScroll=await api.scrollOneScreen(1,'group');
    const pageScrollUnchanged=document.scrollingElement.scrollTop===0;
    const feed=document.querySelector('[role="feed"]');
    const loader=document.createElement('div');loader.setAttribute('role','progressbar');loader.style.cssText='height:20px;width:20px';feed.prepend(loader);
    const visibleLoaderDetected=root.MyBotScrape.feedStatus(document,'group').loading;
    loader.style.display='none';
    const hiddenLoaderIgnored=!root.MyBotScrape.feedStatus(document,'group').loading;
    if(falseLoaderDetected || !visibleLoaderDetected || !hiddenLoaderIgnored || !pageScrollUnchanged || nestedScroll.moved<=0) throw Error('Scoped loader or nested scrolling regression');
    return {firstKeys:keys, secondKeys:second.posts.map(post=>root.MyBotScrape.postKey(post.url)), growth, detectionMs:ms, scrollMoved:scrolled.moved, captured:run.newCount,nestedScrollMoved:nestedScroll.moved,pageScrollUnchanged,falseLoaderDetected,visibleLoaderDetected,hiddenLoaderIgnored};
  });
  if (errors.length) throw Error(errors.join('; '));
  return {...result, pageErrors:errors};
}
