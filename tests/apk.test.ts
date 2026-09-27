// Reading an APK's package name from its binary AndroidManifest.xml.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { manifestPackage } from '../supabase/functions/ios-source/apk';

/** A minimal binary AndroidManifest.xml: <manifest package="…"> with a UTF-16 or UTF-8 string pool. */
function axml(pkg: string, { utf8 = false, typedOnly = false } = {}) {
  const strings = ['versionCode', 'package', 'manifest', pkg];
  const enc = strings.map((s) => {
    if (utf8) {
      const b = Buffer.from(s, 'utf8');
      return Buffer.concat([Buffer.from([s.length, b.length]), b, Buffer.from([0])]);
    }
    const b = Buffer.alloc(2 + s.length * 2 + 2);
    b.writeUInt16LE(s.length, 0);
    for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), 2 + i * 2);
    return b;
  });
  let data = Buffer.concat(enc);
  data = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const offsets = Buffer.alloc(strings.length * 4);
  let o = 0;
  enc.forEach((e, i) => { offsets.writeUInt32LE(o, i * 4); o += e.length; });
  const poolHeader = Buffer.alloc(28);
  poolHeader.writeUInt16LE(0x0001, 0);
  poolHeader.writeUInt16LE(28, 2);
  poolHeader.writeUInt32LE(28 + offsets.length + data.length, 4);
  poolHeader.writeUInt32LE(strings.length, 8);
  poolHeader.writeUInt32LE(utf8 ? 0x100 : 0, 16);
  poolHeader.writeUInt32LE(28 + offsets.length, 20);
  const pool = Buffer.concat([poolHeader, offsets, data]);

  // <manifest versionCode=… package=…>: two attributes, the package one second.
  const el = Buffer.alloc(16 + 20 + 2 * 20);
  el.writeUInt16LE(0x0102, 0);
  el.writeUInt16LE(16, 2);
  el.writeUInt32LE(el.length, 4);
  el.writeUInt32LE(0xffffffff, 16); // namespace
  el.writeUInt32LE(2, 20); // name: "manifest"
  el.writeUInt16LE(20, 24); // attributeStart
  el.writeUInt16LE(20, 26); // attributeSize
  el.writeUInt16LE(2, 28); // attributeCount
  const attr = (i: number, name: number, raw: number, type: number, dataVal: number) => {
    const a = 16 + 20 + i * 20;
    el.writeUInt32LE(0xffffffff, a);
    el.writeUInt32LE(name, a + 4);
    el.writeUInt32LE(raw, a + 8);
    el.writeUInt16LE(8, a + 12);
    el.writeUInt8(type, a + 15);
    el.writeUInt32LE(dataVal, a + 16);
  };
  attr(0, 0, 0xffffffff, 0x10, 42); // versionCode=42 (integer)
  attr(1, 1, typedOnly ? 0xffffffff : 3, 0x03, 3); // package="…" (string 3)

  const head = Buffer.alloc(8);
  head.writeUInt16LE(0x0003, 0);
  head.writeUInt16LE(8, 2);
  head.writeUInt32LE(8 + pool.length + el.length, 4);
  return new Uint8Array(Buffer.concat([head, pool, el]));
}

describe('APK package names', () => {
  test('reads <manifest package> with UTF-16 and UTF-8 string pools', () => {
    assert.equal(manifestPackage(axml('com.maxrave.simpmusic')), 'com.maxrave.simpmusic');
    assert.equal(manifestPackage(axml('org.example.notes', { utf8: true })), 'org.example.notes');
    assert.equal(manifestPackage(axml('dev.typed.only', { typedOnly: true })), 'dev.typed.only', 'value only as a typed string');
  });

  test('not a binary manifest', () => {
    assert.equal(manifestPackage(new TextEncoder().encode('<manifest package="x"/>')), null);
    assert.equal(manifestPackage(new Uint8Array(4)), null);
  });
});
