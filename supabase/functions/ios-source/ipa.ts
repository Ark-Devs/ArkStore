// Reads an IPA's Info.plist over HTTP without downloading the IPA: an IPA is a ZIP file, so we
// fetch its central directory from the end of the file (a Range request), find
// Payload/<App>.app/Info.plist, fetch just that entry, inflate it and parse the plist (binary or
// XML). A few kilobytes per app instead of tens of megabytes. Runs in Deno and Node (tests).

export type IpaInfo = {
  bundleId: string;
  version: string | null;
  build: string | null;
  minOS: string | null;
  name: string | null;
  /** NS…UsageDescription strings: what the app asks permission for and why. */
  privacy: Record<string, string>;
};

export type Fetcher = (url: string, init: { headers: Record<string, string>; redirect?: RequestRedirect }) => Promise<Response>;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

type Ranged = { bytes: Uint8Array; start: number; total: number };

async function fetchRange(fetcher: Fetcher, url: string, range: string): Promise<Ranged> {
  const res = await fetcher(url, { headers: { Range: `bytes=${range}` }, redirect: 'follow' });
  if (res.status === 206) {
    const m = (res.headers.get('content-range') ?? '').match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!m) throw new Error('no Content-Range');
    return { bytes, start: Number(m[1]), total: m[3] === '*' ? Number(m[2]) + 1 : Number(m[3]) };
  }
  if (res.status === 200) {
    // The server ignored the range: fine for small files, refused for big ones.
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > 64 * 1024 * 1024) throw new Error('server does not support ranges');
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, start: 0, total: bytes.length };
  }
  throw new Error(`HTTP ${res.status}`);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type Entry = { name: string; method: number; compSize: number; localOffset: number };

function* centralEntries(cd: Uint8Array): Generator<Entry> {
  let p = 0;
  while (p + 46 <= cd.length && u32(cd, p) === 0x02014b50) {
    const method = u16(cd, p + 10);
    let compSize = u32(cd, p + 20);
    let uncompSize = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let localOffset = u32(cd, p + 42);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    // ZIP64: the real sizes / offset live in extra field 0x0001, in this order, when maxed out.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = u16(cd, e);
      const size = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompSize === 0xffffffff) (uncompSize = u64(cd, q)), (q += 8);
        if (compSize === 0xffffffff) (compSize = u64(cd, q)), (q += 8);
        if (localOffset === 0xffffffff) localOffset = u64(cd, q);
      }
      e += 4 + size;
    }
    yield { name, method, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
}

/** The app's Info.plist from an IPA at `url` (GitHub release downloads support Range requests). */
export async function readIpaInfo(url: string, fetcher: Fetcher = fetch): Promise<IpaInfo> {
  // End of central directory: 22 bytes plus up to 64 KB of comment.
  const tail = await fetchRange(fetcher, url, '-65558');
  const t = tail.bytes;
  let eocd = -1;
  for (let i = t.length - 22; i >= 0; i--) {
    if (u32(t, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP file');
  let cdSize = u32(t, eocd + 12);
  let cdOffset = u32(t, eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || u32(t, loc) !== 0x07064b50) throw new Error('bad ZIP64 locator');
    const z64 = u64(t, loc + 8);
    const rec = z64 >= tail.start ? t.subarray(z64 - tail.start) : (await fetchRange(fetcher, url, `${z64}-${z64 + 55}`)).bytes;
    if (u32(rec, 0) !== 0x06064b50) throw new Error('bad ZIP64 record');
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }
  if (cdSize > 32 * 1024 * 1024) throw new Error('central directory too large');
  const cd =
    cdOffset >= tail.start
      ? t.subarray(cdOffset - tail.start, cdOffset - tail.start + cdSize)
      : (await fetchRange(fetcher, url, `${cdOffset}-${cdOffset + cdSize - 1}`)).bytes;

  let entry: Entry | null = null;
  for (const e of centralEntries(cd)) {
    if (/^Payload\/[^/]+\.app\/Info\.plist$/.test(e.name)) {
      entry = e;
      break;
    }
  }
  if (!entry) throw new Error('no Payload/*.app/Info.plist');
  if (entry.compSize > 4 * 1024 * 1024) throw new Error('Info.plist too large');

  // Local header (30 bytes + name + extra) and the data; the extra field can differ from the central one.
  const local = await fetchRange(fetcher, url, `${entry.localOffset}-${entry.localOffset + 30 + 1024 + entry.compSize}`);
  const l = local.bytes;
  if (u32(l, 0) !== 0x04034b50) throw new Error('bad local header');
  const dataStart = 30 + u16(l, 26) + u16(l, 28);
  const raw = l.subarray(dataStart, dataStart + entry.compSize);
  const plistBytes = entry.method === 0 ? raw : entry.method === 8 ? await inflateRaw(raw) : null;
  if (!plistBytes) throw new Error(`unsupported compression ${entry.method}`);

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
