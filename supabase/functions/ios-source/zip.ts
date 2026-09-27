// Reads one file out of a ZIP on a web server without downloading the ZIP: fetch the central
// directory from the end of the file with a Range request, find the entry, fetch just that entry
// and inflate it. A few kilobytes instead of tens of megabytes. IPAs and APKs are ZIP files (see
// ipa.ts and apk.ts). Runs in Deno and Node (tests).

export type Fetcher = (url: string, init: { headers: Record<string, string>; redirect?: RequestRedirect }) => Promise<Response>;

export const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
export const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
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

/**
 * The bytes of the first entry whose name matches `match` (`what` names it in errors), from the
 * ZIP at `url`. GitHub release downloads support Range requests. `size` is the file's size when
 * known; otherwise a 1-byte request finds it. Only explicit ranges are used: GitHub's release CDN
 * answers suffix ranges ("bytes=-N") with 501.
 */
export async function readZipEntry(
  url: string,
  match: (name: string) => boolean,
  fetcher: Fetcher = fetch,
  size?: number | null,
  maxSize = 4 * 1024 * 1024,
  what = 'matching file',
): Promise<Uint8Array> {
  let total = size && size > 0 ? size : 0;
  if (!total) {
    const probe = await fetchRange(fetcher, url, '0-0');
    total = probe.total;
    if (probe.bytes.length === total) return readZipEntry(url, match, async () => new Response(probe.bytes as Uint8Array<ArrayBuffer>, { status: 200 }), total, maxSize, what);
  }
  // End of central directory: 22 bytes plus up to 64 KB of comment.
  const tail = await fetchRange(fetcher, url, `${Math.max(0, total - 65558)}-${total - 1}`);
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
    if (match(e.name)) {
      entry = e;
      break;
    }
  }
  if (!entry) throw new Error(`no ${what}`);
  if (entry.compSize > maxSize) throw new Error(`${what} too large`);

  // Local header (30 bytes + name + extra) and the data; the extra field can differ from the central one.
  const local = await fetchRange(fetcher, url, `${entry.localOffset}-${entry.localOffset + 30 + 1024 + entry.compSize}`);
  const l = local.bytes;
  if (u32(l, 0) !== 0x04034b50) throw new Error('bad local header');
  const dataStart = 30 + u16(l, 26) + u16(l, 28);
  const raw = l.subarray(dataStart, dataStart + entry.compSize);
  const bytes = entry.method === 0 ? raw : entry.method === 8 ? await inflateRaw(raw) : null;
  if (!bytes) throw new Error(`unsupported compression ${entry.method}`);
  return bytes;

}
