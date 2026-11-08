import { lstat, readlink } from 'node:fs/promises';
import os from 'node:os';

// Chromium owns stale-lock cleanup. We never delete or rewrite its profile locks.
export async function profileInUse(lockPath) {
  let info;
  try { info = await lstat(lockPath); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!info.isSymbolicLink()) return true;
  const target = await readlink(lockPath);
  const prefix = os.hostname() + '-';
  if (!target.startsWith(prefix) || !/^\d+$/.test(target.slice(prefix.length))) return true;
  const pid = Number(target.slice(prefix.length));
  if (!Number.isSafeInteger(pid) || pid < 2 || pid > 2147483647) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
