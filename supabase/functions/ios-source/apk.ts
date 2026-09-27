// Reads an Android app's package name (e.g. "com.maxrave.simpmusic") from an APK over HTTP
// without downloading it: an APK is a ZIP, so readZipEntry (zip.ts) fetches just
// AndroidManifest.xml, which is in Android's binary XML format and parsed here. ArkStore needs
// the package name to tell whether an app is on the phone. Runs in Deno and Node (tests).
import { readZipEntry, u16, u32, type Fetcher } from './zip.ts';

const RES_STRING_POOL = 0x0001;
const RES_XML_START_ELEMENT = 0x0102;
const UTF8_FLAG = 0x100;
const TYPE_STRING = 0x03;
const NO_INDEX = 0xffffffff;

function readStringPool(b: Uint8Array, at: number): string[] {
  const headerSize = u16(b, at + 2);
  const count = u32(b, at + 8);
  const flags = u32(b, at + 16);
  const stringsStart = at + u32(b, at + 20);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = stringsStart + u32(b, at + headerSize + i * 4);
    if (utf8) {
      // UTF-16 length, then UTF-8 byte length, each 1 or 2 bytes.
      p += b[p] & 0x80 ? 2 : 1;
      let len = b[p];
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | b[p + 1];
        p += 2;
      } else p += 1;
      out.push(new TextDecoder().decode(b.subarray(p, p + len)));
    } else {
      let len = u16(b, p);
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | u16(b, p + 2);
        p += 4;
      } else p += 2;
      let s = '';
      for (let k = 0; k < len; k++) s += String.fromCharCode(u16(b, p + k * 2));
      out.push(s);
    }
  }
  return out;
}

/** The `package` attribute of <manifest> in a binary AndroidManifest.xml, or null. */
export function manifestPackage(b: Uint8Array): string | null {
  if (b.length < 8 || u16(b, 0) !== 0x0003) return null;
  let strings: string[] = [];
  let p = u16(b, 2);
  while (p + 8 <= b.length) {
    const type = u16(b, p);
    const headerSize = u16(b, p + 2);
    const size = u32(b, p + 4);
    if (size < 8 || p + size > b.length) break;
    if (type === RES_STRING_POOL) strings = readStringPool(b, p);
    if (type === RES_XML_START_ELEMENT) {
      const name = strings[u32(b, p + 20)];
      if (name === 'manifest') {
        const attrStart = u16(b, p + 24);
        const attrSize = u16(b, p + 26) || 20;
        const attrCount = u16(b, p + 28);
        for (let i = 0; i < attrCount; i++) {
          const a = p + headerSize + attrStart + i * attrSize;
          if (strings[u32(b, a + 4)] !== 'package') continue;
          const raw = u32(b, a + 8);
          if (raw !== NO_INDEX) return strings[raw] ?? null;
          if (b[a + 15] === TYPE_STRING) return strings[u32(b, a + 16)] ?? null;
        }
        return null;
      }
    }
    p += size;
  }
  return null;
}

/** The package name of the APK at `url`. */
export async function readApkPackage(url: string, fetcher: Fetcher = fetch, size?: number | null): Promise<string> {
  const manifest = await readZipEntry(url, (n) => n === 'AndroidManifest.xml', fetcher, size, 8 * 1024 * 1024, 'AndroidManifest.xml');
  const pkg = manifestPackage(manifest);
  if (!pkg || !/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(pkg)) throw new Error('no package name in AndroidManifest.xml');
  return pkg;
}
