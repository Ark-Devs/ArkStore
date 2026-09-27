// The iOS source: reading an IPA's Info.plist through Range requests, and the AltStore source.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { parsePlist, readIpaInfo, type Fetcher } from '../supabase/functions/ios-source/ipa';
import { buildSource, type IosApp, type IosBuild } from '../supabase/functions/ios-source/source';
import { assetOS, bestAsset, classifyAsset } from '../src/lib/github/assets';

// Made with Python's plistlib (FMT_BINARY): bundle ID com.example.notes, 2.3.1 (231), iOS 15.0,
// "Notes Pro", a camera usage string, plus nested arrays / dicts / a boolean.
const BINARY_PLIST = Buffer.from(
  'YnBsaXN0MDDZAQIDBAUGBwgJCgsREhMUFRYXXxATQ0ZCdW5kbGVEaXNwbGF5TmFtZV1DRkJ1bmRsZUljb25zXxASQ0ZCdW5kbGVJZGVudGlmaWVyXxAaQ0ZCdW5kbGVTaG9ydFZlcnNpb25TdHJpbmdfEA9DRkJ1bmRsZVZlcnNpb25fEBJMU1JlcXVpcmVzSVBob25lT1NfEBBNaW5pbXVtT1NWZXJzaW9uXxAYTlNDYW1lcmFVc2FnZURlc2NyaXB0aW9uXlVJRGV2aWNlRmFtaWx5WU5vdGVzIFByb9EMDV8QE0NGQnVuZGxlUHJpbWFyeUljb27RDg9fEBFDRkJ1bmRsZUljb25GaWxlc6EQXEFwcEljb242MHg2MF8QEWNvbS5leGFtcGxlLm5vdGVzVTIuMy4xUzIzMQlUMTUuMF5TY2FuIGRvY3VtZW50c6IYGRABEAIACAAbADEAPwBUAHEAgwCYAKsAxgDVAN8A4gD4APsBDwERAR4BMgE4ATwBPQFCAVEBVAFWAAAAAAAAAgEAAAAAAAAAGgAAAAAAAAAAAAAAAAAAAVg=',
  'base64',
);

const XML_PLIST = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIcons</key>
  <dict><key>CFBundleIdentifier</key><string>not.this.one</string></dict>
  <key>CFBundleIdentifier</key>
  <string>org.example.xml&amp;co</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>UIRequiredDeviceCapabilities</key>
  <array><string>arm64</string></array>
  <key>NSPhotoLibraryUsageDescription</key>
  <string>Pick a picture</string>
  <key>LSRequiresIPhoneOS</key>
  <true/>
</dict>
</plist>`);

/** A ZIP with the given files, deflated (method 8) or stored (0). */
function zip(files: { name: string; data: Buffer; store?: boolean }[], zip64 = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.store ? f.data : deflateRawSync(f.data);
    const name = Buffer.from(f.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(f.store ? 0 : 8, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(f.store ? 0 : 8, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  if (!zip64) return Buffer.concat([...locals, cd, eocd]);
  // ZIP64: the classic record points at the ZIP64 record through a locator.
  const rec = Buffer.alloc(56);
  rec.writeUInt32LE(0x06064b50, 0);
  rec.writeBigUInt64LE(BigInt(cd.length), 40);
  rec.writeBigUInt64LE(BigInt(offset), 48);
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeBigUInt64LE(BigInt(offset + cd.length), 8);
  eocd.writeUInt32LE(0xffffffff, 12);
  eocd.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...locals, cd, rec, loc, eocd]);
}

/** A server that honours Range requests, and counts the bytes it sent. */
function server(file: Buffer) {
  const stats = { sent: 0, requests: 0 };
  const fetcher: Fetcher = async (_url, init) => {
    stats.requests++;
    const range = init.headers.Range.replace('bytes=', '');
    // Like GitHub's release CDN: suffix ranges ("bytes=-N") aren't supported.
    if (range.startsWith('-')) return new Response(null, { status: 501 });
    let [start, end] = range.split('-').map(Number);
    end = Math.min(end, file.length - 1);
    const body = file.subarray(start, end + 1);
    stats.sent += body.length;
    return new Response(new Uint8Array(body), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${file.length}` } });
  };
  return { fetcher, stats };
}

describe('iOS source', () => {
  test('IPA and TrollStore files are iOS builds', () => {
    assert.equal(assetOS('Notes-2.3.1.ipa'), 'ios');
    assert.equal(classifyAsset('Notes.tipa')?.kind, 'ipa');
    const files = [
      { name: 'Notes.tipa', url: 't', size: 1, os: 'ios' as const, arch: null },
      { name: 'Notes.ipa', url: 'i', size: 1, os: 'ios' as const, arch: null },
    ];
    assert.equal(bestAsset(files, { os: 'ios' })?.name, 'Notes.ipa', 'plain IPA before the TrollStore one');
  });

  test('binary and XML plists', () => {
    const b = parsePlist(BINARY_PLIST) as Record<string, unknown>;
    assert.equal(b.CFBundleIdentifier, 'com.example.notes');
    assert.deepEqual(b.UIDeviceFamily, [1, 2]);
    assert.equal(b.LSRequiresIPhoneOS, true);
    const x = parsePlist(XML_PLIST) as Record<string, unknown>;
    assert.equal(x.CFBundleIdentifier, 'org.example.xml&co', 'top level only, entities decoded');
    assert.equal(x.LSRequiresIPhoneOS, true);
  });

  test('reads Info.plist from an IPA with a few small range requests', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7); // the app binary, never downloaded
    const ipa = zip([
      { name: 'Payload/Notes.app/Notes', data: big, store: true },
      { name: 'Payload/Notes.app/Frameworks/Lib.framework/Info.plist', data: XML_PLIST },
      { name: 'Payload/Notes.app/Info.plist', data: BINARY_PLIST },
    ]);
    const { fetcher, stats } = server(ipa);
    const info = await readIpaInfo('https://example.com/Notes.ipa', fetcher);
    assert.deepEqual(info, {
      bundleId: 'com.example.notes',
      version: '2.3.1',
      build: '231',
      minOS: '15.0',
      name: 'Notes Pro',
      privacy: { NSCameraUsageDescription: 'Scan documents' },
    });
    assert.ok(stats.sent < 70 * 1024, `downloaded ${stats.sent} bytes of ${ipa.length}`);
    assert.ok(stats.requests <= 4, 'size probe, tail, local header');
    const known = server(ipa);
    await readIpaInfo('https://example.com/Notes.ipa', known.fetcher, ipa.length);
    assert.ok(known.stats.requests <= 3, 'no probe when the size is known');
  });

  test('ZIP64 IPAs and XML Info.plist', async () => {
    const ipa = zip([{ name: 'Payload/X.app/Info.plist', data: XML_PLIST }], true);
    const info = await readIpaInfo('u', server(ipa).fetcher);
    assert.equal(info.bundleId, 'org.example.xml&co');
    assert.deepEqual(info.privacy, { NSPhotoLibraryUsageDescription: 'Pick a picture' });
  });

  test('files that are not IPAs are refused', async () => {
    await assert.rejects(readIpaInfo('u', server(Buffer.from('not a zip at all')).fetcher), /not a ZIP/);
    await assert.rejects(readIpaInfo('u', server(zip([{ name: 'README.md', data: Buffer.from('hi') }])).fetcher), /Info\.plist/);
  });

  test('the AltStore source lists read apps once per bundle ID', () => {
    const app = (id: string, url: string, extra: Partial<IosApp> = {}): IosApp => ({
      id,
      repo_full_name: `dev/${id}`,
      name: id,
      subtitle: 'Sub',
      description: 'Desc',
      category: 'video',
      icon_url: null,
      screenshots: [],
      developer_login: 'dev',
      latest_version: 'v1.2.0',
      latest_published_at: '2026-09-01T00:00:00Z',
      latest_release_notes: 'Fixes',
      featured: false,
      assets: [{ name: `${id}.ipa`, url, size: 42, os: 'ios' }],
      ...extra,
    });
    const builds = new Map<string, IosBuild>([
      ['u1', { url: 'u1', bundle_id: 'com.a', version: '1.2', build: '5', min_os: '16.0', app_name: 'A', privacy: {} }],
      ['u2', { url: 'u2', bundle_id: 'com.a', version: '1.1', build: null, min_os: null, app_name: null, privacy: {} }],
      ['u3', { url: 'u3', bundle_id: null, version: null, build: null, min_os: null, app_name: null, privacy: null }],
    ]);
    const src = buildSource([app('a', 'u1', { featured: true }), app('fork', 'u2'), app('unread', 'u3')], builds, 'https://s', 'https://w');
    assert.equal(src.apps.length, 1, 'fork with the same bundle ID and the unread IPA are left out');
    const a = src.apps[0];
    assert.equal(a.bundleIdentifier, 'com.a');
    assert.equal(a.category, 'photo-video');
    assert.equal(a.iconURL, 'https://github.com/dev.png');
    assert.deepEqual(a.versions[0], { version: '1.2', buildVersion: '5', date: '2026-09-01T00:00:00Z', localizedDescription: 'Fixes', downloadURL: 'u1', size: 42, minOSVersion: '16.0' });
    assert.deepEqual(src.featuredApps, ['com.a']);
  });
});
