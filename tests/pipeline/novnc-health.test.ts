import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('rejects HTTP-only readiness and validates fragmented WebSocket RFB banners without authenticating', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import http from 'node:http';
    import {createHash} from 'node:crypto';
    import {viewerReady} from './scripts/lib/workstation.mjs';
    const server=http.createServer((q,s)=>s.end()); let mode='reject'; const sockets=new Set();
    server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))});
    server.on('upgrade',(q,s)=>{
      if(mode==='reject'){s.end('HTTP/1.1 503 Unavailable\\r\\n\\r\\n');return}
      const accept=createHash('sha1').update(q.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      s.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+(mode==='bad-key'?'invalid':accept)+'\\r\\n\\r\\n');
      if(mode==='silent')return;
      const frame=Buffer.concat([Buffer.from([0x82,12]),Buffer.from(mode==='bad-banner'?'BAD 003.008\\n':'RFB 003.008\\n')]);
      s.write(frame.subarray(0,5));setTimeout(()=>{if(!s.destroyed)s.write(frame.subarray(5))},5);
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port, results=[];
    for(mode of ['reject','good','bad-key','bad-banner','silent']) results.push(await viewerReady(fetch,port));
    for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));
    console.log(JSON.stringify(results));
  `], { encoding: 'utf8', timeout: 15000 }));
  expect(result).toEqual([false, true, false, false, false]);
});

it('bounds retries, stops on manual disconnect/auth failure and retains only numeric connection diagnostics', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {ViewerSession,profiles} from './desktop/viewer-policy.mjs';
    const state=new ViewerSession();const delays=[];
    state.begin(100);state.connected(150);state.disconnected('transport',200);
    for(let i=0;i<7;i++)delays.push(state.retryDelay());
    state.manualDisconnect();const manual=state.retryDelay();
    state.begin(300);state.securityFailure();const auth=state.retryDelay();
    console.log(JSON.stringify({delays,manual,auth,metrics:state.snapshot(),profiles}));
  `], { encoding:'utf8' }));
  expect(result.delays).toEqual([3000,6000,12000,24000,30000,null,null]);
  expect(result.manual).toBeNull(); expect(result.auth).toBeNull();
  expect(result.metrics).toMatchObject({disconnectCount:1,lastConnectMs:50,lastReason:'authentication'});
  expect(result.profiles).toMatchObject({balanced:{quality:6,compression:2},smooth:{quality:6,compression:0},sharp:{quality:9,compression:0}});
});

it('serves an allowlisted public tree with pinned geometry, without exposing authority files', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
    import os from 'node:os';import path from 'node:path';
    import {desktopPlan,prepareViewer} from './scripts/lib/bot-desktop.mjs';
    const temp=await mkdtemp(path.join(os.tmpdir(),'mybot-viewer-test-'));
    try {
      const vendor=path.join(temp,'vendor');await mkdir(vendor);
      await writeFile(path.join(vendor,'vnc.html'),'<script type="module">import UI from "./app/ui.js"; UI.start({});</script>');
      const plan=desktopPlan(temp,'http://localhost:8001');await mkdir(plan.runtime,{recursive:true});
      await writeFile(plan.auth,'SYNTHETIC-PRIVATE');await writeFile(plan.password,'SYNTHETIC-PRIVATE');
      const root=await prepareViewer(process.cwd(),plan,vendor);
      console.log(JSON.stringify({files:await readdir(root), mandatory:JSON.parse(await readFile(path.join(root,'mandatory.json'),'utf8')),
        defaults:JSON.parse(await readFile(path.join(root,'defaults.json'),'utf8')),html:await readFile(path.join(root,'vnc.html'),'utf8'),proxy:plan.proxy}));
    } finally {await rm(temp,{recursive:true,force:true})}
  `], {encoding:'utf8'}));
  expect(result.files.sort()).toEqual(['app','core','defaults.json','mandatory.json','vendor','viewer-enhancements.mjs','viewer-policy.mjs','vnc.html'].sort());
  expect(result.mandatory).toMatchObject({resize:'scale',host:'localhost',port:'6085',path:'websockify'});
  expect(result.defaults).toMatchObject({reconnect:true,reconnect_delay:3000,quality:6,compression:2});
  expect(result.html.indexOf('installViewer(UI)')).toBeLessThan(result.html.indexOf('UI.start'));
  expect(result.proxy[1]).toMatch(/viewer-public$/);
});
