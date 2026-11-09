import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const windowsPowerShell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const supported = process.platform === 'win32' || (Boolean(process.env.WSL_DISTRO_NAME) && existsSync(windowsPowerShell));
it.skipIf(!supported)('executes image verification and download failure regressions in Windows PowerShell 5.1', () => {
  const file = path.resolve('tests/windows/desktop-image.ps1');
  const target = process.platform === 'win32' ? file : execFileSync('wslpath', ['-w', file], { encoding: 'utf8' }).trim();
  const output = execFileSync(process.platform === 'win32' ? 'powershell.exe' : windowsPowerShell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', target], { encoding: 'utf8', timeout: 30_000 });
  expect(output).toContain('PASS: HTML, truncation, checksum, verified cache reuse and atomic promotion');
});
