import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('uses the Desktop installation ports everywhere rather than the running legacy viewer ports', () => {
  const plan = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {desktopPlan} from './scripts/lib/bot-desktop.mjs';
    console.log(JSON.stringify(desktopPlan('/tmp/synthetic','https://owner.example',{vncPort:5915,viewerPort:6095})));
  `], { encoding: 'utf8' }));
  expect(plan.proxy.slice(-2)).toEqual(['127.0.0.1:6095', '127.0.0.1:5915']);
  expect(plan.vnc[plan.vnc.indexOf('-rfbport') + 1]).toBe('5915');
  expect(plan.viewer).toBe('http://localhost:6095/vnc.html?host=localhost&port=6095&resize=scale');
  expect(plan.display).toBe(':6095');
});

it('rejects invalid/equal ports and retains configured ports in the production supervisor', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {desktopPorts,workstationConfig,desktopAction,viewerReady} from './scripts/lib/workstation.mjs';
    const rejected=[{vncPort:0},{viewerPort:65536},{vncPort:'5915'},{vncPort:6095,viewerPort:6095}].map(value=>{try{desktopPorts(value);return false}catch{return true}});
    let target='';await viewerReady(async url=>{target=url;return {ok:true}},6095);
    console.log(JSON.stringify({rejected,target,config:workstationConfig({mode:'remote',serverOrigin:'https://owner.example',vncPort:5915,viewerPort:6095}),
    action:desktopAction({firstCheck:true,vnc:true,viewer:true,attempted:false,allowExisting:false})}));
  `], { encoding: 'utf8' }));
  expect(result.rejected).toEqual([true, true, true, true]);
  expect(result.config).toMatchObject({vncPort:5915,viewerPort:6095});
  expect(result.target).toBe('http://127.0.0.1:6095/vnc.html');
  expect(result.action).toBe('conflict');
});
