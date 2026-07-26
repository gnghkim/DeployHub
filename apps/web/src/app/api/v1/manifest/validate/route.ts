import {
  MANIFEST_VERSION,
  parseManifest,
} from '@deployhub/manifest';

const MAX_MANIFEST_BYTES = 256 * 1024;
const VERSION_HEADERS = { 'X-Manifest-Version': MANIFEST_VERSION };

async function readManifestBody(request: Request): Promise<string | null> {
  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_BYTES) {
    return Response.json(
      { error: 'Manifest body exceeds the 256KB limit' },
      { status: 413, headers: VERSION_HEADERS },
    );
  }

  const body = await readManifestBody(request);
  if (body === null) {
    return Response.json(
      { error: 'Manifest body exceeds the 256KB limit' },
      { status: 413, headers: VERSION_HEADERS },
    );
  }

  return Response.json(parseManifest(body), {
    headers: VERSION_HEADERS,
  });
}
