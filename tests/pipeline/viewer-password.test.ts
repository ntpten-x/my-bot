import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
const nativeVncAvailable = process.platform === 'linux' && (()=>{
  try { execFileSync('python3',['-c','import ctypes.util,sys;sys.exit(0 if ctypes.util.find_library("vncserver") else 1)'],{stdio:'ignore'}); return true; } catch { return false; }
})();
// Synthetic local-only password. Never reads the owner's credential file.
it.skipIf(!nativeVncAvailable)('stores a VNC password from stdin with private permissions and no credential output',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'mybot-password-'));
  try {
    const file=path.join(dir,'private','vnc-password');
    const output=execFileSync('python3',['scripts/store-vnc-password.py',file],{input:'T3st!8xx\n',encoding:'utf8'});
    expect(output).not.toContain('T3st!8xx');
    expect(readFileSync(file)).toHaveLength(8);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
it.skipIf(!nativeVncAvailable)('rejects unsupported password lengths before creating any credential',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'mybot-password-'));
  try {
    const file=path.join(dir,'private','vnc-password');
    for(const input of ['short\n','longer-than-eight\n','has space\n']) {
      expect(()=>execFileSync('python3',['scripts/store-vnc-password.py',file],{input,stdio:['pipe','pipe','pipe']})).toThrow();
      expect(existsSync(file)).toBe(false);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
