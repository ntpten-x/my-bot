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
  expect(readFileSync('desktop/provision.sh', 'utf8')).toContain('installDesktopRelease');
  expect(readFileSync('desktop/provision.sh', 'utf8')).toContain('Keep current + one previous completed release');
});

it('requires exact Linux ownership before update, purge and control actions', () => {
  const install = readFileSync('desktop/Install.ps1', 'utf8');
  const control = readFileSync('desktop/Control.ps1', 'utf8');
  const ownership = readFileSync('desktop/ownership.ps1', 'utf8');
  const provision = readFileSync('desktop/provision.sh', 'utf8');
  expect(ownership).toContain("DesktopOwnerValue = 'MYBOT-Desktop-V1'");
  expect(ownership).toContain('Assert-DesktopOwnedOrResumable');
  expect(ownership).toContain('Set-DesktopOwnerMarker');
  expect(ownership).toContain('Test-DesktopMybotUser');
  expect(ownership).toContain("$ErrorActionPreference = 'Continue'");
  expect(install).toContain('Assert-DesktopOwnedOrResumable');
  expect(install).toContain('Set-DesktopOwnerMarker');
  expect(install).toContain('Test-DesktopMybotUser');
  expect(control).toContain('Assert-DesktopOwnedDistro');
  expect(control).toContain('Assert-DesktopOwnedOrResumable');
  expect(control).toContain('purgeOwnership');
  expect(control).toContain('X-MYBOT-Extension-Version');
  expect(control).toContain('Rollback');
  expect(provision.indexOf("printf '%s\\n' 'MYBOT-Desktop-V1' > /etc/mybot-desktop-owner")).toBeLessThan(
    provision.indexOf('apt-get install -y --no-install-recommends ca-certificates'),
  );
  expect(readFileSync('desktop/rollback.sh', 'utf8')).toContain('Ownership marker missing');
});

it('offers to stop a running desktop before an in-place update instead of failing silently', () => {
  const install = readFileSync('desktop/Install.ps1', 'utf8');
  const texts = JSON.parse(readFileSync('desktop/strings.th.json', 'utf8'));
  expect(install).toContain('updateStopConfirm');
  expect(install).toContain('control.sh stop');
  expect(install).toContain('updateStopFailed');
  expect(texts.updateStopConfirm).toMatch(/หยุดบอทแล้วติดตั้งต่อ/);
  expect(texts.stopping).toMatch(/หยุดบอท/);
});

it('keeps searchable MY-BOT Desktop shortcuts and a confirmed purge action', () => {
  const texts = JSON.parse(readFileSync('desktop/strings.th.json', 'utf8'));
  expect(texts.viewer).toContain('MY-BOT Desktop');
  expect(texts.purgeConfirm).toContain('ย้อนกลับไม่ได้');
  expect(texts.rollbackConfirm).toContain('release');
  expect(readFileSync('desktop/Control.ps1', 'utf8')).toContain("ValidateSet('Start', 'Stop', 'Open', 'Status', 'Password', 'Resume', 'Rollback', 'Uninstall', 'Purge', 'KeepAlive')");
});

it('creates Thai Start Menu shortcuts via ASCII temp names then Rename-Item', () => {
  const install = readFileSync('desktop/Install.ps1', 'utf8');
  expect(install).toContain("MY-BOT Desktop - ' + $Item[1] + '.tmp.lnk'");
  expect(install).toContain('Rename-Item -LiteralPath $TempPath -NewName $FinalName');
  expect(install).toMatch(/Create Start Menu links before Start/);
  expect(install).not.toMatch(/CreateShortcut\(\(Join-Path \$Links \(\$Item\[0\] \+ '\.lnk'\)\)\)/);
});
