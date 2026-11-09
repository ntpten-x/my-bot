import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { desktopFiles } from '../../src/lib/desktop-package';

describe('optional desktop installer package', () => {
  it('pins a single Debian rootfs layer to the published immutable OCI manifest digest and length', () => {
    const image = JSON.parse(readFileSync('desktop/rootfs.json', 'utf8'));
    const index = JSON.parse(readFileSync('desktop/rootfs-provenance.json', 'utf8'));
    const descriptor = index.manifests.find((row: { platform: { architecture: string } }) => row.platform.architecture === 'amd64');
    const bytes = Buffer.from(descriptor.data, 'base64');
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(descriptor.digest);
    expect(image.ociManifestSha256).toBe(descriptor.digest.slice(7));
    const manifest = JSON.parse(bytes.toString());
    expect(manifest.layers).toHaveLength(1);
    expect(manifest.layers[0]).toMatchObject({ digest: `sha256:${image.sha256}`, size: image.sizeBytes, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' });
    expect(image.url).toBe(`https://raw.githubusercontent.com/debuerreotype/docker-debian-artifacts/${image.commit}/trixie/oci/blobs/rootfs.tar.gz`);
    expect(image.commit).toMatch(/^[a-f0-9]{40}$/);
  });
  it('contains a self-contained collector runtime and public configuration, with verified per-file hashes', () => {
    const entries = desktopFiles('https://owner.example');
    const metadata = JSON.parse(entries.find(entry => entry.name === 'package.json')!.data.toString());
    expect(metadata).toMatchObject({ format: 1, serverOrigin: 'https://owner.example', name: 'MY-BOT Desktop' });
    expect(metadata.releaseId).toMatch(/^[a-f0-9]{24}$/);
    expect(metadata.files).toHaveLength(entries.length - 1);
    for (const file of metadata.files) {
      const entry = entries.find(entry => entry.name === file.path)!;
      expect(createHash('sha256').update(entry.data).digest('hex')).toBe(file.sha256);
    }
    const names = entries.map(entry => entry.name);
    for (const file of ['Install.cmd', 'Install.ps1', 'Control.ps1', 'ownership.ps1', 'provision.sh', 'rollback.sh', 'runtime/desktop/control.sh', 'runtime/desktop/rollback.sh', 'runtime/desktop/tint2rc', 'runtime/desktop/focus-bot-browser.sh', 'runtime/scripts/start-bot-desktop.mjs', 'runtime/scripts/lib/workstation.mjs', 'runtime/scripts/lib/desktop-release.mjs']) expect(names).toContain(file);
    expect(JSON.parse(entries.find(entry => entry.name === 'package.json')!.data.toString()).extensionVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(names.some(name => /(^|\/)(data|node_modules|prisma|\.env)(\/|$)/.test(name))).toBe(false);
    expect(names).not.toContain('runtime/scripts/start-all.mjs');
    expect(names).not.toContain('runtime/src/worker/index.ts');
    const config = JSON.parse(entries.find(entry => entry.name === 'runtime/extension/install-config.json')!.data.toString());
    expect(config).toEqual({ apiBase: 'https://owner.example' });
    expect(JSON.parse(entries.find(entry => entry.name === 'runtime/extension/desktop-config.json')!.data.toString())).toEqual({ dedicatedReaderDesktop: true });
  });
  it('keeps the Chrome extension identity stable across origins/releases without bundling a private key', () => {
    const readManifest = (origin: string) => JSON.parse(desktopFiles(origin).find(entry => entry.name === 'runtime/extension/manifest.json')!.data.toString());
    const one = readManifest('https://one.example'), two = readManifest('https://two.example');
    expect(one.key).toBe(two.key);
    expect(Buffer.from(one.key, 'base64').length).toBeGreaterThan(200);
    expect(one.host_permissions).toContain('https://one.example/*');
    expect(one.host_permissions.some((host: string) => host.startsWith('http://'))).toBe(false);
    expect(one.host_permissions).not.toContain('https://my-bot-e6bt.onrender.com/*');
    expect(two.host_permissions).not.toContain('https://one.example/*');
    expect(one.permissions).not.toContain('nativeMessaging');
    expect(one.permissions).not.toContain('cookies');
    expect(desktopFiles('https://one.example').some(entry => /private|\.pem$/i.test(entry.name))).toBe(false);
  });
  it('binds immutable release IDs to the configured production server', () => {
    const id = (origin: string) => JSON.parse(desktopFiles(origin).find(entry => entry.name === 'package.json')!.data.toString()).releaseId;
    expect(id('https://one.example')).toBe(id('https://one.example'));
    expect(id('https://one.example')).not.toBe(id('https://two.example'));
    for (const origin of ['http://remote.example', 'http://localhost:8001', 'https://localhost', 'https://owner:secret@owner.example', 'https://owner.example/path', 'https://owner.example?key=secret']) expect(() => desktopFiles(origin)).toThrow();
  });
});
