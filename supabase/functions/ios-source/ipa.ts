// Reads an IPA's Info.plist over HTTP without downloading the IPA: an IPA is a ZIP file, so
// readZipEntry (zip.ts) fetches just Payload/<App>.app/Info.plist, which is parsed here (binary or
// XML plist). Runs in Deno and Node (tests).
import { readZipEntry, type Fetcher } from './zip.ts';

export type { Fetcher } from './zip.ts';

export type IpaInfo = {
  bundleId: string;
  version: string | null;
  build: string | null;
  minOS: string | null;
  name: string | null;
  /** NS…UsageDescription strings: what the app asks permission for and why. */
  privacy: Record<string, string>;
};

/**
 * The app's Info.plist from an IPA at `url` (GitHub release downloads support Range requests).
 * `size` is the file's size when known; otherwise a 1-byte request finds it. Only explicit ranges
 * are used: GitHub's release CDN answers suffix ranges ("bytes=-N") with 501.
 */
export async function readIpaInfo(url: string, fetcher: Fetcher = fetch, size?: number | null): Promise<IpaInfo> {
  const plistBytes = await readZipEntry(url, (n) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(n), fetcher, size, 4 * 1024 * 1024, 'Payload/*.app/Info.plist');
  const plist = parsePlist(plistBytes);
  if (!plist || typeof plist !== 'object' || Array.isArray(plist)) throw new Error('Info.plist is not a dictionary');
  const d = plist as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' && (d[k] as string).trim() ? (d[k] as string).trim() : null);
  const bundleId = str('CFBundleIdentifier');
  if (!bundleId) throw new Error('no CFBundleIdentifier');
  const privacy: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (/^NS\w+UsageDescription$/.test(k) && typeof v === 'string' && v.trim()) privacy[k] = v.trim().slice(0, 500);
  }
  return {
    bundleId,
    version: str('CFBundleShortVersionString'),
    build: str('CFBundleVersion'),
    minOS: str('MinimumOSVersion'),
    name: str('CFBundleDisplayName') ?? str('CFBundleName'),
    privacy,
  };
}

// ---------------------------------------------------------------------------
// Property lists
// ---------------------------------------------------------------------------

export type PlistValue = string | number | boolean | null | Date | Uint8Array | PlistValue[] | { [k: string]: PlistValue };

export function parsePlist(bytes: Uint8Array): PlistValue {
  const head = new TextDecoder().decode(bytes.subarray(0, 8));
  if (head === 'bplist00') return parseBinaryPlist(bytes);
  return parseXmlPlist(new TextDecoder().decode(bytes));
}

function parseBinaryPlist(b: Uint8Array): PlistValue {
  const n = b.length;
  if (n < 40) throw new Error('bplist too short');
  const offsetSize = b[n - 26];
  const refSize = b[n - 25];
  const numObjects = Number(readUInt(b, n - 24, 8));
  const top = Number(readUInt(b, n - 16, 8));
  const tableOffset = Number(readUInt(b, n - 8, 8));
  if (numObjects > 1_000_000 || tableOffset + numObjects * offsetSize > n) throw new Error('bad bplist trailer');
  const offsetOf = (i: number) => Number(readUInt(b, tableOffset + i * offsetSize, offsetSize));

  const parse = (i: number, depth: number): PlistValue => {
    if (depth > 64 || i >= numObjects) throw new Error('bad bplist object');
    let o = offsetOf(i);
    const marker = b[o];
    const type = marker >> 4;
    const info = marker & 0x0f;
    const length = (): number => {
      if (info !== 0x0f) {
        o += 1;
        return info;
      }
      const intMarker = b[o + 1];
      const size = 1 << (intMarker & 0x0f);
      const len = Number(readUInt(b, o + 2, size));
      o += 2 + size;
      return len;
    };
    switch (type) {
      case 0x0:
        return info === 0x08 ? false : info === 0x09 ? true : null;
      case 0x1:
        return Number(readUInt(b, o + 1, 1 << info));
      case 0x2: {
        const dv = new DataView(b.buffer, b.byteOffset + o + 1, 1 << info);
        return info === 2 ? dv.getFloat32(0) : dv.getFloat64(0);
      }
      case 0x3:
        return new Date((new DataView(b.buffer, b.byteOffset + o + 1, 8).getFloat64(0) + 978307200) * 1000);
      case 0x4: {
        const len = length();
        return b.slice(o, o + len);
      }
      case 0x5: {
        const len = length();
        return new TextDecoder('latin1').decode(b.subarray(o, o + len));
      }
      case 0x6: {
        const len = length();
        let s = '';
        for (let k = 0; k < len; k++) s += String.fromCharCode((b[o + 2 * k] << 8) | b[o + 2 * k + 1]);
        return s;
      }
      case 0x8:
        return Number(readUInt(b, o + 1, info + 1));
      case 0xa: {
        const len = length();
        const out: PlistValue[] = [];
        for (let k = 0; k < len; k++) out.push(parse(Number(readUInt(b, o + k * refSize, refSize)), depth + 1));
        return out;
      }
      case 0xd: {
        const len = length();
        const out: Record<string, PlistValue> = {};
        for (let k = 0; k < len; k++) {
          const key = parse(Number(readUInt(b, o + k * refSize, refSize)), depth + 1);
          const val = parse(Number(readUInt(b, o + (len + k) * refSize, refSize)), depth + 1);
          out[String(key)] = val;
        }
        return out;
      }
      default:
        return null;
    }
  };
  return parse(top, 0);
}

function readUInt(b: Uint8Array, o: number, size: number): bigint {
  let v = 0n;
  for (let k = 0; k < size; k++) v = (v << 8n) | BigInt(b[o + k]);
  return v;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENTITIES[e] ?? m,
  );

/** The top-level dictionary's string, number and boolean values (all the store needs). */
function parseXmlPlist(xml: string): PlistValue {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const start = body.indexOf('<dict>');
  if (start < 0) throw new Error('no <dict> in plist');
  const out: Record<string, PlistValue> = {};
  let depth = 0;
  const re = /<(\/?)(dict|array)\s*>|<(dict|array)\s*\/>|<key>([\s\S]*?)<\/key>\s*(?:<(string|integer|real)>([\s\S]*?)<\/\5>|<(true|false)\s*\/>)?/g;
  re.lastIndex = start + '<dict>'.length;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[2]) {
      if (m[1]) {
        if (depth === 0) break;
        depth--;
      } else depth++;
      continue;
    }
    if (m[3] || depth !== 0 || m[4] === undefined) continue;
    const key = unescapeXml(m[4].trim());
    if (m[5] === 'string') out[key] = unescapeXml(m[6]);
    else if (m[5]) out[key] = Number(m[6]);
    else if (m[7]) out[key] = m[7] === 'true';
  }
  return out;
}
