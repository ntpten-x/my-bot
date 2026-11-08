import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, unlinkSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
const inUse=(file:string)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {profileInUse} from './scripts/lib/browser-profile.mjs'; console.log(JSON.stringify(await profileInUse(process.argv[1])));",file],{encoding:'utf8'}));
it.skipIf(process.platform!=='linux')('allows Chromium to recover a same-host dead lock without deleting it, while refusing a live owner',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'mybot-profile-')); const file=path.join(dir,'SingletonLock');
 try {
  expect(inUse(file)).toBe(false);
  symlinkSync(`${os.hostname()}-${process.pid}`,file);expect(inUse(file)).toBe(true);unlinkSync(file);
  const stale=`${os.hostname()}-2147483647`;symlinkSync(stale,file);expect(inUse(file)).toBe(false);expect(readlinkSync(file)).toBe(stale);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it.skipIf(process.platform!=='linux')('refuses unrecognized or other-host locks without modifying profile files',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'mybot-profile-'));const file=path.join(dir,'SingletonLock');
 try {
  symlinkSync('other-host-2147483647',file);expect(inUse(file)).toBe(true);unlinkSync(file);
  writeFileSync(file,'unrecognized');expect(inUse(file)).toBe(true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
