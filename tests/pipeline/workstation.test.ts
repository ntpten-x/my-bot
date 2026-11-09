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
    const recordComponent = vi.fn();
    const context = vm.createContext({ spawn, shutdown, recordComponent, children: [], stopping: false,
      root: '/synthetic', Date, console: { error: vi.fn() }, recoveryTimers: new Set(),
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
});
