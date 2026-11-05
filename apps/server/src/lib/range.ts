// Byte ranges for the static web build. Workers Static Assets answers a `Range` request with the whole file
// (200, no Accept-Ranges), and Safari (iOS and macOS) won't play a video from a server that doesn't answer ranges
// with 206; seeking needs them everywhere. So the Worker slices the asset itself: one range per request (what
// media players send). The binding sends no Content-Length either, so the first ranged request for a file reads
// it whole to learn its size (the bundled videos are a few MB); after that the slice is streamed.

/** Inclusive byte positions, like `Content-Range`. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The single byte range a `Range` header asks for, against a body of `size` bytes. `null` means "send the whole
 * body" (no header, another unit, several ranges, or a malformed one: all allowed by RFC 9110 §14.2);
 * `'unsatisfiable'` means 416.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, first = '', last = ''] = m;
  if (first === '' && last === '') return null;
  if (first === '') {
    // Suffix range: the last N bytes.
    const n = Number(last);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(first);
  if (last !== '' && Number(last) < start) return null;
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return { start, end };
}

/** Drop the first `skip` bytes of a stream, pass on `length` bytes, then stop reading. */
export function sliceStream(body: ReadableStream<Uint8Array>, skip: number, length: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let toSkip = skip;
  let left = length;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (left <= 0) {
          controller.close();
          await reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        let chunk = value;
        if (toSkip > 0) {
          if (chunk.byteLength <= toSkip) {
            toSkip -= chunk.byteLength;
            continue;
          }
          chunk = chunk.subarray(toSkip);
          toSkip = 0;
        }
        if (chunk.byteLength > left) chunk = chunk.subarray(0, left);
        left -= chunk.byteLength;
        controller.enqueue(chunk);
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

type FixedLengthStreamCtor = new (length: number) => TransformStream<Uint8Array, Uint8Array>;

/**
 * Sizes of assets read whole once, by `<path> <ETag>`. The assets binding sends no Content-Length, so the first
 * ranged request for a file reads it to learn the size; later ones in the same isolate stream just their slice.
 */
const knownSizes = new Map<string, number>();
const KNOWN_SIZES_MAX = 200;

function remember(key: string, size: number): void {
  if (knownSizes.size >= KNOWN_SIZES_MAX) knownSizes.clear();
  knownSizes.set(key, size);
}

/** For tests: forget the remembered sizes. */
export function forgetAssetSizes(): void {
  knownSizes.clear();
}

/**
 * Answer a `Range` request on a whole-file static response: 206 with only those bytes, or 416. Every whole-file
 * 200 says `Accept-Ranges: bytes`. Anything else (other methods and statuses, compressed bodies, an `If-Range`
 * that no longer matches) passes through as it came.
 */
export async function withByteRanges(req: Request, res: Response): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res;
  if (res.status !== 200 || res.headers.has('Content-Encoding')) return res;

  const headers = new Headers(res.headers);
  headers.set('Accept-Ranges', 'bytes');
  const rangeHeader = req.headers.get('Range');
  const etag = res.headers.get('ETag');
  const ifRange = req.headers.get('If-Range');
  if (!rangeHeader || (ifRange && ifRange !== etag)) return new Response(res.body, { status: 200, headers });

  const key = etag ? `${new URL(req.url).pathname} ${etag}` : null;
  let size = Number(res.headers.get('Content-Length') ?? NaN);
  if (!(size > 0) && key) size = knownSizes.get(key) ?? NaN;
  let whole: Uint8Array | null = null;
  if (!(size > 0)) {
    if (!res.body) return new Response(null, { status: 200, headers });
    whole = new Uint8Array(await res.arrayBuffer());
    size = whole.byteLength;
    if (key && size > 0) remember(key, size);
  }

  const range = parseRange(rangeHeader, size);
  if (range === null) return new Response(whole ?? res.body, { status: 200, headers });
  if (range === 'unsatisfiable') {
    if (!whole) void res.body?.cancel();
    headers.set('Content-Range', `bytes */${size}`);
    headers.delete('Content-Length');
    return new Response(null, { status: 416, headers });
  }

  const length = range.end - range.start + 1;
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Content-Length', String(length));
  if (req.method === 'HEAD') {
    if (!whole) void res.body?.cancel();
    return new Response(null, { status: 206, headers });
  }
  if (whole) return new Response(whole.subarray(range.start, range.end + 1), { status: 206, headers });
  if (!res.body) return new Response(null, { status: 206, headers });
  const sliced = sliceStream(res.body, range.start, length);
  // On Workers, FixedLengthStream sends a real Content-Length instead of chunked encoding.
  const Fixed = (globalThis as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream;
  return new Response(Fixed ? sliced.pipeThrough(new Fixed(length)) : sliced, { status: 206, headers });
}
