import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
function evaluate(expression: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `import {browserPlan,browserCandidates} from './scripts/lib/bot-browser.mjs'; console.log(JSON.stringify(${expression}));`], { encoding: 'utf8' }));
}
it('keeps browser login data in an ignored persistent profile and passes paths as single arguments', () => {
  const result = evaluate(`browserPlan({root:'C:/my bot',platform:'win32',env:{}})`);
  expect(result.profile).toBe('C:\\my bot\\data\\browser-profile');
  expect(result.args[0]).toBe('--user-data-dir=C:\\my bot\\data\\browser-profile');
  expect(result.args).toContain('http://localhost:8001/');
  expect(result.args).toContain('https://www.facebook.com/');
  expect(readFileSync('.gitignore','utf8')).toContain('/data/browser-profile/');
});
it('rejects remote plaintext app URLs and credential-bearing URLs before launching', () => {
  const result=evaluate(`['http://remote.example','https://user:secret@example.com','https://app.example?token=secret','file:///tmp/app'].map(url=>{try{browserPlan({root:'/tmp',platform:'win32',env:{},url});return false;}catch{return true;}})`);
  expect(result).toEqual([true,true,true,true]);
});
it('requires a real graphical Linux desktop rather than silently falling back to headless', () => {
  expect(evaluate(`(()=>{try{browserPlan({root:'/tmp',platform:'linux',env:{}});return false;}catch{return true;}})()`)).toBe(true);
  expect(evaluate(`browserPlan({root:'/tmp',platform:'linux',env:{DISPLAY:':99'},url:'https://app.example'})`).origin).toBe('https://app.example');
  expect(evaluate(`browserPlan({root:'/tmp/my bot',platform:'linux',env:{DISPLAY:':99'}})`).profile).toBe('/tmp/my bot/data/browser-profile');
});
it('finds standard Chrome installations on Windows without invoking a shell', () => {
  const paths=evaluate(`browserCandidates('win32',{PROGRAMFILES:'C:\\\\Program Files',LOCALAPPDATA:'C:\\\\Users\\\\Owner\\\\AppData\\\\Local'})`);
  expect(paths).toHaveLength(2);
  expect(paths[0]).toMatch(/Google\\Chrome\\Application\\chrome.exe$/);
  const help=execFileSync(process.execPath,['scripts/start-bot-browser.mjs','--help'],{encoding:'utf8'});
  expect(help).toContain('--check');
});
