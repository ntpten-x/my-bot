import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const evaluate = (expression: string) => JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {desktopPlan,desktopEnvironment} from './scripts/lib/bot-desktop.mjs'; console.log(JSON.stringify(${expression}));`],{encoding:'utf8'}));
it('keeps Chrome on an authenticated separate X display rather than the owner WSLg desktop',()=>{
  const plan=evaluate(`desktopPlan('/tmp/my bot')`);
  expect(plan.env).toMatchObject({DISPLAY:':93',XDG_SESSION_TYPE:'x11',GDK_BACKEND:'x11'});
  expect(plan.chrome).toContain('--ozone-platform=x11');
  expect(plan.chrome).toContain('--user-data-dir=/tmp/my bot/data/desktop-browser-profile');
  expect(plan.xvfb).toContain('-auth'); expect(plan.xvfb).toContain('-nolisten');
  expect(plan.chrome).not.toContain('--no-sandbox'); expect(plan.chrome).not.toContain('--headless');
});
it('exposes only an authenticated localhost viewer and never puts its password in the browser URL',()=>{
  const plan=evaluate(`desktopPlan('/tmp')`);
  expect(plan.vnc).toContain('-localhost'); expect(plan.vnc).toContain('-rfbauth');
  expect(plan.proxy.slice(-2)).toEqual(['127.0.0.1:6085','127.0.0.1:5905']);
  expect(plan.viewer).not.toMatch(/password|token/i);
  expect(readFileSync('.gitignore','utf8')).toContain('/data/bot-desktop/');
  expect(readFileSync('.gitignore','utf8')).toContain('/data/desktop-browser-profile/');
});
it('validates the app URL before any desktop starts',()=>{
  expect(evaluate(`(()=>{try{desktopPlan('/tmp','http://remote.example');return false;}catch{return true;}})()`)).toBe(true);
  expect(evaluate(`desktopPlan('/tmp','https://app.example')`).origin).toBe('https://app.example');
});
it('prints setup help without installing packages or opening a browser',()=>{
  const help=execFileSync(process.execPath,['scripts/start-bot-desktop.mjs','--help'],{encoding:'utf8'});
  expect(help).toContain('--password'); expect(help).toContain('sudo apt-get install');
  expect(help).toContain('tint2');
  expect(help).toContain('pcmanfm');
});

it('starts a lightweight bottom panel after openbox and recovers it without killing Chrome',()=>{
  const source=readFileSync('scripts/start-bot-desktop.mjs','utf8');
  expect(source).toContain("start('Desktop panel', 'tint2'");
  expect(source).toContain("'Desktop panel'");
  expect(source).toContain("'desktop', 'tint2rc'");
  expect(source).toContain('focus-bot-browser.sh');
  expect(source).toContain('open-files.sh');
  expect(source).toContain('pcmanfm');
  expect(readFileSync('desktop/provision.sh','utf8')).toMatch(/\btint2\b/);
  expect(readFileSync('desktop/provision.sh','utf8')).toMatch(/\bpcmanfm\b/);
  expect(readFileSync('desktop/provision.sh','utf8')).toMatch(/\bunzip\b/);
  expect(readFileSync('desktop/provision.sh','utf8')).toMatch(/\bxarchiver\b/);
  expect(readFileSync('desktop/tint2rc','utf8')).toContain('MYBOT_LAUNCHER_BROWSER');
  expect(readFileSync('desktop/tint2rc','utf8')).toContain('MYBOT_LAUNCHER_FILES');
  expect(readFileSync('desktop/tint2rc','utf8')).toMatch(/panel_position = bottom/);
  expect(readFileSync('desktop/focus-bot-browser.sh','utf8')).toContain('desktop-browser-profile');
  expect(readFileSync('desktop/open-files.sh','utf8')).toContain('pcmanfm');
  expect(readFileSync('desktop/mimeapps.list','utf8')).toContain('inode/directory=pcmanfm.desktop');
});

it('removes inherited WSLg Wayland signals while keeping the actual X display and owner environment',()=>{
  const env=evaluate(`desktopEnvironment({WAYLAND_DISPLAY:'wayland-0',WAYLAND_SOCKET:'3',XDG_SESSION_TYPE:'wayland',HOME:'/owner'},desktopPlan('/tmp'))`);
  expect(env).not.toHaveProperty('WAYLAND_DISPLAY'); expect(env).not.toHaveProperty('WAYLAND_SOCKET');
  expect(env).toMatchObject({DISPLAY:':93',XDG_SESSION_TYPE:'x11',GDK_BACKEND:'x11',HOME:'/owner'});
});
