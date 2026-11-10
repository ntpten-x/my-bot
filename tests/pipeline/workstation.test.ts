import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const evaluate = (body: string) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
  `import {desktopAction,desktopComponentsReady,restartDelay,webReady} from './scripts/lib/workstation.mjs'; ${body}`], { encoding: 'utf8' }));

it('requires fresh complete desktop telemetry belonging to this supervisor session', () => {
  expect(evaluate(`
    const now=Date.now(), details={session:'current',at:new Date(now).toISOString(),phase:'running',components:
      Object.fromEntries(['Virtual display','Window manager','Desktop viewer','Web viewer','Browser'].map(name=>[name,'running']))};
    console.log(JSON.stringify([
      desktopComponentsReady(details,'current',now),
      desktopComponentsReady(null,'current',now),
      desktopComponentsReady(details,'previous',now),
      desktopComponentsReady(details,'current',now+60000),
      desktopComponentsReady(details,'current',now-1),
      desktopComponentsReady({...details,components:{...details.components,Browser:'review'}},'current',now),
      desktopComponentsReady({...details,phase:'degraded'},'current',now)
    ]));
  `)).toEqual([true,false,false,false,false,false,false]);
});

it('starts a missing desktop once, adopts existing listeners and latches an unexpected loss', () => {
  expect(evaluate(`console.log(JSON.stringify([
    desktopAction({firstCheck:true,vnc:false,viewer:false,attempted:false}),
    desktopAction({firstCheck:false,vnc:true,viewer:true,attempted:true}),
    desktopAction({firstCheck:false,vnc:false,viewer:false,attempted:true}),
    desktopAction({firstCheck:true,vnc:true,viewer:false,attempted:false})]));`)).toEqual(['start', 'ready', 'review', 'partial']);
});
it('does not accept an unrelated server or a redirect as a healthy MY-BOT web', () => {
  expect(evaluate(`const results=[]; for(const body of [{ok:true,version:'test'},{ok:true},{ok:false,version:'test'}]) {
    results.push(await webReady(async()=>({ok:true,json:async()=>body}))); }
    results.push(await webReady(async()=>{throw Error('offline')})); console.log(JSON.stringify(results));`)).toEqual([true, false, false, false]);
});
it('bounds repeated web crash retries and never launches a second worker', () => {
  expect(evaluate(`console.log(JSON.stringify([restartDelay(1),restartDelay(3),restartDelay(99)]));`)).toEqual([3000, 12000, 300000]);
  const source = readFileSync('scripts/start-workstation.mjs', 'utf8');
  expect(source).not.toContain('src/worker/index.ts');
  expect(source).not.toContain('start-all.mjs');
  expect(source).toContain("process.kill(-child.pid, 'SIGTERM')");
});

it('emits an absolute unquoted WorkingDirectory and escapes systemd specifiers', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {workstationUnit} from './scripts/lib/workstation-service.mjs';
    console.log(workstationUnit('/tmp/my bot%example', '/usr/bin/node'));
  `], { encoding: 'utf8' });
  expect(result).toContain('WorkingDirectory=/tmp/my bot%%example\n');
  expect(result).toContain('ExecStart=/bin/bash "/tmp/my bot%%example/scripts/start-workstation.sh" --run');
  expect(result).toContain('Restart=on-failure');
});

describe('desktop child recovery', () => {
  const source = readFileSync('scripts/start-bot-desktop.mjs', 'utf8');
  function harness() {
    const children: EventEmitter[] = [], timers: (() => void)[] = [];
    const spawn = vi.fn(() => { const child = new EventEmitter(); children.push(child); return child; });
    const shutdown = vi.fn();
    const componentState: Record<string, string> = {};
    const recordComponent = vi.fn((name: string, phase: string) => { componentState[name] = phase; });
    const context = vm.createContext({ spawn, shutdown, recordComponent, children: [], stopping: false,
      root: '/synthetic', Date, console: { error: vi.fn() }, recoveryTimers: new Set(),
      componentState, failedComponents: new Map(), handledComponentRequests: new Set(),
      process: { env: { MYBOT_WORKSTATION_SESSION: 'current-session' } },
      setTimeout: (fn: () => void) => { timers.push(fn); return fn; } });
    vm.runInContext(source.slice(source.indexOf('function start('), source.indexOf('const sleep =')), context);
    return { context, children, timers, spawn, shutdown, recordComponent };
  }
  it('recovers the web viewer without reopening Chrome', () => {
    const h = harness();
    h.context.start('Web viewer', 'websockify', [], {});
    h.children[0].emit('exit', 1);
    expect(h.shutdown).not.toHaveBeenCalled();
    h.timers[0]();
    expect(h.spawn.mock.calls.map(call => call[0])).toEqual(['websockify', 'websockify']);
  });
  it('bounds viewer recovery and leaves Chrome running after repeated failure', () => {
    const h = harness();
    h.context.start('Desktop viewer', 'x11vnc', [], {});
    for (let i = 0; i < 6; i++) { h.children[i].emit('exit', 1); if (i < 5) h.timers[i](); }
    expect(h.spawn).toHaveBeenCalledTimes(6);
    expect(h.recordComponent).toHaveBeenLastCalledWith('Desktop viewer', 'review');
    expect(h.shutdown).not.toHaveBeenCalled();
  });
  it('latches a browser/display failure instead of resending or restarting Chrome', () => {
    for (const name of ['Browser', 'Virtual display']) {
      const h = harness(); h.context.start(name, 'synthetic', [], {});
      h.children[0].emit('exit', 1);
      expect(h.shutdown).toHaveBeenCalledWith(1);
      expect(h.timers).toHaveLength(0);
    }
  });
  it('does not schedule recovery during an owner stop', () => {
    const h = harness(); h.context.start('Web viewer', 'websockify', [], {});
    h.context.stopping = true; h.children[0].emit('exit', 0);
    expect(h.timers).toHaveLength(0);
  });
  it('does not create another child after shutdown begins during startup', () => {
    const h = harness(); h.context.stopping = true;
    expect(() => h.context.start('Browser', 'synthetic', [], {})).toThrow('stopping');
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('allows one owner request to rearm exhausted viewers without restarting Browser or Xvfb', () => {
    const h = harness();
    h.context.start('Browser', 'chromium', [], {});
    h.context.start('Virtual display', 'Xvfb', [], {});
    let viewer = h.context.start('Desktop viewer', 'x11vnc', [], {});
    for (let i = 0; i < 6; i++) {
      viewer.emit('exit', 1);
      if (i < 5) { h.timers[i](); viewer = h.children.at(-1); }
    }
    const request = { action: 'resume-components', session: 'current-session', nonce: 'owner-request-1' };
    expect(h.context.handleComponentRequest(request)).toBe(1);
    expect(h.context.handleComponentRequest(request)).toBe(0);
    expect(h.spawn.mock.calls.map(call => call[0])).toEqual(['chromium', 'Xvfb', ...Array(7).fill('x11vnc')]);
    expect(h.recordComponent).toHaveBeenLastCalledWith('Desktop viewer', 'running');
    expect(h.shutdown).not.toHaveBeenCalled();
    viewer = h.children.at(-1);
    for (let i = 0; i < 6; i++) {
      viewer.emit('exit', 1);
      if (i < 5) { h.timers[i + 5](); viewer = h.children.at(-1); }
    }
    expect(h.recordComponent).toHaveBeenLastCalledWith('Desktop viewer', 'review');
    expect(h.spawn).toHaveBeenCalledTimes(14);
  });
  it('ignores stale, malformed and shutdown component-resume commands', () => {
    const h = harness();
    h.context.start('Window manager', 'openbox', [], {}, 5).emit('exit', 1);
    for (const request of [null, {}, { action: 'resume-components', session: 'old-session', nonce: 'request' },
      { action: 'resume-components', session: 'current-session' }]) {
      expect(h.context.handleComponentRequest(request)).toBe(0);
    }
    h.context.stopping = true;
    expect(h.context.handleComponentRequest({ action: 'resume-components', session: 'current-session', nonce: 'request' })).toBe(0);
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });
});

it('queues concurrent owner commands separately and gives Stop priority over Resume', () => {
  expect(evaluate(`
    const fs=await import('node:fs/promises'), os=await import('node:os'), path=await import('node:path');
    const {queueWorkstationRequest,readWorkstationRequests}=await import('./scripts/lib/workstation.mjs');
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mybot-control-'));
    const session='00000000-0000-4000-8000-000000000001';
    try {
      await Promise.all([
        queueWorkstationRequest(dir,{session,action:'resume-desktop',nonce:'00000000-0000-4000-8000-000000000002'}),
        queueWorkstationRequest(dir,{session,action:'stop',nonce:'00000000-0000-4000-8000-000000000003'}),
        queueWorkstationRequest(dir,{session:'00000000-0000-4000-8000-000000000009',action:'stop',nonce:'00000000-0000-4000-8000-000000000004'})]);
      const requests=await readWorkstationRequests(dir,session);
      let overwriteRefused=false;
      try { await queueWorkstationRequest(dir,{session,action:'resume-desktop',nonce:'00000000-0000-4000-8000-000000000003'}); } catch {overwriteRefused=true;}
      await fs.writeFile(path.join(dir,session+'.00000000-0000-4000-8000-000000000005.json'),'{');
      const after=await readWorkstationRequests(dir,session);
      let refused=false;
      try { await queueWorkstationRequest(dir,{session,action:'resume-desktop',nonce:'../../escape'}); } catch {refused=true;}
      console.log(JSON.stringify({actions:requests.map(row=>row.request.action),after:after.map(row=>row.request.action),refused,overwriteRefused}));
    } finally {await fs.rm(dir,{recursive:true,force:true});}
  `)).toEqual({ actions: ['stop', 'resume-desktop'], after: ['stop', 'resume-desktop'], refused: true, overwriteRefused: true });
});

it('forwards Resume only to the owned live desktop and still stops its owned process group', () => {
  expect(evaluate(`
    const vm=await import('node:vm'), fs=await import('node:fs'), path=await import('node:path'), {EventEmitter}=await import('node:events');
    const source=fs.readFileSync('scripts/start-workstation.mjs','utf8');
    const session='00000000-0000-4000-8000-000000000001', resumed=[], removed=[], killed=[], launched=[], snapshots=[];
    let pass=0, child;
    const resume={action:'resume-desktop',session,nonce:'00000000-0000-4000-8000-000000000002'};
    const stop={action:'stop',session,nonce:'00000000-0000-4000-8000-000000000003'};
    const context=vm.createContext({
      args:['--run'],root:'/synthetic',runtime:'/synthetic/data/bot-desktop',statusFile:'/synthetic/status.json',requestDirectory:'/synthetic/requests',dataRoot:'/synthetic/data',
      process:{platform:'linux',env:{},pid:100,execPath:'/node',on(){},kill(pid,signal){killed.push([pid,signal]);child.emit('exit',0);}},
      mkdir:async()=>{},chmod:async()=>{},readFile:async()=>JSON.stringify({mode:'remote',serverOrigin:'https://owner.example'}),
      readJson:async file=>file.endsWith('components.json')?{session,at:new Date().toISOString(),phase:'running',components:Object.fromEntries(['Virtual display','Window manager','Desktop viewer','Web viewer','Browser'].map(name=>[name,'running']))}:null,
      saveJson:async(file,state)=>snapshots.push(JSON.parse(JSON.stringify(state))),
      workstationConfig:raw=>raw,desktopPorts:()=>({vncPort:5905,viewerPort:6085}),fresh:()=>false,randomUUID:()=>session,
      readWorkstationRequests:async()=>{pass++;return pass===1?[]:[{file:pass===2?'resume.json':'stop.json',request:pass===2?resume:stop}];},
      unlink:async file=>removed.push(file),webReady:async()=>true,portOpen:async()=>pass>1,viewerReady:async()=>pass>1,
      desktopAction,desktopComponentsReady,restartDelay,WORKSTATION_INTERVAL_MS:250,fetch:()=>{},path,log:()=>{},
      spawn(executable,args,options){
        launched.push({executable,args,stdio:options.stdio});child=new EventEmitter();child.pid=101;
        child.stdin=new EventEmitter();child.stdin.writable=true;child.stdin.write=line=>resumed.push(JSON.parse(line));return child;
      },
      setTimeout(fn){fn();return {unref(){}};}
    });
    vm.runInContext(source.slice(source.indexOf('async function main()'),source.indexOf('main().catch')),context);
    await context.main();
    console.log(JSON.stringify({launches:launched.length,stdin:launched[0].stdio[0],resumed,killed,removed,phase:snapshots.at(-1).phase}));
  `)).toEqual({ launches: 1, stdin: 'pipe', resumed: [{ action: 'resume-components', session: '00000000-0000-4000-8000-000000000001', nonce: '00000000-0000-4000-8000-000000000002' }],
    killed: [[-101, 'SIGTERM']], removed: ['resume.json', 'stop.json'], phase: 'stopped' });
});

it.skipIf(process.platform !== 'win32')('requires the same healthy supervisor, component telemetry and ports before Open or Status reports ready', () => {
  const source = readFileSync('desktop/Control.ps1', 'utf8');
  const readiness = source.match(/function Test-DesktopRuntimeReady\([^\n]+\) \{[\s\S]*?\r?\n\}/)?.[0];
  expect(readiness).toBeDefined();
  const command = `${readiness}
    $Ports = @{ vncPort = 5905; viewerPort = 6085 }
    $Data = [pscustomobject]@{ supervisor = [pscustomobject]@{ phase = 'running'; desktop = 'running' }; webReady = $true; vncListening = $true; viewerReady = $true; vncPort = 5905; viewerPort = 6085 }
    $Results = @((Test-DesktopRuntimeReady $Data))
    $Data.supervisor.phase = 'needs-attention'; $Results += (Test-DesktopRuntimeReady $Data)
    $Data.supervisor.phase = 'running'; $Data.viewerPort = 6086; $Results += (Test-DesktopRuntimeReady $Data)
    $Data.viewerPort = 6085; $Data.webReady = $false; $Results += (Test-DesktopRuntimeReady $Data)
    $Data.webReady = $true; $Data.supervisor.desktop = 'existing'; $Results += (Test-DesktopRuntimeReady $Data)
    $Results | ConvertTo-Json -Compress
  `;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8' });
  expect(JSON.parse(output.trim())).toEqual([true, false, false, false, false]);
});
