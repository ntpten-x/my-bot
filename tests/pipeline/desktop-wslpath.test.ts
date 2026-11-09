import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('converts Windows package paths to forward slashes before calling wslpath', () => {
  const script = readFileSync('desktop/Install.ps1', 'utf8');
  expect(script).toContain("$PackageDir.Replace('\\', '/')");
  expect(script).toMatch(/wslpath -u \$WindowsSource/);
  expect(script).not.toMatch(/wslpath -u \$PackageDir\b/);
  expect(script).toContain('[Text.UTF8Encoding]::new($false)');
  expect(script).toContain('doneViewerFailed');
  expect(script).toContain('Purge');
});

it('reads package metadata with utf-8-sig so a local PowerShell BOM cannot abort provision', () => {
  expect(readFileSync('desktop/provision.sh', 'utf8')).toContain("read_text(encoding='utf-8-sig')");
  expect(readFileSync('desktop/provision.sh', 'utf8')).toContain('Keep current + one previous release');
});

it('keeps searchable MY-BOT Desktop shortcuts and a confirmed purge action', () => {
  const texts = JSON.parse(readFileSync('desktop/strings.th.json', 'utf8'));
  expect(texts.viewer).toContain('MY-BOT Desktop');
  expect(texts.purgeConfirm).toContain('ย้อนกลับไม่ได้');
  expect(readFileSync('desktop/Control.ps1', 'utf8')).toContain("ValidateSet('Start', 'Stop', 'Open', 'Status', 'Password', 'Resume', 'Uninstall', 'Purge', 'KeepAlive')");
});
